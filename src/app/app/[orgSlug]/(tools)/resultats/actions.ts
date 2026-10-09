"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { annulerDevisEnAttente } from "@/tools/devis/moteur";
import { offreDeVente } from "@/tools/devis/offre-vente";
import { AUTRE_MONTANT, choixParCle } from "@/tools/devis/offre-vente-choix";
import { centimesSaisis } from "@/tools/resultats/format";

/**
 * Ce que le client peut changer lui-même : le statut d'une séance.
 *
 * L'écriture directe sur `radar_bookings` lui est fermée ; il passe par
 * `radar_client_set_status`, qui vérifie ce qu'une politique RLS ne saurait
 * dire — le relevé du mois est-il clôturé, le statut de départ est-il l'un des
 * trois permis, l'annulation vient-elle de Calendly. La fonction refuse en
 * français ; on relaie son message tel quel plutôt que de le traduire une
 * seconde fois et de risquer d'en dire moins.
 */

const changementSchema = z.object({
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  statut: z.enum(["confirme", "no_show", "annule"], { error: "Statut inconnu." }),
});

export async function marquerStatut(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await getMembership(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = changementSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_client_set_status", {
    booking_id: parsed.data.bookingId,
    new_status: parsed.data.statut,
  });

  if (error) {
    // Les messages de la fonction sont écrits pour être lus ; ceux de Postgres
    // ne le sont pas. On distingue les deux à la ponctuation, faute de mieux.
    const lisible = error.message?.trim();
    return fail(
      lisible && lisible.endsWith(".")
        ? lisible
        : "Ce changement n'a pas pu être enregistré.",
    );
  }

  revalidatePath(`/app/${orgSlug}/resultats`);
  revalidatePath(`/app/${orgSlug}/resultats/rendez-vous`);
  return ok();
}

/**
 * Déclarer, corriger ou retirer une vente.
 *
 * Un seul chemin pour les trois gestes, comme `radar_set_sale` côté base :
 * un montant absent vaut retrait. Ce qui est vérifié ici, c'est la forme —
 * un montant lisible, une date qui existe. Ce qui est vérifié là-bas, c'est
 * le fond : l'accès, le verrou du relevé, la séance annulée, la date qui ne
 * précède pas le rendez-vous ni ne le devance. Les deux couches, comme
 * partout ailleurs dans le hub.
 *
 * Dans un espace qui a son modèle de devis (Peggy), la vente se note sur
 * l'offre (Louis, 08/10/2026) : `choix` dit ce qu'elle prend et comment elle
 * paie, et le montant, le nombre de paiements et la note se recalculent ici,
 * jamais depuis ce que l'écran envoie. « Autre montant » garde la saisie
 * libre. Une vente notée arrête le devis encore en attente sur ce rendez-vous
 * (Louis, 09/10/2026, A).
 */
const venteSchema = z.object({
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  /** Ce que la personne a tapé, en euros. La conversion se fait juste après. */
  montant: z.string().trim().max(20).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choisis une date de vente." })
    .optional(),
  note: z.string().trim().max(200, { error: "La note tient en 200 caractères." }).optional(),
  /** La clé de l'offre (« 12:une_fois ») ou « autre ». */
  choix: z.string().trim().max(20).optional(),
});

export async function declarerVente(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await getMembership(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = venteSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const { bookingId, montant, date, note, choix } = parsed.data;

  // Sur l'offre : le choix décide de tout, la saisie du montant ne compte pas.
  const offre = offreDeVente(membre.org.slug);
  const surLOffre = offre && choix && choix !== AUTRE_MONTANT ? choixParCle(offre, choix) : null;
  if (offre && choix && choix !== AUTRE_MONTANT && !surLOffre) {
    return fail("Choisis ce qu'elle prend.");
  }

  // Retirer : ni choix, ni montant, ni date. La base remet les cinq colonnes à nul.
  const retrait = !surLOffre && (!montant || montant.length === 0);

  let centimes: number | null = null;
  if (surLOffre) {
    centimes = surLOffre.montantCents;
  } else if (!retrait) {
    centimes = centimesSaisis(montant);
    if (centimes === null) {
      return fail("Écris le montant en euros, par exemple 1 200 ou 1200,50.", "montant");
    }
  }
  if (!retrait && !date) return fail("Choisis une date de vente.", "date");

  const noteEcrite = surLOffre
    ? [surLOffre.note, note].filter(Boolean).join(" · ").slice(0, 200)
    : note;

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_set_sale", {
    booking_id: bookingId,
    amount_cents: centimes ?? undefined,
    sale_date: retrait ? undefined : date,
    note: retrait ? undefined : (noteEcrite || undefined),
  });

  if (error) {
    const lisible = error.message?.trim();
    return fail(
      lisible && lisible.endsWith(".")
        ? lisible
        : "Cette vente n'a pas pu être enregistrée.",
    );
  }

  if (surLOffre) {
    // Comme une vente venue d'un devis payé (`devis_vers_radar`, 0052).
    const etalement = await supabase.rpc("radar_set_sale_fois", {
      booking_id: bookingId,
      fois: surLOffre.fois,
      premier_cents: surLOffre.premierCents ?? undefined,
    });
    if (etalement.error) {
      return fail("La vente est notée, mais pas le nombre de paiements : réessaie.");
    }
  }

  // Elle a signé autrement : le devis en attente s'arrête, et ses rappels avec.
  if (!retrait) await annulerDevisEnAttente(createAdminClient(), bookingId);

  revalidatePath(`/app/${orgSlug}/resultats`);
  revalidatePath(`/app/${orgSlug}/resultats/rendez-vous`);
  return ok();
}

