import { heureEnMots, jourEnMots, jourLocal } from "./temps.ts";

/**
 * Quels créneaux lui proposer quand elle doit changer.
 *
 * P12 : garder la journée d'abord (« juste l'heure, ou toute la journée ? »),
 * puis les créneaux libres les plus proches, trois au plus. Calendly découpe
 * l'agenda de Peggy au quart d'heure : les trois « plus proches » au sens
 * strict seraient 9h30, 9h45 et 10h le même matin, trois fois le même choix.
 * On en prend donc un par demi-journée, dans l'ordre : elle a un vrai choix,
 * et le plus proche reste en tête.
 */

export const NOMBRE = 3;
/** Pas de créneau qui commence dans moins de deux heures. */
export const DELAI_MINIMUM_MS = 2 * 3_600_000;

export type Choix = {
  /** Le même jour que son rendez-vous, au plus près de l'heure prévue. */
  memeJour: string[];
  /** Les plus proches, une demi-journée chacun, hors du jour du rendez-vous. */
  plusProches: string[];
};

function demiJournee(instant: string, fuseau: string): string {
  const heure = Number(heureEnMots(instant, fuseau).split("h")[0]);
  return `${jourLocal(instant, fuseau)}:${heure < 12 ? "matin" : "apres-midi"}`;
}

export function choisirCreneaux(
  libres: string[],
  rdvActuel: string,
  fuseau: string,
  maintenant: number,
): Choix {
  const actuel = Date.parse(rdvActuel);
  const possibles = [...new Set(libres)]
    .filter((c) => Date.parse(c) >= maintenant + DELAI_MINIMUM_MS && Date.parse(c) !== actuel)
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  const jour = jourLocal(rdvActuel, fuseau);
  const memeJour = possibles
    .filter((c) => jourLocal(c, fuseau) === jour)
    .sort((a, b) => Math.abs(Date.parse(a) - actuel) - Math.abs(Date.parse(b) - actuel))
    .slice(0, NOMBRE)
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  const vues = new Set<string>();
  const plusProches: string[] = [];
  // Le jour du rendez-vous a sa propre liste : si elle ne peut pas ce
  // jour-là, les « plus proches » ne doivent pas le lui reproposer.
  for (const c of possibles.filter((p) => jourLocal(p, fuseau) !== jour)) {
    const moment = demiJournee(c, fuseau);
    if (vues.has(moment)) continue;
    vues.add(moment);
    plusProches.push(c);
    if (plusProches.length === NOMBRE) break;
  }

  return { memeJour, plusProches };
}

/** « jeudi 8 octobre à 9h30 (2026-10-08T07:30:00.000Z) » : lisible, et retrouvable. */
export function creneauEnMots(instant: string, fuseau: string): string {
  return `${jourEnMots(instant, fuseau)} à ${heureEnMots(instant, fuseau)} (${new Date(instant).toISOString()})`;
}
