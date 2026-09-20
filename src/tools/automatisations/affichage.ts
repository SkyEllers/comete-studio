import { ETATS, type Automatisation, type Etat } from "./types.ts";

/**
 * Les mots de la page : « dans 2 jours », « il y a 3 h », « 8 sur 9 au vert ».
 * Tout est pur et daté par un `maintenant` passé en argument, pour que les
 * tests n'aient pas à attendre mardi.
 */

const PARIS = "Europe/Paris";

const JOUR_HEURE = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: PARIS,
});

const JOUR = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  timeZone: PARIS,
});

/** « mar. 22/09 07:00 » */
export const quand = (iso: string | null) =>
  iso ? JOUR_HEURE.format(new Date(iso)).replace(/^(\w)/, (c) => c.toUpperCase()) : "—";

/** « mardi 22/09 » */
export const jour = (iso: string | null) => (iso ? JOUR.format(new Date(iso)) : "—");

/**
 * L'écart, en français courant. Au-delà de la journée on compte en jours pleins
 * de Paris : « demain » doit rester « demain » à 23h comme à 7h.
 */
export function ecart(iso: string | null, maintenant: Date): string {
  if (!iso) return "—";
  const cible = new Date(iso);
  const minutes = Math.round((cible.getTime() - maintenant.getTime()) / 60000);
  const passe = minutes < 0;
  const absolu = Math.abs(minutes);

  if (absolu < 60) return passe ? `il y a ${absolu} min` : `dans ${absolu} min`;

  const jours = joursDecart(cible, maintenant);
  if (jours === 0) {
    const heures = Math.round(absolu / 60);
    return passe ? `il y a ${heures} h` : `dans ${heures} h`;
  }
  if (jours === 1) return "demain";
  if (jours === -1) return "hier";
  return passe ? `il y a ${-jours} jours` : `dans ${jours} jours`;
}

/** Le nombre de jours de calendrier (heure de Paris) qui séparent deux instants. */
function joursDecart(cible: Date, maintenant: Date): number {
  const jourDe = (d: Date) =>
    new Intl.DateTimeFormat("fr-CA", { timeZone: PARIS, dateStyle: "short" }).format(d);
  const a = Date.parse(`${jourDe(maintenant)}T00:00:00Z`);
  const b = Date.parse(`${jourDe(cible)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Les automatisations d'un client, dans l'ordre du fichier du vault. */
export function parClient(lignes: Automatisation[]): { client: string; lignes: Automatisation[] }[] {
  const groupes = new Map<string, Automatisation[]>();
  for (const ligne of lignes) {
    const liste = groupes.get(ligne.client) ?? [];
    liste.push(ligne);
    groupes.set(ligne.client, liste);
  }
  return [...groupes.entries()].map(([client, l]) => ({
    client,
    lignes: [...l].sort((x, y) => x.ordre - y.ordre),
  }));
}

/** Ce qui demande un regard : panne, mail perdu, rien reçu. */
export const aRegarder = (lignes: Automatisation[]) =>
  lignes.filter((l) => l.actif && ETATS[l.etat].gravite === 2);

/** Ce qui mérite un œil sans être une panne : un mail arrivé après la limite. */
export const aSurveiller = (lignes: Automatisation[]) =>
  lignes.filter((l) => l.actif && l.etat === "tardif");

/**
 * Celles qui n'ont pas encore eu leur premier passage. Ce n'est pas un ennui —
 * `nl-planifier` a été ajouté le 11/09/2026 et tournera le 01/10 — mais ça ne
 * se compte pas non plus avec celles qui vont bien : on n'en sait rien encore.
 */
export const jamaisVues = (lignes: Automatisation[]) =>
  lignes.filter((l) => l.actif && l.etat === "inconnu");

/** « 8 sur 9 », plus ce qui n'est pas encore jugeable. */
export function compteur(lignes: Automatisation[]): {
  sereines: number;
  jugees: number;
  jamais: number;
  pause: number;
} {
  const actives = lignes.filter((l) => l.actif);
  const jugees = actives.filter((l) => l.etat !== "inconnu");
  return {
    sereines: jugees.filter((l) => ETATS[l.etat].gravite === 0).length,
    jugees: jugees.length,
    jamais: actives.length - jugees.length,
    pause: lignes.length - actives.length,
  };
}

/**
 * La phrase sous le nom d'une automatisation : où elle en est, en une ligne.
 * C'est ce que Louis lit en diagonale, donc l'information la plus utile
 * d'abord — quand arrive la prochaine, ou depuis quand il manque quelque chose.
 */
export function resume(ligne: Automatisation, maintenant: Date): string {
  if (!ligne.actif) return "En pause — rien n'est attendu";

  const suite = ligne.prochaine_le
    ? `prochaine ${jour(ligne.prochaine_le)} (${ecart(ligne.prochaine_le, maintenant)})`
    : "pas de prochaine date";

  switch (ligne.etat) {
    case "ok":
    case "tardif":
      return `Dernier reçu ${quand(ligne.recu_le)} · ${suite}`;
    case "attente":
      return `Attendu depuis ${quand(ligne.attendue_le)} · le retard de GitHub va jusqu'à 6 h`;
    case "silence":
      return `Rien à dire depuis ${quand(ligne.attendue_le)} · ${suite}`;
    case "panne":
      return `Le job a échoué pour ${quand(ligne.attendue_le)} · ${suite}`;
    case "mail-perdu":
      return `Job vert, mail absent pour ${quand(ligne.attendue_le)} · ${suite}`;
    case "manque":
      return `Rien reçu pour ${quand(ligne.attendue_le)} · ${suite}`;
    case "inconnu":
      return `Jamais vue passer · ${suite}`;
    default:
      return suite;
  }
}

/** La couleur d'une pastille, en classes Tailwind du hub. */
export const COULEUR: Record<Etat, string> = {
  ok: "bg-success",
  tardif: "bg-warning",
  attente: "bg-muted-foreground/40",
  silence: "bg-muted-foreground/25",
  panne: "bg-danger",
  "mail-perdu": "bg-warning",
  manque: "bg-danger",
  pause: "bg-muted-foreground/25",
  inconnu: "bg-muted-foreground/25",
};

/** Le texte au survol d'une pastille : la date, puis ce que l'état veut dire. */
export const infobulle = (etat: Etat, attendue: string, recu: string | null) =>
  `${quand(attendue)} — ${ETATS[etat].mot}${recu ? ` le ${quand(recu)}` : ""}`;
