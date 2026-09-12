import type {
  ClientPulsar,
  Entree,
  FicheClient,
  Modele,
  Phase,
  Tache,
} from "./types.ts";

/**
 * Ce que le temps rapporte. Le cœur chiffré de Pulsar, et son seul endroit.
 *
 * Tout est ici parce que tout est faux en silence : un encaissé compté un mois
 * de trop ne lève aucune erreur, il affiche un taux horaire flatteur et Louis
 * y croit. Ces fonctions ne touchent ni la base, ni l'heure qu'il est, ni
 * l'écran — elles prennent une fiche, un mois, des minutes, et rendent des
 * centimes. Elles se déroulent en quelques microsecondes sous `node --test`,
 * et c'est là qu'on vérifie les cas que l'œil ne rattrape pas : le mois du
 * début, celui de la fin, et les modèles qui ne rapportent rien.
 *
 * L'encaissé est déclaratif : il se déduit de la fiche du client, jamais d'une
 * saisie au fil de l'eau. C'est ce qui permet de lire n'importe quel mois
 * passé sans avoir eu à le préparer.
 */

/** Ce dont le calcul a besoin, et rien d'autre. */
export type FicheRevenu = {
  modele: Modele;
  montant_cents: number;
  date_debut: string | null;
  fin_engagement: string | null;
  is_internal: boolean;
};

/** « 2026-09-17 » → « 2026-09-01 ». Un mois est une date : son premier jour. */
export function moisDuJour(jour: string): string {
  return `${jour.slice(0, 7)}-01`;
}

/** Le nombre de mois civils de `debut` à `fin`, bornes comprises. */
export function nombreDeMois(debut: string, fin: string): number {
  if (fin < debut) return 0;

  const [anneeDebut, moisDebut] = debut.split("-").map(Number);
  const [anneeFin, moisFin] = fin.split("-").map(Number);

  return (anneeFin - anneeDebut) * 12 + (moisFin - moisDebut) + 1;
}

/**
 * Les modèles qui rapportent quelque chose en v1.
 *
 * `commission` rend zéro parce que les relevés de Radar ne sont pas encore
 * lus — c'est une mesure qui manque, pas un client qui ne paie pas.
 * `historique` rend zéro parce que c'est la vérité : des heures grises,
 * assumées, qui pèsent sur le taux moyen et doivent peser dessus.
 */
const FACTURANTS: Modele[] = ["recurrent", "one_shot"];

/**
 * Le dernier mois qui compte pour un engagement récurrent.
 *
 * `fin_engagement` fait foi, et elle seule. Un client passé en `termine` reçoit
 * sa date de fin au moment de l'archivage — c'est la fiche qui s'en charge —
 * si bien qu'un récurrent terminé sans date n'existe pas par le produit. S'il
 * en arrivait un par la base, il continuerait de compter : inventer une fin
 * qu'on ne connaît pas ferait disparaître des mois encaissés sans rien dire,
 * et un chiffre trop bas se croit aussi bien qu'un chiffre trop haut.
 */
function finDuRecurrent(fiche: FicheRevenu): string | null {
  return fiche.fin_engagement ? moisDuJour(fiche.fin_engagement) : null;
}

/**
 * L'encaissé d'un mois, en centimes.
 *
 * - `recurrent` : le montant, pour chaque mois civil entre le début et la fin
 *   de l'engagement, mois de début et de fin inclus.
 * - `one_shot` : le montant, une seule fois, sur le mois du début.
 * - `commission`, `historique`, et le client interne : zéro.
 */
export function encaisseDuMois(fiche: FicheRevenu, mois: string): number {
  if (fiche.is_internal || !FACTURANTS.includes(fiche.modele)) return 0;
  if (!fiche.date_debut) return 0;

  const debut = moisDuJour(fiche.date_debut);

  if (fiche.modele === "one_shot") {
    return mois === debut ? fiche.montant_cents : 0;
  }

  const fin = finDuRecurrent(fiche);
  const dansLEngagement = mois >= debut && (fin === null || mois <= fin);

  return dansLEngagement ? fiche.montant_cents : 0;
}

