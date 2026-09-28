import type { Depot } from "../reservation/moteur.ts";

import { FIN_VEILLE, HEURE_JOURNEE } from "./planning.ts";
import type { InvitationCalendly } from "./reservation.ts";
import { ajouterJours, instantLocal, jourLocal } from "./temps.ts";

/**
 * Un rendez-vous de l'outil de réservation maison, lu comme l'agent lit une
 * réservation Calendly.
 *
 * L'agent a été construit sur le message de Calendly (`reservation.ts`) :
 * plutôt que de lui apprendre une deuxième forme, on traduit. Les adresses
 * valent `reservation:<id du rendez-vous>`, comme dans Radar (`uriRadar`) :
 * c'est à ce préfixe que l'agent reconnaît un rendez-vous de l'outil, pour
 * lire les créneaux et déplacer par le moteur plutôt que par Calendly.
 *
 * Fonctions pures : pas de base, pas de réseau.
 */

export const PREFIXE_OUTIL = "reservation:";
/** Le type de séance des rendez-vous de l'outil, le même que dans Radar. */
export const TYPE_OUTIL = "reservation:diagnostic";

export const uriOutil = (rdvId: string) => `${PREFIXE_OUTIL}${rdvId}`;

export function estDeLOutil(uri: string | null | undefined): boolean {
  return typeof uri === "string" && uri.startsWith(PREFIXE_OUTIL);
}

/** L'id du rendez-vous derrière `reservation:<id>`, ou null. */
export function idOutil(uri: string | null | undefined): string | null {
  if (!estDeLOutil(uri)) return null;
  const id = (uri as string).slice(PREFIXE_OUTIL.length);
  return id ? id : null;
}

/**
 * Le lien personnel de la cliente (`/mon-rdv/#<jeton>`) sur le site du
 * profil. Le jeton n'est connu en clair qu'au moment où la route le tire ou le
 * reçoit : la base n'en garde que l'empreinte. Sans site connu, pas de lien.
 */
export function lienMonRdv(urlSite: string | null, jeton: string | null): string | null {
  if (!urlSite || !jeton) return null;
  try {
    return `${new URL("/mon-rdv/", urlSite).toString()}#${jeton}`;
  } catch {
    return null;
  }
}

/**
 * Le jeton en clair et l'adresse du site, lus dans le lien personnel
 * (`https://www.peggygirault.fr/mon-rdv/#<jeton>`). Null si le lien n'a pas
 * cette forme.
 */
export function lireLienPersonnel(lien: string | null): { site: string; jeton: string } | null {
  if (!lien) return null;
  try {
    const u = new URL(lien);
    const jeton = u.hash.slice(1);
    if (u.protocol !== "https:" || u.pathname !== "/mon-rdv/" || !/^[0-9a-f]{64}$/.test(jeton)) return null;
    return { site: u.origin, jeton };
  } catch {
    return null;
  }
}

/**
 * Le mail de la veille à celle qui a dit STOP (Louis, 27/09/2026) : le jour
 * d'avant le rendez-vous, dans son fuseau, entre 10h et 21h, comme le rappel
 * de la veille qu'elle ne reçoit plus. Une seule fois (`veille_mail_le`).
 */
export function veilleMailDue(
  c: { rdv_debut: string; fuseau: string; veille_mail_le: string | null },
  maintenant: number,
): boolean {
  if (c.veille_mail_le) return false;
  const debut = Date.parse(c.rdv_debut);
  if (maintenant >= debut) return false;
  const veille = ajouterJours(jourLocal(debut, c.fuseau), -1);
  if (jourLocal(maintenant, c.fuseau) !== veille) return false;
  return (
    maintenant >= instantLocal(veille, HEURE_JOURNEE, 0, c.fuseau) &&
    maintenant < instantLocal(veille, FIN_VEILLE, 0, c.fuseau)
  );
}

/**
 * Le dépôt du moteur, mais la fenêtre ouverte d'un coup jusqu'au maximum.
 *
 * La page s'arrête à la première fenêtre qui a des créneaux (4 jours, puis
 * 6…). L'agent, pour proposer un report, veut aussi le jour du rendez-vous,
 * parfois à trois semaines : il lit tout.
 */
export function fenetreEntiere(depot: Depot): Depot {
  return {
    ...depot,
    async reglages(org) {
      const r = await depot.reglages(org);
      return r ? { ...r, fenetreJours: r.fenetreMaxJours } : r;
    },
  };
}

export type RdvOutil = {
  id: string;
  debut: string;
  fin: string;
  created_at: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  fuseau_cliente: string;
  lien_visio: string | null;
  reponses: unknown;
};

function iso(t: string): string {
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? t : new Date(ms).toISOString();
}

/** Les réponses de l'outil (`{ question, reponse }`), sous la forme de Calendly. */
function reponsesDe(brut: unknown): { question: string; answer: string; position: number }[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter(
      (r): r is { question: string; reponse: string } =>
        typeof r === "object" && r !== null && typeof r.question === "string" && typeof r.reponse === "string",
    )
    .map((r, i) => ({ question: r.question, answer: r.reponse, position: i }));
}

export function invitationDepuisRdv(
  rdv: RdvOutil,
  options: { lienPersonnel: string | null; ancienRdvId?: string | null },
): InvitationCalendly {
  const uri = uriOutil(rdv.id);
  return {
    uri,
    email: rdv.email ?? "",
    first_name: rdv.prenom,
    last_name: rdv.nom,
    created_at: iso(rdv.created_at),
    timezone: rdv.fuseau_cliente,
    text_reminder_number: rdv.telephone,
    // Déplacer ou annuler, c'est la même page : `/mon-rdv/`.
    reschedule_url: options.lienPersonnel,
    cancel_url: options.lienPersonnel,
    rescheduled: false,
    old_invitee: options.ancienRdvId ? uriOutil(options.ancienRdvId) : null,
    questions_and_answers: reponsesDe(rdv.reponses),
    scheduled_event: {
      uri,
      start_time: iso(rdv.debut),
      end_time: iso(rdv.fin),
      event_type: TYPE_OUTIL,
      location: { type: "lien", join_url: rdv.lien_visio, location: null },
    },
    cancellation: null,
  };
}
