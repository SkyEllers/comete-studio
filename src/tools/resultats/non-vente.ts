/**
 * « Pas de vente » : pourquoi, et quand en reparler.
 *
 * Le client dit pourquoi une séance honorée n'a pas vendu, et, si la personne
 * a donné une date, le mois où la recontacter. Le tout s'écrit par
 * `radar_note_non_vente` et vit dans les activités (`sale.reason`), comme
 * l'appel de la veille : la dernière réponse fait foi. « C'est fait » s'écrit
 * par `radar_recontact_fait` (`recontact.done`).
 *
 * Ce module ne fait que lire : il est pur, et c'est ce qui le rend testable
 * sans base.
 */

import { moisSuivant } from "./mois.ts";

export type Motif = "argent" | "moment" | "conjoint" | "pas_convaincue" | "autre";

export const MOTIFS: readonly Motif[] = ["argent", "moment", "conjoint", "pas_convaincue", "autre"];

export const LIBELLES_MOTIF: Record<Motif, string> = {
  argent: "L'argent",
  moment: "Pas le bon moment",
  conjoint: "Le conjoint",
  pas_convaincue: "Pas convaincue",
  autre: "Autre",
};

export const TYPES_NON_VENTE = ["sale.reason", "recontact.done"];

export type Raison = {
  motif: Motif;
  /** Le premier du mois, « 2026-11-01 », ou null si la personne n'a pas dit quand. */
  recontacter: string | null;
  noteeLe: string;
};

type ActiviteLue = { type: string; payload: unknown; created_at: string };

function lireRaison(activite: ActiviteLue): Raison | null {
  const payload = activite.payload as { motif?: unknown; recontacter?: unknown } | null;
  const motif = payload?.motif;
  if (typeof motif !== "string" || !(MOTIFS as readonly string[]).includes(motif)) return null;
  const recontacter =
    typeof payload?.recontacter === "string" && /^\d{4}-\d{2}-01$/.test(payload.recontacter)
      ? payload.recontacter
      : null;
  return { motif: motif as Motif, recontacter, noteeLe: activite.created_at };
}

/** La dernière raison notée pour un rendez-vous, ou null. */
export function derniereRaison(activites: ActiviteLue[]): Raison | null {
  let retenue: ActiviteLue | null = null;
  for (const activite of activites) {
    if (activite.type !== "sale.reason") continue;
    if (!retenue || Date.parse(activite.created_at) > Date.parse(retenue.created_at)) {
      retenue = activite;
    }
  }
  return retenue ? lireRaison(retenue) : null;
}

export type EtatRecontact = {
  raison: Raison;
  /** Vrai si « C'est fait » a été noté après la dernière raison. */
  fait: boolean;
};

/** La dernière raison de chaque rendez-vous, et si le rappel a été fait depuis. */
export function etatsParRendezVous(
  activites: (ActiviteLue & { booking_id: string })[],
): Record<string, EtatRecontact> {
  const groupees = new Map<string, ActiviteLue[]>();
  for (const activite of activites) {
    groupees.set(activite.booking_id, [...(groupees.get(activite.booking_id) ?? []), activite]);
  }

  const etats: Record<string, EtatRecontact> = {};
  for (const [id, liste] of groupees) {
    const raison = derniereRaison(liste);
    if (!raison) continue;
    const fait = liste.some(
      (activite) =>
        activite.type === "recontact.done" &&
        Date.parse(activite.created_at) >= Date.parse(raison.noteeLe),
    );
    etats[id] = { raison, fait };
  }
  return etats;
}

/**
 * Qui recontacter maintenant : le mois prévu est arrivé (ou passé), et
 * personne n'a encore dit « c'est fait ». Du plus ancien rappel au plus
 * récent : celui qui attend depuis le plus longtemps d'abord.
 */
export function aRecontacter(
  etats: Record<string, EtatRecontact>,
  moisCourant: string,
): { id: string; raison: Raison }[] {
  return Object.entries(etats)
    .filter(
      ([, etat]) =>
        !etat.fait && etat.raison.recontacter !== null && etat.raison.recontacter <= moisCourant,
    )
    .map(([id, etat]) => ({ id, raison: etat.raison }))
    .sort(
      (a, b) =>
        (a.raison.recontacter ?? "").localeCompare(b.raison.recontacter ?? "") ||
        a.raison.noteeLe.localeCompare(b.raison.noteeLe),
    );
}

/** Combien sont prévues pour un mois à venir : le tableau de bord le dit en une ligne. */
export function nombrePlusTard(etats: Record<string, EtatRecontact>, moisCourant: string): number {
  return Object.values(etats).filter(
    (etat) => !etat.fait && etat.raison.recontacter !== null && etat.raison.recontacter > moisCourant,
  ).length;
}

/**
 * Les mois qu'on propose : celui-ci et les douze suivants. La base refuse
 * au-delà de deux ans ; un an suffit à « je reviens à la rentrée prochaine ».
 */
export function moisProposes(moisCourant: string, nombre = 13): string[] {
  const serie = [moisCourant];
  while (serie.length < nombre) serie.push(moisSuivant(serie[serie.length - 1]!));
  return serie;
}
