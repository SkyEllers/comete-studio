import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { MessageCalendly } from "@/tools/resultats/calendly";

import { profil as profilDe } from "./profils/index.ts";
import type { Profil } from "./profil.ts";
import {
  effaceApres,
  invitationCalendly,
  lireReservation,
  type InvitationCalendly,
} from "./reservation.ts";
import { intervalleMs } from "./temps.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Ce que l'agent fait d'un message Calendly.
 *
 * Appelé par la route du webhook, après Radar, sur le même message déjà
 * authentifié. Deux issues seulement : `ok` (compris, ou volontairement
 * ignoré) et `erreur` (panne de notre côté : la route répond 500 et Calendly
 * rejoue ; Radar, idempotent, n'en souffre pas).
 *
 * Rien de ce qui passe ici ne part dans un journal : c'est précisément la
 * donnée personnelle que Radar refuse de voir.
 */
export type Issue = "ok" | "erreur";

type Reglages = {
  actif: boolean;
  profil: string;
  types_suivis: string[];
  delai_minimum: string;
};

async function reglagesDe(admin: Admin, orgId: string): Promise<Reglages | null> {
  const { data } = await admin
    .from("agent_reglages")
    .select("actif, profil, types_suivis, delai_minimum")
    .eq("organization_id", orgId)
    .maybeSingle();
  return data ?? null;
}

export async function agentRecoit(
  admin: Admin,
  orgId: string,
  message: MessageCalendly,
): Promise<Issue> {
  const reglages = await reglagesDe(admin, orgId);
  // Pas d'agent, ou pas encore lancé : les vraies réservations ne le
  // concernent pas. La simulation, elle, n'arrive jamais par ici.
  if (!reglages?.actif) return "ok";

  const profil = profilDe(reglages.profil);
  if (!profil) {
    console.error("Agent : profil inconnu pour une organisation", orgId);
    return "ok";
  }

  const lu = invitationCalendly.safeParse(message.payload);
  if (!lu.success) return "ok"; // Radar a déjà noté la forme inattendue.
  const invite = lu.data;

  if (message.event === "invitee.canceled") return annulation(admin, orgId, invite);
  if (message.event !== "invitee.created") return "ok";

  const type = invite.scheduled_event.event_type;
  if (!type || !reglages.types_suivis.includes(type)) return "ok";

  const recuLe = message.created_at ?? new Date().toISOString();
  const deplacee = await retrouverDeplacement(admin, orgId, invite);
  if (deplacee === "erreur") return "erreur";
  if (deplacee) return deplacer(admin, orgId, deplacee, invite);

  return ouvrir(admin, orgId, profil, invite, {
    delaiMinimumMs: intervalleMs(reglages.delai_minimum),
    recuLe,
    simulation: false,
  });
}

/**
 * Ouvrir la conversation d'une nouvelle réservation. Idempotent : Calendly
 * rejoue ses messages, et `invitee_uri` est unique.
 */
export async function ouvrir(
  admin: Admin,
  orgId: string,
  profil: Profil,
  invite: InvitationCalendly,
  options: { delaiMinimumMs: number; recuLe: string; simulation: boolean },
): Promise<Issue> {
  const conversation = lireReservation(invite, profil, options);

  // Le rendez-vous de Radar, s'il existe : la route l'a écrit juste avant.
  const booking = options.simulation
    ? null
    : (
        await admin
          .from("radar_bookings")
          .select("id")
          .eq("organization_id", orgId)
          .eq("invitee_uri", invite.uri)
          .maybeSingle()
      ).data;

  const { error } = await admin.from("agent_conversations").insert({
    ...conversation,
    organization_id: orgId,
    simulation: options.simulation,
    booking_id: booking?.id ?? null,
  });

  if (!error || error.code === "23505") return "ok";
  console.error("Agent : conversation non ouverte", error.code);
  return "erreur";
}

/**
 * Cette réservation en remplace-t-elle une que l'agent suit déjà ?
 *
 * Deux cas. Elle a déplacé elle-même son rendez-vous par le lien de Calendly :
 * le message porte `old_invitee`. Ou c'est l'agent qui vient de réserver à sa
 * place : l'API ne dit rien de l'ancien, mais la conversation attend un
 * rendez-vous à cette heure-là, pour cet email.
 */
async function retrouverDeplacement(
  admin: Admin,
  orgId: string,
  invite: InvitationCalendly,
): Promise<string | null | "erreur"> {
  if (invite.old_invitee) {
    const { data, error } = await admin
      .from("agent_conversations")
      .select("id")
      .eq("organization_id", orgId)
      .eq("invitee_uri", invite.old_invitee)
      .maybeSingle();
    if (error) return "erreur";
    if (data) return data.id;
  }

  const { data, error } = await admin
    .from("agent_conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("email", invite.email)
    .eq("report_attendu", invite.scheduled_event.start_time)
    .limit(1)
    .maybeSingle();
  if (error) return "erreur";
  return data?.id ?? null;
}

/**
 * Le rendez-vous change, la conversation continue.
 *
 * Le nouveau créneau, c'est elle qui l'a choisi (par le lien ou en répondant
 * à l'agent) : il vaut confirmation. Les rappels repartent de cette date.
 */
async function deplacer(
  admin: Admin,
  orgId: string,
  id: string,
  invite: InvitationCalendly,
): Promise<Issue> {
  const [{ data: actuelle, error: lecture }, { data: booking }] = await Promise.all([
    admin
      .from("agent_conversations")
      .select("invitee_uri, invites_precedents")
      .eq("id", id)
      .single(),
    admin
      .from("radar_bookings")
      .select("id")
      .eq("organization_id", orgId)
      .eq("invitee_uri", invite.uri)
      .maybeSingle(),
  ]);
  if (lecture || !actuelle) return "erreur";

  // Déjà fait : Calendly a rejoué le message.
  if (actuelle.invitee_uri === invite.uri) return "ok";

  const { error } = await admin
    .from("agent_conversations")
    .update({
      invitee_uri: invite.uri,
      invites_precedents: [...actuelle.invites_precedents, actuelle.invitee_uri],
      event_uri: invite.scheduled_event.uri,
      booking_id: booking?.id ?? null,
      rdv_debut: invite.scheduled_event.start_time,
      rdv_fin: invite.scheduled_event.end_time,
      lien_visio: invite.scheduled_event.location?.join_url ?? null,
      lien_report: invite.reschedule_url ?? null,
      lien_annulation: invite.cancel_url ?? null,
      etat: "active",
      confirme_le: new Date().toISOString(),
      sans_reponse_veille: false,
      report_attendu: null,
      efface_apres: effaceApres(invite.scheduled_event.end_time),
    })
    .eq("id", id);

  return error ? "erreur" : "ok";
}

/**
 * Une annulation dans Calendly.
 *
 * Celle d'un rendez-vous déplacé n'en est pas une : soit elle a pris un autre
 * créneau par le lien (`rescheduled`), soit c'est l'agent qui a annulé
 * l'ancien après avoir réservé le nouveau (l'invité est déjà dans
 * `invites_precedents`). Le reste arrête la conversation, sans un mot de plus.
 */
async function annulation(
  admin: Admin,
  orgId: string,
  invite: InvitationCalendly,
): Promise<Issue> {
  if (invite.rescheduled) return "ok";

  const { error } = await admin
    .from("agent_conversations")
    .update({ etat: "annulee" })
    .eq("organization_id", orgId)
    .eq("invitee_uri", invite.uri)
    .in("etat", ["active", "hors_champ"]);

  return error ? "erreur" : "ok";
}
