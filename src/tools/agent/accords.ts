import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { empreinte, FORMAT_JETON } from "./accords-regles.ts";
import { jetonAgent, lireInvitation } from "./calendly.ts";
import { ouvrir } from "./conversations.ts";
import { profil as profilDe } from "./profils/index.ts";
import { intervalleMs } from "./temps.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * L'accord WhatsApp des clientes réservées avant le lancement (0046).
 *
 * Elle reçoit un lien personnel par mail ; la page montre son rendez-vous et
 * un bouton. Le bouton note l'accord (`accepte_le`, la preuve). L'agent ouvre
 * sa conversation dès que le canal du client est WhatsApp : tout de suite
 * après le lancement, ou au premier passage de l'horloge qui suit.
 */

export type Accord = {
  id: string;
  organization_id: string;
  invitee_uri: string;
  rdv_debut: string;
  fin_numero: string | null;
  accepte_le: string | null;
  conversation_id: string | null;
};

const COLONNES = "id, organization_id, invitee_uri, rdv_debut, fin_numero, accepte_le, conversation_id";

/** Le lien est-il valable ? `null` si le jeton est inconnu, mal formé ou le rendez-vous passé. */
export async function lireAccord(admin: Admin, jeton: string): Promise<Accord | null> {
  if (!FORMAT_JETON.test(jeton)) return null;
  const { data } = await admin
    .from("agent_accords")
    .select(COLONNES)
    .eq("jeton_sha256", empreinte(jeton))
    .maybeSingle();
  if (!data || Date.parse(data.rdv_debut) <= Date.now()) return null;
  return data;
}

/** Elle a cliqué « Oui ». Rend l'accord à jour, ou `null` si le lien ne vaut rien. */
export async function accepter(admin: Admin, jeton: string): Promise<Accord | null> {
  const accord = await lireAccord(admin, jeton);
  if (!accord) return null;
  if (!accord.accepte_le) {
    await admin
      .from("agent_accords")
      .update({ accepte_le: new Date().toISOString() })
      .eq("id", accord.id)
      .is("accepte_le", null);
  }
  await ouvrirAccords(admin, accord.id);
  return lireAccord(admin, jeton);
}

/**
 * Ouvrir la conversation des accords donnés qui n'en ont pas encore, chez les
 * clients dont le canal est WhatsApp. Relit chaque invité dans Calendly : un
 * rendez-vous annulé ou déplacé entre-temps n'ouvre rien. L'horloge l'appelle
 * à chaque passage ; la page, pour l'accord qu'elle vient de noter.
 */
export async function ouvrirAccords(admin: Admin, seulement?: string): Promise<number> {
  let requete = admin
    .from("agent_accords")
    .select(COLONNES)
    .not("accepte_le", "is", null)
    .is("conversation_id", null)
    .gt("rdv_debut", new Date().toISOString());
  if (seulement) requete = requete.eq("id", seulement);
  const { data: accords } = await requete;
  if (!accords?.length) return 0;

  let ouverts = 0;
  for (const a of accords) {
    const { data: r } = await admin
      .from("agent_reglages")
      .select("canal, profil, delai_minimum")
      .eq("organization_id", a.organization_id)
      .maybeSingle();
    const profil = r ? profilDe(r.profil) : null;
    if (!r || r.canal !== "whatsapp" || !profil) continue;

    const jeton = await jetonAgent(admin, a.organization_id);
    const invite = jeton ? await lireInvitation(jeton, a.invitee_uri) : null;
    if (!invite) continue;

    const issue = await ouvrir(admin, a.organization_id, profil, invite, {
      delaiMinimumMs: intervalleMs(r.delai_minimum),
      recuLe: new Date().toISOString(),
      simulation: false,
    });
    if (issue !== "ok") continue;

    const { data: c } = await admin
      .from("agent_conversations")
      .select("id")
      .eq("organization_id", a.organization_id)
      .eq("invitee_uri", a.invitee_uri)
      .eq("simulation", false)
      .maybeSingle();
    if (!c) continue;
    await admin.from("agent_accords").update({ conversation_id: c.id }).eq("id", a.id);
    ouverts++;
  }
  return ouverts;
}
