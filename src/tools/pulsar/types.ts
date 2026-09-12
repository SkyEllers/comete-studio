/**
 * Le vocabulaire de Pulsar, partagé par le serveur et le navigateur.
 *
 * Les unions sont écrites à la main plutôt qu'importées des types générés :
 * les modules de calcul se déroulent sous `node --test`, sans bundler et sans
 * alias `@/`. La base reste l'autorité — `queries.ts` range ses lignes dans
 * ces types-là, et le jour où un enum bougerait sans qu'on suive, c'est cette
 * assignation qui ne compilerait plus.
 */

/** Les huit types de tâche, figés par la migration. */
export type Tache =
  | "site"
  | "ads"
  | "emails"
  | "tracking"
  | "reunion"
  | "seo"
  | "prospection"
  | "admin";

/** La phase figée sur l'entrée, et le statut du client dont elle est tirée. */
export type Phase = "setup" | "pilotage" | "interne";
export type Statut = "setup" | "pilotage" | "termine";

/**
 * Les libellés, dans l'ordre des puces.
 *
 * L'ordre est celui du travail, pas l'alphabet : ce qu'on chronomètre le plus
 * souvent est sous le pouce en premier. « Comète » — prospection et admin —
 * ferme la marche, parce qu'on la démarre moins souvent qu'on ne la subit.
 */
export const TACHES: { valeur: Tache; label: string }[] = [
  { valeur: "site", label: "Site" },
  { valeur: "ads", label: "Ads" },
  { valeur: "emails", label: "Emails" },
  { valeur: "tracking", label: "Tracking" },
  { valeur: "seo", label: "SEO" },
  { valeur: "reunion", label: "Réunion" },
  { valeur: "prospection", label: "Prospection" },
  { valeur: "admin", label: "Admin" },
];

const LABELS = new Map(TACHES.map((tache) => [tache.valeur, tache.label]));

export function libelleTache(tache: Tache): string {
  return LABELS.get(tache) ?? tache;
}

/** Le pas de saisie, et le plancher : la base impose les deux. */
export const PAS_MINUTES = 15;
export const MINIMUM_MINUTES = 15;

/** La valeur qui s'affiche par défaut dans la saisie manuelle. */
export const DEFAUT_MANUEL = 30;

/**
 * Le plafond d'une saisie manuelle : douze heures.
 *
 * La base ne le demande pas — c'est une politesse envers le pouce. Un zéro de
 * trop sur un téléphone fait 3 000 minutes, et rien dans les écrans ne
 * signalerait cette journée de cinquante heures avant la fin du mois.
 */
export const MAXIMUM_MANUEL = 12 * 60;

/** La note d'une entrée, plafonnée par la base. */
export const LIMITE_NOTE = 200;

/** Un client, tel que les écrans de chronométrage le manipulent. */
export type ClientPulsar = {
  id: string;
  name: string;
  is_internal: boolean;
  statut: Statut;
};

/** Une entrée terminée, ou en marche — `duration_minutes` tranche. */
export type Entree = {
  id: string;
  client_id: string;
  task: Tache;
  phase: Phase;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  note: string | null;
  is_manual: boolean;
};