/**
 * L'encaissé depuis le début, jusqu'au mois affiché inclus.
 *
 * C'est la seule lecture qui ait un sens pour un `one_shot` : mille euros
 * encaissés en mars contre les heures du seul mois de mars diraient un taux
 * horaire énorme en mars et nul partout ailleurs. L'écran le dit avec le
 * mot « cumulé ».
 */
export function encaisseCumule(fiche: FicheRevenu, mois: string): number {
  if (fiche.is_internal || !FACTURANTS.includes(fiche.modele)) return 0;
  if (!fiche.date_debut) return 0;

  const debut = moisDuJour(fiche.date_debut);
  if (mois < debut) return 0;

  if (fiche.modele === "one_shot") return fiche.montant_cents;

  const fin = finDuRecurrent(fiche);
  const dernier = fin === null || mois <= fin ? mois : fin;

  return fiche.montant_cents * nombreDeMois(debut, dernier);
}

/**
 * Sur quoi se lit le taux horaire d'un client : son mois, ou son cumul.
 *
 * Les récurrents se lisent au mois — c'est la question qu'ils posent : ce
 * mois-ci, est-ce que ces heures valaient ce qu'elles ont coûté ? Les
 * one-shot se lisent en cumulé, et nulle part ailleurs.
 */
export function baseDuTaux(fiche: Pick<FicheRevenu, "modele">): "mois" | "cumule" {
  return fiche.modele === "one_shot" ? "cumule" : "mois";
}

/**
 * Le taux horaire réel, en centimes par heure.
 *
 * `null` quand il n'y a pas d'heures : zéro heure ne donne pas un taux infini,
 * elle donne une question sans objet. L'écran affiche un tiret, pas un zéro —
 * un zéro se lirait comme « ce client ne rapporte rien ».
 */
export function tauxHoraire(encaisseCents: number, minutes: number): number | null {
  if (minutes <= 0) return null;
  return Math.round(encaisseCents / (minutes / 60));
}

/**
 * La ligne passe-t-elle en orange à cause de son taux ?
 *
 * Seuls les modèles qui facturent sont jugés. Le client interne ne rapporte
 * rien par construction, `historique` ne rapporte rien de son plein gré, et
 * `commission` n'est pas encore mesuré : les trois seraient orange tous les
 * mois, et une alerte qui s'allume toujours ne s'allume plus.
 */
export function alerteTaux(
  fiche: Pick<FicheRevenu, "modele" | "is_internal">,
  tauxCents: number | null,
  seuilCents: number,
): boolean {
  if (fiche.is_internal || !FACTURANTS.includes(fiche.modele)) return false;
  return tauxCents !== null && tauxCents < seuilCents;
}

/**
 * La ligne passe-t-elle en orange à cause de ses heures ?
 *
 * Celle-ci ne parle pas d'argent mais de temps, et vaut donc pour tous les
 * modèles : un client en pilotage qui dépasse son plafond coûte des heures,
 * qu'il paie en récurrent, en commission ou en souvenir. Le client interne en
 * est dispensé — il n'est jamais en pilotage de personne.
 */
export function alerteHeures(
  client: Pick<ClientPulsar, "statut" | "is_internal">,
  minutesDuMois: number,
  plafondHeures: number,
): boolean {
  if (client.is_internal || client.statut !== "pilotage") return false;
  return minutesDuMois > plafondHeures * 60;
}

// ------------------------------ Les répartitions -----------------------------

/**
 * Les minutes par phase, sur les phases figées à la saisie.
 *
 * C'est tout l'intérêt de les avoir figées : un client passé en pilotage le 12
 * garde ses heures du 1er au 11 en setup, et la répartition dit ce qui s'est
 * passé plutôt que ce qu'on croit aujourd'hui.
 */
export function parPhase(
  entrees: Pick<Entree, "phase" | "duration_minutes">[],
): Record<Phase, number> {
  const total: Record<Phase, number> = { setup: 0, pilotage: 0, interne: 0 };

  for (const entree of entrees) {
    total[entree.phase] += entree.duration_minutes ?? 0;
  }

  return total;
}

