"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
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
});

export async function declarerVente(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await getMembership(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = venteSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const { bookingId, montant, date, note } = parsed.data;

  // Retirer : ni montant, ni date. La base remet les cinq colonnes à nul.
  const retrait = !montant || montant.length === 0;

  let centimes: number | null = null;
  if (!retrait) {
    centimes = centimesSaisis(montant);
    if (centimes === null) {
      return fail("Écris le montant en euros, par exemple 1 200 ou 1200,50.", "montant");
    }
    if (!date) return fail("Choisis une date de vente.", "date");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_set_sale", {
    booking_id: bookingId,
    amount_cents: centimes ?? undefined,
    sale_date: retrait ? undefined : date,
    note: retrait ? undefined : (note ?? undefined),
  });

  if (error) {
    const lisible = error.message?.trim();
    return fail(
      lisible && lisible.endsWith(".")
        ? lisible
        : "Cette vente n'a pas pu être enregistrée.",
    );
  }

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
