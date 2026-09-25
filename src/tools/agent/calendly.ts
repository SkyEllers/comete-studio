import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ce que l'agent demande à Calendly : les créneaux libres, réserver le
 * nouveau à la place de la cliente, annuler l'ancien.
 *
 * Avec son propre jeton (Vault, `agent:<org>:calendly_token`, migration
 * 0033), jamais celui de Radar : `event_types:read` et
 * `scheduled_events:write`, rien d'autre. Réserver par l'API demande un
 * forfait Calendly payant ; celui de Peggy l'est (Standard, 16/09/2026).
 *
 * Calendly n'a pas de « déplacer » dans son API : on réserve le nouveau,
 * puis on annule l'ancien. Dans cet ordre, pour qu'une panne entre les deux
 * laisse deux rendez-vous plutôt qu'aucun.
 *
 * Ne lève jamais : chaque fonction rend `null` ou `{ ok: false }`, et
 * l'appelant fait monter la question chez Louis.
 */

type Admin = ReturnType<typeof createAdminClient>;

const API = "https://api.calendly.com";
const ENTETES = (jeton: string) => ({
  Authorization: `Bearer ${jeton}`,
  "Content-Type": "application/json",
  // Calendly a déjà refusé l'en-tête par défaut d'un client HTTP (vault,
  // proposition 166) : on se présente.
  "User-Agent": "comete-hub-agent/1.0",
});
const DELAI_MS = 15_000;
const JOUR_MS = 86_400_000;

export async function jetonAgent(admin: Admin, orgId: string): Promise<string | null> {
  const { data } = await admin.rpc("agent_get_secret", { org: orgId, kind: "calendly_token" });
  return data ?? null;
}

/** Les débuts de créneaux libres, sur au plus 31 jours (limite de Calendly). */
export async function creneauxLibres(
  jeton: string,
  typeUri: string,
  depuis: number,
  jours = 30,
): Promise<string[] | null> {
  const fin = depuis + Math.min(jours, 31) * JOUR_MS - 60_000;
  const url =
    `${API}/event_type_available_times?event_type=${encodeURIComponent(typeUri)}` +
    `&start_time=${new Date(depuis).toISOString()}&end_time=${new Date(fin).toISOString()}`;
  try {
    const reponse = await fetch(url, { headers: ENTETES(jeton), signal: AbortSignal.timeout(DELAI_MS) });
    if (!reponse.ok) {
      console.error("Agent : créneaux Calendly illisibles", reponse.status);
      return null;
    }
    const corps = (await reponse.json()) as { collection?: { status?: string; start_time: string }[] };
    return (corps.collection ?? []).filter((c) => c.status !== "unavailable").map((c) => c.start_time);
  } catch {
    console.error("Agent : Calendly n'a pas répondu (créneaux)");
    return null;
  }
}

export type Reservation = {
  typeUri: string;
  debut: string;
  prenom: string;
  nom: string | null;
  email: string;
  fuseau: string;
  reponses: { question: string; answer: string; position: number | null }[];
};

export type Reserve = {
  inviteeUri: string;
  eventUri: string;
  debut: string;
  fin: string;
  lienVisio: string | null;
  lienReport: string | null;
  lienAnnulation: string | null;
};

/**
 * Réserver le créneau choisi, à son nom, avec ses réponses au formulaire
 * recopiées de la première réservation (elles sont obligatoires chez Peggy).
 * Calendly envoie lui-même ses mails de confirmation, comme pour une
 * réservation faite par elle.
 */
export async function reserver(jeton: string, r: Reservation): Promise<Reserve | null> {
  try {
    const reponse = await fetch(`${API}/invitees`, {
      method: "POST",
      headers: ENTETES(jeton),
      signal: AbortSignal.timeout(DELAI_MS),
      body: JSON.stringify({
        event_type: r.typeUri,
        start_time: new Date(r.debut).toISOString(),
        invitee: {
          name: [r.prenom, r.nom].filter(Boolean).join(" "),
          first_name: r.prenom,
          ...(r.nom ? { last_name: r.nom } : {}),
          email: r.email,
          timezone: r.fuseau,
        },
        location: { kind: "zoom_conference" },
        questions_and_answers: r.reponses
          .filter((q) => q.answer.trim())
          .map((q, i) => ({ question: q.question, answer: q.answer, position: q.position ?? i })),
      }),
    });
    if (!reponse.ok) {
      console.error("Agent : réservation refusée par Calendly", reponse.status);
      return null;
    }
    const { resource } = (await reponse.json()) as {
      resource: { uri: string; event: string; cancel_url?: string; reschedule_url?: string };
    };

    // Le lien Zoom et l'heure de fin sont sur l'événement, pas sur l'invité.
    const evenement = await fetch(resource.event, {
      headers: ENTETES(jeton),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    const ev = evenement.ok
      ? ((await evenement.json()) as {
          resource: { start_time: string; end_time: string; location?: { join_url?: string } };
        }).resource
      : null;

    return {
      inviteeUri: resource.uri,
      eventUri: resource.event,
      debut: ev?.start_time ?? new Date(r.debut).toISOString(),
      fin: ev?.end_time ?? new Date(Date.parse(r.debut) + 45 * 60_000).toISOString(),
      lienVisio: ev?.location?.join_url ?? null,
      lienReport: resource.reschedule_url ?? null,
      lienAnnulation: resource.cancel_url ?? null,
    };
  } catch {
    console.error("Agent : Calendly n'a pas répondu (réservation)");
    return null;
  }
}

/** Annuler l'ancien rendez-vous, une fois le nouveau pris. */
export async function annulerAncien(jeton: string, eventUri: string, raison: string): Promise<boolean> {
  try {
    const reponse = await fetch(`${eventUri}/cancellation`, {
      method: "POST",
      headers: ENTETES(jeton),
      signal: AbortSignal.timeout(DELAI_MS),
      body: JSON.stringify({ reason: raison }),
    });
    if (!reponse.ok) console.error("Agent : annulation refusée par Calendly", reponse.status);
    return reponse.ok;
  } catch {
    console.error("Agent : Calendly n'a pas répondu (annulation)");
    return false;
  }
}
