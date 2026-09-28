import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { invitationCalendly, type InvitationCalendly } from "./reservation.ts";

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

/**
 * Les débuts de créneaux libres, sur `jours` jours.
 *
 * Par tranches de 7 jours : la documentation de Calendly dit tantôt 7,
 * tantôt 31 jours au plus par demande, et 7 marche dans les deux cas. Le
 * début est pris une minute dans le futur : Calendly refuse un `start_time`
 * déjà passé quand la demande lui arrive (simulation du 28/09/2026, créneaux
 * « illisibles »). Une tranche illisible rend tout illisible : mieux vaut ne
 * rien proposer qu'une liste trouée.
 */
export async function creneauxLibres(
  jeton: string,
  typeUri: string,
  depuis: number,
  jours = 30,
): Promise<string[] | null> {
  const debut = Math.max(depuis, Date.now()) + 60_000;
  const fin = debut + Math.min(jours, 31) * JOUR_MS;
  const tranches: [number, number][] = [];
  for (let a = debut; a < fin; a += 7 * JOUR_MS) tranches.push([a, Math.min(a + 7 * JOUR_MS, fin)]);

  try {
    const lues = await Promise.all(
      tranches.map(async ([a, b]) => {
        const url =
          `${API}/event_type_available_times?event_type=${encodeURIComponent(typeUri)}` +
          `&start_time=${new Date(a).toISOString()}&end_time=${new Date(b).toISOString()}`;
        const reponse = await fetch(url, { headers: ENTETES(jeton), signal: AbortSignal.timeout(DELAI_MS) });
        if (!reponse.ok) {
          // La raison donnée par Calendly, jamais une donnée personnelle (proposition 199).
          const corps = (await reponse.json().catch(() => null)) as { message?: string } | null;
          console.error("Agent : créneaux Calendly illisibles", reponse.status, corps?.message ?? "");
          return null;
        }
        const corps = (await reponse.json()) as { collection?: { status?: string; start_time: string }[] };
        return (corps.collection ?? []).filter((c) => c.status !== "unavailable").map((c) => c.start_time);
      }),
    );
    if (lues.some((l) => l === null)) return null;
    return lues.flat() as string[];
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

    const ev = await lireEvenement(jeton, resource.event);

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

type Evenement = { start_time: string; end_time: string; location?: { join_url?: string } };

const ESSAIS_LIEN = 5;
const PAUSE_LIEN_MS = 1_500;

/**
 * Le lien Zoom et l'heure de fin sont sur l'événement, pas sur l'invité.
 *
 * Calendly pose le lien Zoom quelques secondes après la réservation : à
 * l'essai réel du 27/09/2026, il manquait à la première lecture et était là
 * à la suivante. On relit donc jusqu'à ce qu'il arrive, six secondes au plus ;
 * sans lui, on rend l'événement tel quel plutôt que rien.
 */
export async function lireEvenement(
  jeton: string,
  uri: string,
  attendre = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<Evenement | null> {
  let ev: Evenement | null = null;
  for (let essai = 0; essai < ESSAIS_LIEN; essai++) {
    if (essai > 0) await attendre(PAUSE_LIEN_MS);
    try {
      const reponse = await fetch(uri, { headers: ENTETES(jeton), signal: AbortSignal.timeout(DELAI_MS) });
      if (!reponse.ok) continue;
      ev = ((await reponse.json()) as { resource: Evenement }).resource;
      if (ev.location?.join_url) return ev;
    } catch {
      // Calendly n'a pas répondu : on retente au tour suivant.
    }
  }
  if (ev) console.error("Agent : lien visio toujours absent après la réservation");
  return ev;
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

// ------------------ Les rendez-vous déjà réservés (accords) ------------------

type EvenementCalendly = {
  uri: string;
  start_time: string;
  end_time: string;
  event_type?: string | null;
  status?: string;
  location?: { type?: string | null; join_url?: string | null; location?: string | null } | null;
};

async function lire<T>(jeton: string, url: string): Promise<T | null> {
  try {
    const reponse = await fetch(url, { headers: ENTETES(jeton), signal: AbortSignal.timeout(DELAI_MS) });
    if (!reponse.ok) {
      console.error("Agent : lecture Calendly refusée", reponse.status);
      return null;
    }
    return (await reponse.json()) as T;
  } catch {
    console.error("Agent : Calendly n'a pas répondu (lecture)");
    return null;
  }
}

/** Un invité et son événement, dans la forme du webhook (`invitationCalendly`). */
function commeLeWebhook(invite: Record<string, unknown>, ev: EvenementCalendly): InvitationCalendly | null {
  const lu = invitationCalendly.safeParse({
    ...invite,
    scheduled_event: {
      uri: ev.uri,
      start_time: ev.start_time,
      end_time: ev.end_time,
      event_type: ev.event_type ?? null,
      location: ev.location ?? null,
    },
  });
  return lu.success ? lu.data : null;
}

/** Relire un invité dans Calendly : `null` s'il n'est plus actif ou illisible. */
export async function lireInvitation(jeton: string, inviteeUri: string): Promise<InvitationCalendly | null> {
  const invite = await lire<{ resource: Record<string, unknown> & { event: string; status?: string } }>(jeton, inviteeUri);
  if (!invite || invite.resource.status !== "active") return null;
  const ev = await lire<{ resource: EvenementCalendly }>(jeton, invite.resource.event);
  if (!ev || ev.resource.status === "canceled") return null;
  return commeLeWebhook(invite.resource, ev.resource);
}

/**
 * Les invités actifs d'un type de séance, entre deux dates. Pour les
 * rendez-vous pris avant le lancement : l'agent ne les a jamais vus passer.
 */
export async function invitationsAVenir(
  jeton: string,
  typeUri: string,
  depuis: number,
  jusqua: number,
): Promise<InvitationCalendly[] | null> {
  // La personne qui tient ce type de séance, lue sur le type lui-même :
  // `/users/me` demanderait un droit de plus (`users:read`) au jeton de l'agent.
  const type = await lire<{ resource: { profile?: { owner?: string } | null } }>(jeton, typeUri);
  const proprietaire = type?.resource.profile?.owner;
  if (!proprietaire) return null;

  const resultat: InvitationCalendly[] = [];
  let page: string | null =
    `${API}/scheduled_events?user=${encodeURIComponent(proprietaire)}&status=active&count=100` +
    `&min_start_time=${new Date(depuis).toISOString()}&max_start_time=${new Date(jusqua).toISOString()}`;
  while (page) {
    const lot: { collection: EvenementCalendly[]; pagination?: { next_page?: string | null } } | null = await lire(
      jeton,
      page,
    );
    if (!lot) return null;
    for (const ev of lot.collection.filter((e) => e.event_type === typeUri)) {
      const invites = await lire<{ collection: Record<string, unknown>[] }>(jeton, `${ev.uri}/invitees?status=active`);
      if (!invites) return null;
      for (const i of invites.collection) {
        const inv = commeLeWebhook(i, ev);
        if (inv) resultat.push(inv);
      }
    }
    page = lot.pagination?.next_page ?? null;
  }
  return resultat;
}
