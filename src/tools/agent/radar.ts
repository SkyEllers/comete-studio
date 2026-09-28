import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { NOTE_ANNULEE_AGENT } from "@/tools/reservation/radar";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Ce que Radar demande à l'agent : un rendez-vous que l'agent a déplacé.
 *
 * Quand la cliente déplace elle-même son rendez-vous par le lien de Calendly,
 * le message le dit (`rescheduled`, `old_invitee`) et Radar sait faire :
 * l'ancien est « reprogrammé », le nouveau hérite du canal et de la
 * closeuse. Quand c'est l'agent qui déplace (il réserve le nouveau avec le
 * jeton du client, puis annule l'ancien), Calendly n'en dit rien : il
 * annonce une annulation par l'hôte et une réservation neuve. Sans ces deux
 * fonctions, Radar compterait une annulation du client et une nouvelle
 * acquisition sans canal.
 *
 * Aucun email ici : Radar n'en garde pas au-delà de sa clé, et l'agent
 * reconnaît son report par l'invité et l'heure, pas par la personne.
 */

/**
 * La réservation qui arrive est-elle celle que l'agent vient de faire ? Si
 * oui, rend l'invité qu'elle remplace.
 *
 * Deux moments possibles : l'agent attend encore ce créneau
 * (`report_attendu`), ou il a déjà basculé la conversation sur le nouvel
 * invité (l'ancien est alors le dernier de `invites_precedents`).
 */
export async function ancienDuReport(
  admin: Admin,
  orgId: string,
  invite: { uri: string; debut: string },
): Promise<string | null> {
  const { data } = await admin
    .from("agent_conversations")
    .select("invitee_uri, invites_precedents, report_attendu, reports_agent")
    .eq("organization_id", orgId)
    .eq("simulation", false)
    .or(`invitee_uri.eq."${invite.uri.replace(/"/g, "")}",report_attendu.eq."${invite.debut.replace(/"/g, "")}"`)
    .limit(2);

  for (const c of data ?? []) {
    if (c.invitee_uri === invite.uri) {
      if (c.reports_agent > 0 && c.invites_precedents.length > 0) return c.invites_precedents.at(-1) ?? null;
    } else if (c.report_attendu && Date.parse(c.report_attendu) === Date.parse(invite.debut)) {
      return c.invitee_uri;
    }
  }
  return null;
}

/**
 * L'annulation qui arrive est-elle celle que l'agent vient de faire, à sa
 * demande (0048) ? Calendly l'annonce comme une annulation par l'hôte ; c'est
 * pourtant elle qui annule.
 */
export async function annuleeParAgent(admin: Admin, orgId: string, uri: string): Promise<boolean> {
  const { data } = await admin
    .from("agent_conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("simulation", false)
    .eq("invitee_uri", uri)
    .not("annulee_par_agent_le", "is", null)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/** Sa raison, rangée, ajoutée à la note de Radar : rien de ce qu'elle a écrit, seulement la catégorie. */
export async function raisonDansRadar(
  admin: Admin,
  orgId: string,
  bookingId: string,
  libelle: string,
): Promise<void> {
  await admin
    .from("radar_bookings")
    .update({ status_note: `${NOTE_ANNULEE_AGENT} : ${libelle}`, updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("organization_id", orgId)
    .eq("status", "annule");
}

/** L'annulation qui arrive est-elle celle d'un rendez-vous que l'agent a déplacé ? */
export async function annuleParLeReport(admin: Admin, orgId: string, uri: string): Promise<boolean> {
  const { data } = await admin
    .from("agent_conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("simulation", false)
    .gt("reports_agent", 0)
    .contains("invites_precedents", [uri])
    .limit(1);
  return (data?.length ?? 0) > 0;
}
