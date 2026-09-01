"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  creerAbonnement,
  EVENEMENTS,
  identite,
  listerAbonnements,
  supprimerAbonnement,
} from "@/tools/resultats/calendly-api";
import { preparerRadar } from "@/tools/resultats/installation";
import { moisCourant } from "@/tools/resultats/mois";
import {
  construireLignes,
  construireLignesVentes,
  peutChangerDeBase,
  peutCloturer,
  peutMarquerPaye,
  totaux,
  type CanalDuReleve,
  type SeanceDuMois,
} from "@/tools/resultats/releve";

/**
 * L'administration de Radar : brancher un Calendly, régler la commission,
 * ajuster les canaux, corriger un rendez-vous.
 *
 * Tout passe par `requireAdmin()` puis la clé secrète, comme le reste de
 * l'administration. Les trois secrets d'un client ne transitent jamais par
 * une réponse : ils entrent dans le Vault et n'en ressortent que côté serveur.
 */

const organisation = z.uuid({ error: "Client introuvable." });

function rafraichir(organizationId: string) {
  revalidatePath(`/admin/clients/${organizationId}/radar`);
  revalidatePath(`/admin/clients/${organizationId}`);
}

/** L'adresse que Calendly appellera pour ce client. */
function adresseWebhook(organizationId: string): ActionResult<string> {
  const racine = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");

  if (!racine || !racine.startsWith("https://")) {
    return fail(
      "Calendly n'accepte que des adresses en https. Renseigne NEXT_PUBLIC_SITE_URL sur le domaine de production avant de connecter un client.",
    );
  }

  return ok(`${racine}/api/webhooks/calendly/${organizationId}`);
}

// ----------------------------- Connexion -----------------------------------

const connexionSchema = z.object({
  organizationId: organisation,
  // Calendly a changé la forme de ses jetons personnels — chaîne courte hier,
  // JWT de trois blocs et quelques centaines de caractères aujourd'hui, autre
  // chose demain. On ne juge donc plus de leur allure : on écarte seulement ce
  // qui ne peut pas partir dans un en-tête HTTP (une espace, un retour à la
  // ligne — un copier-coller de travers) et ce qui déborde de toute mesure.
  // Le seul verdict qui compte est celui de `/users/me`, juste en dessous.
  token: z
    .string({ error: "Colle le jeton d'accès personnel du client." })
    .trim()
    .min(1, { error: "Colle le jeton d'accès personnel du client." })
    .regex(/^\S+$/, {
      error: "Ce jeton contient une espace. Recopie-le en entier, d'un seul tenant.",
    })
    .max(4096, { error: "Ce jeton semble trop long pour en être un." }),
});

/**
 * Brancher le Calendly d'un client.
 *
 * L'ordre compte. On vérifie le jeton d'abord, parce qu'un jeton faux est le
 * cas courant et qu'il ne doit rien laisser derrière lui. On range ensuite les
 * secrets, et seulement après on crée l'abonnement : si Calendly refusait
 * l'abonnement alors que la clé de signature n'est pas encore posée, le
 * premier webhook arriverait sans clé pour le vérifier.
 */
