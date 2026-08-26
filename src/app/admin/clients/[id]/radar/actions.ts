"use server";

import { randomBytes } from "node:crypto";
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
  token: z
    .string({ error: "Colle le jeton d'accès personnel du client." })
    .trim()
    .min(20, { error: "Ce jeton semble trop court pour en être un." })
    .max(500, { error: "Ce jeton semble trop long pour en être un." }),
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
});

export async function enregistrerReglages(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = reglagesSchema.safeParse({
    organizationId: formData.get("organizationId"),
    commissionRate: formData.get("commissionRate"),
    windowDays: formData.get("windowDays"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const admin = createAdminClient();
  await preparerRadar(admin, parsed.data.organizationId);

  const { error } = await admin
    .from("radar_settings")
    .update({
      commission_rate: parsed.data.commissionRate,
      window_days: parsed.data.windowDays,
      currency: parsed.data.currency,
    })
    .eq("organization_id", parsed.data.organizationId);

  if (error) return fail("Impossible d'enregistrer ces réglages pour le moment.");

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
