import {
  dimancheDeLaSemaine,
  jourParis,
  lundiDeLaSemaine,
} from "../../lib/dates.ts";

import {
  MINIMUM_MINUTES,
  PAS_MINUTES,
  type ClientPulsar,
  type Entree,
  type Phase,
} from "./types.ts";

/**
 * Le temps, tel que Pulsar le compte.
 *
 * Tout est ici parce que tout est décidable sans la base : arrondir un
 * chronomètre, additionner une journée, décider de quelle semaine relève une
 * entrée. Ce sont les endroits où une erreur ne se voit pas — quinze minutes
 * de trop par jour font une journée par mois — et ils se vérifient en
 * quelques microsecondes sous `node --test` plutôt qu'en regardant l'écran.
 *
 * Les jours sont des chaînes « 2026-09-12 » calculées par `jourParis` : une
 * fois le fuseau tranché là-bas, plus rien ici ne refait d'arithmétique de
 * fuseau.
 */

/**
 * Le quart d'heure supérieur, minimum un quart d'heure.
 *
 * Sept minutes valent quinze, seize en valent trente. C'est un carnet de
 * rentabilité, pas un pointeau : on facture par tranches, et une tâche de
 * trois minutes coûte de toute façon le temps de s'y mettre.
 *
 * Un chronomètre lancé puis arrêté à l'envers — horloge du téléphone qui
 * recule, entrée reprise après coup — rend quinze minutes plutôt qu'un
 * nombre négatif que la base refuserait.
 */
export function arrondirQuartHeure(millisecondes: number): number {
  const quarts = Math.ceil(millisecondes / 60_000 / PAS_MINUTES);
  return Math.max(MINIMUM_MINUTES, quarts * PAS_MINUTES);
}

/** « 1 h 15 », « 45 min », « 2 h ». */
export function formatDuree(minutes: number): string {
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;

  if (heures === 0) return `${reste} min`;
  if (reste === 0) return `${heures} h`;
  return `${heures} h ${String(reste).padStart(2, "0")}`;
}

/**
 * « 0:07:12 » — le compteur qui défile pendant qu'un chronomètre tourne.
 *
 * Les secondes y sont, alors qu'elles ne comptent pour rien dans l'entrée
 * finale : c'est le seul signe qu'il tourne vraiment. Une durée figée à la
 * minute ressemble à une page qui a planté.
 */
export function formatChrono(millisecondes: number): string {
  const total = Math.max(0, Math.floor(millisecondes / 1000));
  const heures = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secondes = total % 60;

  return `${heures}:${String(minutes).padStart(2, "0")}:${String(secondes).padStart(2, "0")}`;
}

/**
 * La phase que portera une entrée créée maintenant pour ce client.
 *
 * Copiée une fois, à la saisie, et jamais recalculée : c'est ce qui rend
 * honnête la répartition setup/pilotage d'un client passé en pilotage en
 * cours de mois.
 *
 * Un client terminé n'apparaît plus dans les listes du chronomètre, et les
 * actions le refusent ; s'il en arrivait un quand même, ses heures iraient au
 * pilotage — un client qu'on a fini d'accompagner a forcément fini son setup.
 */
export function phaseDuClient(client: Pick<ClientPulsar, "is_internal" | "statut">): Phase {
  if (client.is_internal) return "interne";
  return client.statut === "setup" ? "setup" : "pilotage";
}

/** Les minutes comptées d'un lot d'entrées. Celle qui tourne ne compte pas. */
export function totalMinutes(entrees: Pick<Entree, "duration_minutes">[]): number {
  return entrees.reduce((somme, entree) => somme + (entree.duration_minutes ?? 0), 0);
}

/** Les entrées d'un jour parisien donné, dans l'ordre où elles arrivent. */
export function entreesDuJour<T extends Pick<Entree, "started_at">>(
  entrees: T[],
  jour: string,
): T[] {
  return entrees.filter((entree) => jourParis(entree.started_at) === jour);
}

/**
 * Les entrées de la semaine d'un jour donné, lundi à dimanche.
 *
 * Comparaison de chaînes de dates : « 2026-09-07 » ≤ « 2026-09-12 » se lit
 * caractère par caractère et dit la vérité pour tout l'ISO. Pas de dimanche
 * qui bascule, pas d'heure d'été.
 */
export function entreesDeLaSemaine<T extends Pick<Entree, "started_at">>(
  entrees: T[],
  jour: string,
): T[] {
  const lundi = lundiDeLaSemaine(jour);
  const dimanche = dimancheDeLaSemaine(jour);

  return entrees.filter((entree) => {
    const leJour = jourParis(entree.started_at);
    return leJour >= lundi && leJour <= dimanche;
  });
}