export async function connecterCalendly(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = connexionSchema.safeParse({
    organizationId: formData.get("organizationId"),
    token: formData.get("token"),
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const { organizationId, token } = parsed.data;

  const url = adresseWebhook(organizationId);
  if (!url.ok) return url;

  const qui = await identite(token);
  if (!qui.ok) return fail(qui.error, "token");

  const admin = createAdminClient();
  await preparerRadar(admin, organizationId);

  const cleSignature = randomBytes(32).toString("hex");
  const sel = randomBytes(32).toString("hex");

  const poses = await Promise.all([
    admin.rpc("radar_set_secret", { org: organizationId, kind: "token", value: token }),
    admin.rpc("radar_set_secret", {
      org: organizationId,
      kind: "signing_key",
      value: cleSignature,
    }),
    admin.rpc("radar_set_secret", { org: organizationId, kind: "salt", value: sel }),
  ]);

  if (poses.some((resultat) => resultat.error)) {
    await admin.rpc("radar_clear_secrets", { org: organizationId });
    return fail("Impossible de ranger les secrets de ce client. Rien n'a été connecté.");
  }

  const abonnement = await creerAbonnement({
    jeton: token,
    organisation: qui.data.organisation,
    url: url.data,
    cleSignature,
  });

  if (!abonnement.ok) {
    // Pas de demi-connexion : sans abonnement, les secrets n'ont pas lieu
    // d'être, et un sel qui traîne fait tomber la pseudonymisation.
    await admin.rpc("radar_clear_secrets", { org: organizationId });
    return fail(abonnement.error);
  }

  const { error } = await admin
    .from("radar_settings")
    .update({
      calendly_user_uri: qui.data.utilisateur,
      calendly_org_uri: qui.data.organisation,
      calendly_webhook_uri: abonnement.data.uri,
      connected_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId);

  if (error) return fail("Connexion faite chez Calendly, mais pas enregistrée ici. Déconnecte puis recommence.");

  rafraichir(organizationId);
  return ok();
}

/** Vérifier que l'abonnement existe toujours, et qu'il pointe bien chez nous. */
export async function testerCalendly(
  organizationId: string,
): Promise<ActionResult<{ message: string }>> {
  await requireAdmin();

  const parsed = organisation.safeParse(organizationId);
  if (!parsed.success) return fail("Client introuvable.");

  const url = adresseWebhook(organizationId);
  if (!url.ok) return url;

  const admin = createAdminClient();
  const { data: reglages } = await admin
    .from("radar_settings")
    .select("calendly_org_uri, calendly_webhook_uri")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!reglages?.calendly_org_uri) return fail("Ce client n'est pas connecté.");

  const { data: jeton } = await admin.rpc("radar_get_secret", {
    org: organizationId,
    kind: "token",
  });
  if (!jeton) return fail("Le jeton de ce client est introuvable. Reconnecte-le.");

  const liste = await listerAbonnements({
    jeton,
    organisation: reglages.calendly_org_uri,
  });
  if (!liste.ok) return fail(liste.error);

  const notre = liste.data.find((abonnement) => abonnement.uri === reglages.calendly_webhook_uri);

  if (!notre) {
    return fail(
      "Calendly ne connaît plus notre abonnement. Déconnecte puis reconnecte ce client.",
    );
  }

  if (notre.callback_url !== url.data) {
    return fail(
      `L'abonnement pointe sur ${notre.callback_url}, pas sur notre adresse. Reconnecte ce client.`,
    );
  }

  const manquants = EVENEMENTS.filter((e) => !(notre.events ?? []).includes(e));
  if (manquants.length > 0) {
    return fail(`L'abonnement n'écoute pas ${manquants.join(" ni ")}. Reconnecte ce client.`);
  }

  return ok({
    message:
      notre.state && notre.state !== "active"
        ? `Abonnement trouvé, mais son état est « ${notre.state} ».`
        : "Abonnement actif, à la bonne adresse, sur les deux événements.",
  });
}

/** Débrancher : l'abonnement chez Calendly d'abord, les secrets ensuite. */
export async function deconnecterCalendly(
  organizationId: string,
): Promise<ActionResult<{ avertissement: string | null }>> {
  await requireAdmin();

  const parsed = organisation.safeParse(organizationId);
  if (!parsed.success) return fail("Client introuvable.");

  const admin = createAdminClient();
  const { data: reglages } = await admin
    .from("radar_settings")
    .select("calendly_webhook_uri")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const { data: jeton } = await admin.rpc("radar_get_secret", {
    org: organizationId,
    kind: "token",
  });

  let avertissement: string | null = null;

  if (jeton && reglages?.calendly_webhook_uri) {
    const retrait = await supprimerAbonnement(jeton, reglages.calendly_webhook_uri);
    if (!retrait.ok) {
      avertissement = `L'abonnement n'a pas pu être supprimé chez Calendly (${retrait.error}). Il continuera d'appeler une adresse qui ne répond plus ; supprime-le à la main.`;
    }
  }

  /*
   * On efface ici quoi qu'il arrive. Un sel qui reste dans le Vault après une
   * déconnexion, c'est de quoi retrouver qui se cache derrière une clé, pour
   * un client qu'on ne suit plus.
   */
  await admin.rpc("radar_clear_secrets", { org: organizationId });

  await admin
    .from("radar_settings")
    .update({
      calendly_user_uri: null,
      calendly_org_uri: null,
      calendly_webhook_uri: null,
      connected_at: null,
    })
    .eq("organization_id", organizationId);

  rafraichir(organizationId);
  return ok({ avertissement });
}

// ------------------------------ Réglages -----------------------------------

const reglagesSchema = z.object({
  organizationId: organisation,
  commissionRate: z.coerce
    .number({ error: "Le taux doit être un nombre." })
    .min(0, { error: "Le taux ne peut pas être négatif." })
    .max(100, { error: "Le taux ne peut pas dépasser 100 %." }),
  windowDays: z.coerce
    .number({ error: "La fenêtre doit être un nombre." })
    .int({ error: "La fenêtre s'exprime en jours entiers." })
    .min(0, { error: "La fenêtre ne peut pas être négative." })
    .max(365, { error: "La fenêtre ne peut pas dépasser 365 jours." }),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, { error: "La devise s'écrit en trois lettres, par exemple EUR." }),
  commissionBasis: z.enum(["encaissement", "ventes"], {
    error: "Base de commission inconnue.",
  }),
});

export async function enregistrerReglages(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();

  const parsed = reglagesSchema.safeParse({
    organizationId: formData.get("organizationId"),
    commissionRate: formData.get("commissionRate"),
    windowDays: formData.get("windowDays"),
    currency: formData.get("currency"),
    commissionBasis: formData.get("commissionBasis"),
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const admin = createAdminClient();
  await preparerRadar(admin, parsed.data.organizationId);

  const { data: avant } = await admin
    .from("radar_settings")
    .select("commission_rate, window_days, currency, commission_basis")
    .eq("organization_id", parsed.data.organizationId)
    .maybeSingle();

  const ancienneBase = avant?.commission_basis ?? "encaissement";
  const changeDeBase = ancienneBase !== parsed.data.commissionBasis;

  /*
   * Le garde-fou du chantier 4 : on ne change pas la règle de la commission
   * tant qu'un relevé n'est pas réglé. Le reste des réglages, lui, passe —
   * corriger un taux pour le mois prochain n'a jamais posé de problème.
   */
  if (changeDeBase) {
    const { data: ouverts } = await admin
      .from("radar_statements")
      .select("month, status")
      .eq("organization_id", parsed.data.organizationId)
      .neq("status", "paye")
      .order("month");

    const verdict = peutChangerDeBase(ouverts ?? []);
    if (!verdict.ok) return fail(verdict.raison, verdict.champ);
  }

  const { error } = await admin
    .from("radar_settings")
    .update({
      commission_rate: parsed.data.commissionRate,
      window_days: parsed.data.windowDays,
      currency: parsed.data.currency,
      commission_basis: parsed.data.commissionBasis,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", parsed.data.organizationId);

  if (error) return fail("Impossible d'enregistrer ces réglages pour le moment.");

  /*
   * Le journal. Changer la base, c'est changer ce que le client paie : c'est
   * le seul réglage dont il faut pouvoir dire quand il a changé, et par qui.
   * Les autres sont notés dans la même ligne, sans en faire une histoire.
   */
  await admin
    .from("radar_settings_log")
    .insert({
      organization_id: parsed.data.organizationId,
      user_id: session.userId,
      type: changeDeBase ? "basis.changed" : "settings.changed",
      payload: {
        ...(changeDeBase ? { base_avant: ancienneBase, base_apres: parsed.data.commissionBasis } : {}),
        taux_avant: Number(avant?.commission_rate ?? null),
        taux_apres: parsed.data.commissionRate,
        fenetre_avant: avant?.window_days ?? null,
        fenetre_apres: parsed.data.windowDays,
        devise_avant: avant?.currency ?? null,
        devise_apres: parsed.data.currency,
      },
    })
    .then(
      () => undefined,
      () => undefined, // journaliser ne doit pas faire échouer un réglage valide
    );

  rafraichir(parsed.data.organizationId);
  return ok();
}

// ------------------------------- Canaux ------------------------------------

/** « google, cpc , ppc » → ["google", "cpc", "ppc"]. */
function liste(valeur: FormDataEntryValue | null): string[] {
  return String(valeur ?? "")
    .split(/[,\n]/)
    .map((morceau) => morceau.trim())
    .filter(Boolean)
    .slice(0, 30);
}

const canalSchema = z.object({
  organizationId: organisation,
  channelId: z.uuid({ error: "Canal introuvable." }),
  label: z
    .string({ error: "Donne un libellé à ce canal." })
    .trim()
    .min(1, { error: "Donne un libellé à ce canal." })
    .max(40, { error: "Le libellé ne peut pas dépasser 40 caractères." }),
  sortOrder: z.coerce
    .number({ error: "L'ordre doit être un nombre." })
    .int()
    .min(0)
    .max(9999),
});

/**
 * L'ordre des canaux n'est pas cosmétique : c'est l'ordre d'interrogation du
 * moteur d'attribution. Google Ads avant SEO, sinon `google/cpc` tombe dans le
 * référencement naturel.
 */
export async function enregistrerCanal(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = canalSchema.safeParse({
    organizationId: formData.get("organizationId"),
    channelId: formData.get("channelId"),
    label: formData.get("label"),
    sortOrder: formData.get("sortOrder"),
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const admin = createAdminClient();
  const { error } = await admin
    .from("radar_channels")
    .update({
      label: parsed.data.label,
      sort_order: parsed.data.sortOrder,
      is_comete: formData.get("isComete") === "on",
      is_active: formData.get("isActive") === "on",
      rules: {
        sources: liste(formData.get("sources")),
        mediums: liste(formData.get("mediums")),
        click_ids: liste(formData.get("clickIds")),
        declared: liste(formData.get("declared")),
      },
    })
    .eq("id", parsed.data.channelId)
    .eq("organization_id", parsed.data.organizationId);

  if (error) return fail("Impossible d'enregistrer ce canal pour le moment.");

  rafraichir(parsed.data.organizationId);
  return ok();
}

// --------------------------- Corriger un rendez-vous ------------------------

const correctionCanalSchema = z.object({
  organizationId: organisation,
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  channelId: z.uuid({ error: "Canal introuvable." }),
  motif: z
    .string({ error: "Dis pourquoi tu corriges ce canal." })
    .trim()
    .min(3, { error: "Dis pourquoi tu corriges ce canal." })
    .max(200, { error: "Le motif ne peut pas dépasser 200 caractères." }),
});

/**
 * Corriger le canal d'un rendez-vous.
 *
 * Le motif est obligatoire et visible du client : une correction qui change sa
 * facture sans dire pourquoi n'aurait aucune valeur devant lui.
 */
export async function corrigerCanal(
  input: unknown,
): Promise<ActionResult> {
  const { userId } = await requireAdmin();

  const parsed = correctionCanalSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const admin = createAdminClient();
  const { data: avant } = await admin
    .from("radar_bookings")
    .select("channel_id, attribution")
    .eq("id", parsed.data.bookingId)
    .eq("organization_id", parsed.data.organizationId)
    .maybeSingle();

  if (!avant) return fail("Ce rendez-vous n'existe plus.");

  const { error } = await admin
    .from("radar_bookings")
    .update({
      channel_id: parsed.data.channelId,
      attribution: "manuel",
      attribution_note: parsed.data.motif,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.bookingId);

  if (error) return fail("Impossible de corriger ce canal pour le moment.");

  await admin.from("radar_booking_activities").insert({
    booking_id: parsed.data.bookingId,
    organization_id: parsed.data.organizationId,
    user_id: userId,
    type: "channel.changed",
    payload: {
      from: avant.channel_id,
      to: parsed.data.channelId,
      avant: avant.attribution,
      motif: parsed.data.motif,
    },
  });

  rafraichir(parsed.data.organizationId);
  return ok();
}

const correctionStatutSchema = z.object({
  organizationId: organisation,
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  statut: z.enum(["confirme", "honore", "annule", "no_show"], {
    error: "Statut inconnu.",
  }),
  motif: z.string().trim().max(200).optional(),
});

/**
 * Corriger un statut, côté Louis.
 *
 * Contrairement au client, il n'est pas arrêté par un relevé clôturé : le
 * chantier 5 prévoit qu'il corrige puis re-clôture, et c'est exactement ce
 * geste-là.
 */
export async function corrigerStatut(input: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin();

  const parsed = correctionStatutSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const admin = createAdminClient();
  const { data: avant } = await admin
    .from("radar_bookings")
    .select("status")
    .eq("id", parsed.data.bookingId)
    .eq("organization_id", parsed.data.organizationId)
    .maybeSingle();

  if (!avant) return fail("Ce rendez-vous n'existe plus.");

  const motif = parsed.data.motif?.trim() || null;

  const { error } = await admin
    .from("radar_bookings")
    .update({
      status: parsed.data.statut,
      status_origin: "admin",
      status_note: motif,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.bookingId);

  if (error) return fail("Impossible de corriger ce statut pour le moment.");

  await admin.from("radar_booking_activities").insert({
    booking_id: parsed.data.bookingId,
    organization_id: parsed.data.organizationId,
    user_id: userId,
    type: "status.changed",
    payload: { from: avant.status, to: parsed.data.statut, origin: "admin", note: motif },
  });

  rafraichir(parsed.data.organizationId);
  return ok();
}

// ------------------------------ Les relevés ---------------------------------

const clotureSchema = z.object({
  organizationId: organisation,
  mois: z.string().regex(/^\d{4}-\d{2}-01$/, { error: "Mois invalide." }),
});

/**
 * Clôturer un mois.
 *
 * Le relevé est un instantané : il recopie les libellés de canaux et les
 * montants tels qu'ils sont au moment de la clôture. Renommer un canal l'an
 * prochain ne doit pas réécrire un relevé déjà validé, et une séance corrigée
 * après coup ne doit pas changer une facture acceptée.
 *
 * Re-clôturer un relevé contesté garde le commentaire du client : c'est ce qui
 * lui permet de vérifier que la correction porte sur ce qu'il avait signalé.
 */
export async function cloturerMois(input: unknown): Promise<ActionResult> {
  await requireAdmin();

  const parsed = clotureSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const { organizationId, mois } = parsed.data;

  const admin = createAdminClient();

  /*
   * Les colonnes lues pour construire un relevé. Les champs de vente sont
   * chargés dans les deux modes : ils ne coûtent rien, et c'est ce qui permet
   * au mode `ventes` d'écarter du bloc « pour information » une séance qui a
   * vendu un autre mois.
   */
  const COLONNES_SEANCE =
    "id, scheduled_start, event_type_name, channel_id, effective_status, counts_for_commission, amount_cents, currency, payment_ok, sale_amount_cents, sale_date, has_sale";

  const [existant, reglages, canaux, seances] = await Promise.all([
    admin
      .from("radar_statements")
      .select("id, status, review_comment, reviewed_at, reviewed_by")
      .eq("organization_id", organizationId)
      .eq("month", mois)
      .maybeSingle(),
    admin
      .from("radar_settings")
      .select("commission_rate, window_days, commission_basis")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin
      .from("radar_channels")
      .select("id, label, is_comete")
      .eq("organization_id", organizationId),
    admin
      .from("radar_bookings_effective")
      .select(COLONNES_SEANCE)
      .eq("organization_id", organizationId)
      .eq("mois", mois)
      .limit(1000),
  ]);

  const verdict = peutCloturer(existant.data?.status ?? null, mois, moisCourant());
  if (!verdict.ok) return fail(verdict.raison);

  const taux = Number(reglages.data?.commission_rate ?? 20);
  const base = reglages.data?.commission_basis ?? "encaissement";
  const listeCanaux = (canaux.data ?? []) as CanalDuReleve[];
  const duMois = (seances.data ?? []) as unknown as SeanceDuMois[];

  /*
   * En `ventes`, les lignes facturées ne sont pas celles du mois : ce sont les
   * ventes dont la date tombe dedans, et leurs séances peuvent venir de
   * n'importe quel mois précédent. D'où cette seconde lecture, qui n'a pas
   * lieu en `encaissement`.
   */
  let lignes;
  if (base === "ventes") {
    const { data: ventes } = await admin
      .from("radar_bookings_effective")
      .select(COLONNES_SEANCE)
      .eq("organization_id", organizationId)
      .eq("commission_month", mois)
      .not("sale_amount_cents", "is", null)
      .limit(1000);

    lignes = construireLignesVentes(
      (ventes ?? []) as unknown as SeanceDuMois[],
      duMois,
      listeCanaux,
    );
  } else {
    lignes = construireLignes(duMois, listeCanaux);
  }

  const { base_cents, commission_cents } = totaux(lignes, taux);

  const { data: releve, error } = await admin
    .from("radar_statements")
    .upsert(
      {
        organization_id: organizationId,
        month: mois,
        status: "cloture",
        commission_rate: taux,
        commission_basis: base,
        window_days: reglages.data?.window_days ?? 90,
        base_cents,
        commission_cents,
        lines: lignes,
        closed_at: new Date().toISOString(),
        review_comment: existant.data?.review_comment ?? null,
        reviewed_at: existant.data?.reviewed_at ?? null,
        reviewed_by: existant.data?.reviewed_by ?? null,
      },
      { onConflict: "organization_id,month" },
    )
    .select("id")
    .single();

  if (error || !releve) return fail("Impossible de clôturer ce mois pour le moment.");

  /*
   * Les lignes du mois pointent sur ce relevé. On délie d'abord : re-clôturer
   * après une correction peut avoir changé l'ensemble, et une séance déplacée
   * d'un mois à l'autre resterait sinon accrochée au mauvais relevé.
   */
  await admin
    .from("radar_bookings")
    .update({ statement_id: null })
    .eq("statement_id", releve.id);

  if (lignes.length > 0) {
    await admin
      .from("radar_bookings")
      .update({ statement_id: releve.id })
      .in(
        "id",
        lignes.map((ligne) => ligne.id),
      );
  }

  rafraichir(organizationId);
  return ok();
}

const paiementSchema = z.object({
  organizationId: organisation,
  statementId: z.uuid({ error: "Relevé introuvable." }),
  note: z.string().trim().max(200).optional(),
});

/**
 * Marquer un relevé payé.
 *
 * Sur un relevé validé, c'est la suite naturelle. Sur un relevé seulement
 * clôturé, c'est un accord pris hors de l'outil : la note devient alors le
 * seul endroit qui en garde trace, et elle est obligatoire.
 */
export async function marquerPaye(input: unknown): Promise<ActionResult> {
  await requireAdmin();

  const parsed = paiementSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const admin = createAdminClient();
  const { data: releve } = await admin
    .from("radar_statements")
    .select("status, review_comment")
    .eq("id", parsed.data.statementId)
    .eq("organization_id", parsed.data.organizationId)
    .maybeSingle();

  if (!releve) return fail("Ce relevé n'existe plus.");

  const note = parsed.data.note?.trim();
  const verdict = peutMarquerPaye(releve.status, note);
  if (!verdict.ok) return fail(verdict.raison, verdict.champ);

  const { error } = await admin
    .from("radar_statements")
    .update({
      status: "paye",
      paid_at: new Date().toISOString(),
      review_comment: note ? note : releve.review_comment,
    })
    .eq("id", parsed.data.statementId);

  if (error) return fail("Impossible de marquer ce relevé payé pour le moment.");

  rafraichir(parsed.data.organizationId);
  return ok();
}

// --------------------------- Saisies mensuelles -----------------------------

const saisieSchema = z.object({
  organizationId: organisation,
  channelId: z.uuid({ error: "Canal introuvable." }),
  mois: z.string().regex(/^\d{4}-\d{2}-01$/, { error: "Mois invalide." }),
  spendCents: z.coerce
    .number({ error: "La dépense doit être un nombre." })
    .min(0, { error: "La dépense ne peut pas être négative." })
    .max(100_000_000),
  /*
   * Absents quand Sonde mesure le mois : le formulaire ne porte alors plus ces
   * deux champs. `null` ne vaut pas zéro — il vaut « ne touche pas à ce qui
   * est en base », sans quoi enregistrer une dépense effacerait les valeurs
   * saisies avant la mise en route de Sonde.
   */
  visitors: z.coerce
    .number({ error: "Un nombre de visiteurs, entier." })
    .int()
    .min(0)
    .max(10_000_000)
    .nullable(),
  clicks: z.coerce
    .number({ error: "Un nombre de clics, entier." })
    .int()
    .min(0)
    .max(10_000_000)
    .nullable(),
});

/** Les dépenses de Louis : jamais visibles du client, c'est sa marge. */
export async function enregistrerSaisie(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const euros = Number(String(formData.get("spend") ?? "0").replace(",", "."));

  const parsed = saisieSchema.safeParse({
    organizationId: formData.get("organizationId"),
    channelId: formData.get("channelId"),
    mois: formData.get("mois"),
    spendCents: Number.isFinite(euros) ? Math.round(euros * 100) : Number.NaN,
    visitors: formData.has("visitors") ? formData.get("visitors") : null,
    clicks: formData.has("clicks") ? formData.get("clicks") : null,
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const admin = createAdminClient();
  const { error } = await admin.from("radar_channel_entries").upsert(
    {
      organization_id: parsed.data.organizationId,
      channel_id: parsed.data.channelId,
      month: parsed.data.mois,
      spend_cents: parsed.data.spendCents,
      // Omises quand le formulaire ne les portait pas : l'`upsert` laisse alors
      // en place ce que la ligne contenait déjà.
      ...(parsed.data.visitors === null ? {} : { visitors: parsed.data.visitors }),
      ...(parsed.data.clicks === null ? {} : { clicks: parsed.data.clicks }),
    },
    { onConflict: "organization_id,month,channel_id" },
  );

  if (error) return fail("Impossible d'enregistrer cette saisie pour le moment.");

  rafraichir(parsed.data.organizationId);
  return ok();
}

// ------------------------------ Jetons d'export -----------------------------

/**
 * Créer un jeton de lecture pour un rapport externe.
 *
 * Le jeton est rendu **une seule fois**, dans la réponse de cette action, et
 * n'existe nulle part ailleurs : la base n'en garde que le SHA-256. C'est le
 * même contrat qu'un mot de passe, et pour la même raison — un tiers va le
 * ranger dans ses variables d'environnement, et une fuite de notre base ne
 * doit pas suffire à lire les rendez-vous d'un client.
 *
 * D'où la conséquence à assumer à l'écran : perdu, il ne se retrouve pas. On
 * en crée un autre et on révoque l'ancien.
 */
const jetonExportSchema = z.object({
  organizationId: organisation,
  label: z
    .string({ error: "Donne un libellé à ce jeton." })
    .trim()
    .min(1, { error: "Donne un libellé à ce jeton." })
    .max(60, { error: "Le libellé tient en 60 caractères." }),
});

export async function creerJetonExport(
  _precedent: ActionResult<{ jeton: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ jeton: string }>> {
  await requireAdmin();

  const parsed = jetonExportSchema.safeParse({
    organizationId: formData.get("organizationId"),
    label: formData.get("label"),
  });
  if (!parsed.success) return failFromZod(parsed.error);

  // 32 octets : de quoi rendre une recherche exhaustive sans objet, et la
  // forme exacte que la route attend avant même de calculer une empreinte.
  const jeton = randomBytes(32).toString("hex");
  const empreinte = createHash("sha256").update(jeton).digest("hex");

  const admin = createAdminClient();
  const { error } = await admin.from("radar_export_tokens").insert({
    organization_id: parsed.data.organizationId,
    token_hash: empreinte,
    label: parsed.data.label,
  });

  if (error) return fail("Ce jeton n'a pas pu être créé.");

  rafraichir(parsed.data.organizationId);
  return ok({ jeton });
}

/**
 * Révoquer, c'est dater. La ligne reste : elle dit qu'un rapport a lu ces
 * données, et jusqu'à quand.
 */
export async function revoquerJetonExport(
  organizationId: string,
  tokenId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = z
    .object({ organizationId: organisation, tokenId: z.uuid({ error: "Jeton introuvable." }) })
    .safeParse({ organizationId, tokenId });
  if (!parsed.success) return failFromZod(parsed.error);

  const admin = createAdminClient();
  const { error } = await admin
    .from("radar_export_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.tokenId)
    .eq("organization_id", parsed.data.organizationId)
    .is("revoked_at", null);

  if (error) return fail("Ce jeton n'a pas pu être révoqué.");

  rafraichir(parsed.data.organizationId);
  return ok();
}
