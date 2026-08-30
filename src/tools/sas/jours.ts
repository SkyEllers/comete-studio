import { jourParis } from "../../lib/dates.ts";

/**
 * Le temps, tel qu'une liste d'idées le montre.
 *
 * Deux règles, et elles tiennent au même fil : tout est calculé en heure de
 * Paris, et tout est calculé côté serveur. Le fuseau parce qu'une idée notée
 * à 00 h 30 appartient au jour où on l'a eue, pas à celui d'UTC ; le serveur
 * parce qu'un libellé calculé deux fois — une fois au rendu, une fois à
 * l'hydratation — diverge dès qu'un jour tourne entre les deux.
 *
 * Fonctions pures, sans dépendance : elles se déroulent en une seconde sous
 * `node --test`, et c'est là qu'on vérifie les cas qui ne se présentent
 * jamais quand on regarde l'écran — minuit, la veille, l'année dernière.
 */

const FUSEAU = "Europe/Paris";

/** `mardi 12 août` — l'année n'apparaît que si elle n'est pas la courante. */
const libelleJour = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const libelleJourAnnee = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** `14:11`, en heure de Paris. */
const heureParis = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  hour: "2-digit",
  minute: "2-digit",
});

export function cleJour(iso: string): string {
  return jourParis(iso);
}

export function heure(iso: string): string {
  return heureParis.format(new Date(iso));
}

/**
 * « Aujourd'hui », « Hier », sinon la date en toutes lettres.
 *
 * Une majuscule en tête : `Intl` rend « mardi 12 août », et une liste qui
 * commence par une minuscule se lit mal.
 */
export function libelle(iso: string, maintenant = new Date()): string {
  const jour = cleJour(iso);
  const aujourdhui = cleJour(maintenant.toISOString());

  if (jour === aujourdhui) return "Aujourd'hui";

  const veille = new Date(maintenant.getTime() - 86_400_000);
  if (jour === cleJour(veille.toISOString())) return "Hier";

  const memeAnnee = jour.slice(0, 4) === aujourdhui.slice(0, 4);
  const texte = (memeAnnee ? libelleJour : libelleJourAnnee).format(new Date(iso));

  return texte.charAt(0).toLocaleUpperCase("fr") + texte.slice(1);
}

export type Datee = { captured_at: string };
export type Jour<T> = { cle: string; libelle: string; notes: T[] };

/**
 * Les idées rassemblées par jour, du plus récent au plus ancien.
 *
 * L'ordre d'entrée est conservé à l'intérieur d'un jour : c'est la requête qui
 * décide, pas cette fonction — elle ne fait que poser les cloisons.
 */
export function grouperParJour<T extends Datee>(
  notes: T[],
  maintenant = new Date(),
): Jour<T>[] {
  const jours: Jour<T>[] = [];

  for (const note of notes) {
    const cle = cleJour(note.captured_at);
    const dernier = jours.at(-1);

    if (dernier?.cle === cle) {
      dernier.notes.push(note);
      continue;
    }

    jours.push({ cle, libelle: libelle(note.captured_at, maintenant), notes: [note] });
  }

  return jours;
}

/**
 * Le motif d'un `ilike`, désarmé.
 *
 * Trois caractères mordent ici : `%` et `_` sont les jokers de SQL, et `*` en
 * est un pour PostgREST, qui le traduit en `%` avant de l'envoyer. Sans ce
 * passage, chercher « 50 % » ramènerait tout ce qui contient « 50 », et
 * chercher « * » ramènerait la base entière.
 */
export function motifRecherche(recherche: string): string {
  const propre = recherche
    .trim()
    .slice(0, 100)
    .replace(/\\/g, "\\\\")
    .replace(/[%_]/g, (caractere) => `\\${caractere}`)
    .replace(/\*/g, "");

  return `%${propre}%`;
}