/**
 * « Pas de vente » : une réponse, pas une vente à zéro euro.
 *
 * Elle ne touche aucune colonne — la trace vit dans les activités — et sort
 * la séance du bloc « À vérifier », où elle attendait une réponse.
 */
export async function refuserVente(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await getMembership(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = z
    .object({ bookingId: z.uuid({ error: "Rendez-vous introuvable." }) })
    .safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_decline_sale", {
    booking_id: parsed.data.bookingId,
  });

  if (error) {
    const lisible = error.message?.trim();
    return fail(
      lisible && lisible.endsWith(".") ? lisible : "Ce choix n'a pas pu être enregistré.",
    );
  }

  revalidatePath(`/app/${orgSlug}/resultats`);
  revalidatePath(`/app/${orgSlug}/resultats/rendez-vous`);
  return ok();
}

/**
 * « Pas de vente », avec sa raison et, si la personne a dit quand, le mois où
 * en reparler.
 *
 * `radar_note_non_vente` dit aussi « pas de vente » si ce n'était pas fait :
 * une seule réponse du client. Ni le statut ni la commission ne bougent.
 */
/*
 * `pas_encore` manquait ici depuis la 0031 : l'écran le proposait en tête de
 * liste et l'action le refusait (« Choisis une raison. »). « En attente »
 * l'envoie avec le jour exact choisi au calendrier, `recontacterLe` (0038).
 */
const nonVenteSchema = z.object({
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  motif: z.enum(["pas_encore", "argent", "moment", "conjoint", "pas_convaincue", "autre"], {
    error: "Choisis une raison.",
  }),
  recontacter: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/, { error: "Choisis un mois." })
    .nullable()
    .optional(),
  recontacterLe: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choisis une date." })
    .nullable()
    .optional(),
});

export async function noterNonVente(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await getMembership(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = nonVenteSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_note_non_vente", {
    booking_id: parsed.data.bookingId,
    motif: parsed.data.motif,
    recontacter: parsed.data.recontacter ?? undefined,
    recontacter_le: parsed.data.recontacterLe ?? undefined,
  });

  if (error) {
    const lisible = error.message?.trim();
    return fail(
      lisible && lisible.endsWith(".") ? lisible : "Cette raison n'a pas pu être enregistrée.",
    );
  }

  revalidatePath(`/app/${orgSlug}/resultats`);
  revalidatePath(`/app/${orgSlug}/resultats/rendez-vous`);
  return ok();
}

/** « C'est fait » : la personne à recontacter l'a été. */
export async function marquerRecontactee(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await getMembership(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = z
    .object({ bookingId: z.uuid({ error: "Rendez-vous introuvable." }) })
    .safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_recontact_fait", {
    booking_id: parsed.data.bookingId,
  });

  if (error) {
    const lisible = error.message?.trim();
    return fail(lisible && lisible.endsWith(".") ? lisible : "Ça n'a pas pu être noté.");
  }

  revalidatePath(`/app/${orgSlug}/resultats`);
  revalidatePath(`/app/${orgSlug}/resultats/rendez-vous`);
  return ok();
}

/**
 * Noter ce qu'a donné l'appel de la veille : « a confirmé » ou « sans réponse ».
 *
 * `radar_note_appel` vérifie l'accès et que l'espace suit bien cet appel ; elle
 * ne touche ni au statut ni à la commission. La réponse peut changer : la
 * dernière fait foi.
 */
const appelSchema = z.object({
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  reponse: z.enum(["confirme", "sans_reponse"], { error: "Réponse inconnue." }),
});

export async function noterAppel(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await getMembership(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = appelSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_note_appel", {
    booking_id: parsed.data.bookingId,
    reponse: parsed.data.reponse,
  });

  if (error) {
    const lisible = error.message?.trim();
    return fail(
      lisible && lisible.endsWith(".") ? lisible : "Cette réponse n'a pas pu être enregistrée.",
    );
  }

  revalidatePath(`/app/${orgSlug}/resultats`);
  revalidatePath(`/app/${orgSlug}/resultats/rendez-vous`);
  return ok();
}

/**
 * Répondre à un relevé : le valider, ou le contester en disant pourquoi.
 *
 * Comme pour les statuts, c'est `radar_review_statement` qui décide — elle
 * seule sait qu'un relevé déjà répondu ne se répond pas deux fois, et qu'une
 * contestation sans motif n'apprend rien à Louis.
 */
const reponseSchema = z.object({
  statementId: z.uuid({ error: "Relevé introuvable." }),
  decision: z.enum(["valide", "conteste"], { error: "Décision inconnue." }),
  commentaire: z.string().trim().max(1000).optional(),
});

export async function repondreReleve(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await getMembership(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = reponseSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_review_statement", {
    statement_id: parsed.data.statementId,
    decision: parsed.data.decision,
    comment: parsed.data.commentaire,
  });

  if (error) {
    const lisible = error.message?.trim();
    return fail(
      lisible && lisible.endsWith(".")
        ? lisible
        : "Ta réponse n'a pas pu être enregistrée.",
    );
  }

  revalidatePath(`/app/${orgSlug}/resultats`);
  revalidatePath(`/app/${orgSlug}/resultats/releves`);
  return ok();
}