/** Les minutes par type de tâche, de la plus lourde à la plus légère. */
export function parTache(
  entrees: Pick<Entree, "task" | "duration_minutes">[],
): { task: Tache; minutes: number }[] {
  const total = new Map<Tache, number>();

  for (const entree of entrees) {
    total.set(entree.task, (total.get(entree.task) ?? 0) + (entree.duration_minutes ?? 0));
  }

  return [...total]
    .filter(([, minutes]) => minutes > 0)
    .map(([task, minutes]) => ({ task, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

// --------------------------------- Le bilan ----------------------------------

/** Ce qu'une ligne de l'écran Par client a besoin de savoir. */
export type BilanClient = {
  client: FicheClient;
  minutesDuMois: number;
  minutesCumulees: number;
  /** L'encaissé sur lequel se lit le taux : le mois, ou le cumul. */
  encaisseCents: number;
  base: "mois" | "cumule";
  tauxCents: number | null;
  phases: Record<Phase, number>;
  taches: { task: Tache; minutes: number }[];
  alerteTaux: boolean;
  alerteHeures: boolean;
};

export type Seuils = { taux_alerte_cents: number; heures_pilotage_alerte: number };

/**
 * Le bilan d'un client pour le mois affiché.
 *
 * L'encaissé et les heures se lisent sur la même base, sinon le taux ne veut
 * rien dire : un one-shot confronte son montant unique aux heures de toute sa
 * vie, un récurrent confronte son mois à son mois. C'est le seul endroit où
 * ce choix se fait, et `baseDuTaux` est le seul à le connaître.
 */
export function bilanDuClient(
  client: FicheClient,
  entreesDuMois: Entree[],
  minutesCumulees: number,
  mois: string,
  seuils: Seuils,
): BilanClient {
  const siennes = entreesDuMois.filter((entree) => entree.client_id === client.id);
  const minutesDuMois = siennes.reduce(
    (somme, entree) => somme + (entree.duration_minutes ?? 0),
    0,
  );

  const base = baseDuTaux(client);
  const encaisseCents =
    base === "cumule"
      ? encaisseCumule(client, mois)
      : encaisseDuMois(client, mois);

  const tauxCents = tauxHoraire(
    encaisseCents,
    base === "cumule" ? minutesCumulees : minutesDuMois,
  );

  return {
    client,
    minutesDuMois,
    minutesCumulees,
    encaisseCents,
    base,
    tauxCents,
    phases: parPhase(siennes),
    taches: parTache(siennes),
    alerteTaux: alerteTaux(client, tauxCents, seuils.taux_alerte_cents),
    alerteHeures: alerteHeures(client, minutesDuMois, seuils.heures_pilotage_alerte),
  };
}

/**
 * Les bilans de tous les clients, dans l'ordre de l'écran.
 *
 * Les archivés descendent en bas — ils ne demandent plus rien — et au-dessus,
 * les plus lourds du mois d'abord : la question de l'écran est « où est passé
 * mon temps », et la réponse doit être la première ligne.
 */
export function bilansDuMois(
  clients: FicheClient[],
  entreesDuMois: Entree[],
  cumuls: Map<string, number>,
  mois: string,
  seuils: Seuils,
): BilanClient[] {
  return clients
    .map((client) =>
      bilanDuClient(client, entreesDuMois, cumuls.get(client.id) ?? 0, mois, seuils),
    )
    .sort((a, b) => {
      const archiveA = a.client.statut === "termine";
      const archiveB = b.client.statut === "termine";
      if (archiveA !== archiveB) return archiveA ? 1 : -1;

      if (a.minutesDuMois !== b.minutesDuMois) return b.minutesDuMois - a.minutesDuMois;
      return a.client.name.localeCompare(b.client.name, "fr");
    });
}

// -------------------------------- L'affichage --------------------------------

const EUROS = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/**
 * « 550 € ». Jamais de centimes : les montants de Pulsar sont des forfaits
 * déclarés, pas des factures, et deux décimales feraient croire à une
 * précision que la saisie n'a pas.
 */
export function euros(centimes: number): string {
  return EUROS.format(Math.round(centimes / 100));
}

/** « 61 €/h », ou un tiret quand il n'y a pas d'heures. */
export function tauxLisible(tauxCents: number | null): string {
  return tauxCents === null ? "—" : `${euros(tauxCents)}/h`;
}
