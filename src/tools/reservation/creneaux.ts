import { ajouterJours, instantLocal, jourLocal } from "../agent/temps.ts";

/**
 * Les créneaux libres, sans base ni réseau : tout ce qu'il faut savoir arrive
 * en paramètres, tout est rendu en heure universelle.
 *
 * Pour une personne, un créneau est libre quand :
 * - il tombe dans une de ses plages habituelles (dans son fuseau à elle) et
 *   s'y termine ;
 * - son jour n'est pas une absence ;
 * - elle n'a pas encore atteint son maximum ce jour-là ;
 * - il ne chevauche rien de ce que Google Agenda dit occupé, et laisse la
 *   pause libre après lui avant le prochain occupé ;
 * - il laisse la pause avant et après ses autres diagnostics ;
 * - il commence après le préavis.
 *
 * La fenêtre se compte en jours civils du client (Peggy : Paris). « 4 jours »
 * veut dire aujourd'hui et les 4 jours suivants : un dimanche, jusqu'au
 * jeudi compris. Sans rien dedans, elle s'ouvre de 2 en 2 jusqu'à 21 ; au-delà,
 * c'est complet (décisions de Louis, 27/09/2026).
 */

export type Plage = {
  /** 1 = lundi … 7 = dimanche. */
  jour: number;
  /** « 09:00 » */
  debut: string;
  /** « 12:30 » */
  fin: string;
};

export type Absence = {
  /** « 2026-10-05 », bornes comprises, dans le fuseau de la personne. */
  du: string;
  au: string;
};

/** Un intervalle en millisecondes, fin exclue. */
export type Intervalle = { debut: number; fin: number };

export type PersonneDispo = {
  id: string;
  fuseau: string;
  maxParJour: number;
  plages: Plage[];
  absences: Absence[];
  /** Ce que Google Agenda dit occupé. Aucune pause autour. */
  occupe: Intervalle[];
  /** Ses diagnostics confirmés : comptent pour la pause et le maximum. */
  diagnostics: Intervalle[];
};

export type Regles = {
  dureeMinutes: number;
  pauseMinutes: number;
  pasMinutes: number;
  preavisMinutes: number;
  fenetreJours: number;
  fenetrePasJours: number;
  fenetreMaxJours: number;
  /** Le fuseau du client, celui des jours de la fenêtre. */
  fuseau: string;
};

export type Creneau = {
  /** ISO, heure universelle. */
  debut: string;
  fin: string;
  /** Les personnes libres à ce créneau, dans l'ordre de la liste reçue. */
  personnes: string[];
};

export type Resultat =
  | { etat: "ouvert"; jours: number; creneaux: Creneau[] }
  | { etat: "complet"; jours: number; creneaux: [] };

const MINUTE = 60_000;

/** Lundi = 1 … dimanche = 7, pour un jour civil « 2026-10-05 ». */
export function jourDeSemaine(jour: string): number {
  const [a, m, j] = jour.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j)).getUTCDay();
  return d === 0 ? 7 : d;
}

function minutes(heure: string): [number, number] {
  const [h, m] = heure.split(":").map(Number);
  return [h, m];
}

/** Les paliers de la fenêtre : 4, 6, 8… et le maximum en dernier (21). */
export function paliers(regles: Pick<Regles, "fenetreJours" | "fenetrePasJours" | "fenetreMaxJours">): number[] {
  const liste: number[] = [];
  for (let n = regles.fenetreJours; n < regles.fenetreMaxJours; n += regles.fenetrePasJours) {
    liste.push(n);
  }
  liste.push(regles.fenetreMaxJours);
  return liste;
}

function chevauche(debut: number, fin: number, intervalles: Intervalle[]): boolean {
  return intervalles.some((i) => debut < i.fin && fin > i.debut);
}

function estAbsente(jour: string, absences: Absence[]): boolean {
  return absences.some((a) => a.du <= jour && jour <= a.au);
}

/**
 * Les débuts de créneau libres d'une personne entre `de` et `a` (instants),
 * triés. `de` inclut déjà le préavis.
 */
export function creneauxDePersonne(
  p: PersonneDispo,
  regles: Pick<Regles, "dureeMinutes" | "pauseMinutes" | "pasMinutes">,
  de: number,
  a: number,
): number[] {
  const duree = regles.dureeMinutes * MINUTE;
  const pause = regles.pauseMinutes * MINUTE;
  const pas = regles.pasMinutes * MINUTE;

  // La pause entoure chacun de ses diagnostics.
  const autour = p.diagnostics.map((d) => ({ debut: d.debut - pause, fin: d.fin + pause }));
  // Et elle suit le diagnostic, quoi qu'il y ait ensuite dans son agenda : 15
  // minutes libres après, comme le « tampon après l'événement » du Calendly de
  // Peggy (relu le 27/09/2026 : 0 avant, 15 après). Rien avant un créneau : un
  // diagnostic peut commencer dès la fin d'un rendez-vous perso.


  const parJour = new Map<string, number>();
  for (const d of p.diagnostics) {
    const jour = jourLocal(d.debut, p.fuseau);
    parJour.set(jour, (parJour.get(jour) ?? 0) + 1);
  }

  const libres = new Set<number>();
  // Un jour de marge de chaque côté : le fuseau de la personne peut décaler
  // son jour civil par rapport à l'heure universelle.
  const premier = ajouterJours(jourLocal(de, p.fuseau), -1);
  const dernier = ajouterJours(jourLocal(a, p.fuseau), 1);

  for (let jour = premier; jour <= dernier; jour = ajouterJours(jour, 1)) {
    if (estAbsente(jour, p.absences)) continue;
    if ((parJour.get(jour) ?? 0) >= p.maxParJour) continue;

    const semaine = jourDeSemaine(jour);
    for (const plage of p.plages.filter((x) => x.jour === semaine)) {
      const debutPlage = instantLocal(jour, ...minutes(plage.debut), p.fuseau);
      const finPlage = instantLocal(jour, ...minutes(plage.fin), p.fuseau);

      for (let t = debutPlage; t + duree <= finPlage; t += pas) {
        if (t < de || t >= a) continue;
        if (chevauche(t, t + duree + pause, p.occupe)) continue;
        if (chevauche(t, t + duree, autour)) continue;
        libres.add(t);
      }
    }
  }

  return [...libres].sort((x, y) => x - y);
}

/**
 * Les créneaux à montrer maintenant : la plus petite fenêtre qui en contient
 * au moins un, ou « complet ».
 */
export function calculerCreneaux(
  personnes: PersonneDispo[],
  regles: Regles,
  maintenant: number,
): Resultat {
  const aujourdhui = jourLocal(maintenant, regles.fuseau);
  const de = maintenant + regles.preavisMinutes * MINUTE;
  // La fin du dernier jour possible, dans le fuseau du client.
  const finDuJour = (n: number) => instantLocal(ajouterJours(aujourdhui, n + 1), 0, 0, regles.fuseau);
  const a = finDuJour(regles.fenetreMaxJours);

  const parDebut = new Map<number, string[]>();
  for (const p of personnes) {
    for (const t of creneauxDePersonne(p, regles, de, a)) {
      const liste = parDebut.get(t) ?? [];
      liste.push(p.id);
      parDebut.set(t, liste);
    }
  }

  const debuts = [...parDebut.keys()].sort((x, y) => x - y);
  const duree = regles.dureeMinutes * MINUTE;

  for (const n of paliers(regles)) {
    const limite = finDuJour(n);
    const dedans = debuts.filter((t) => t < limite);
    if (dedans.length > 0) {
      return {
        etat: "ouvert",
        jours: n,
        creneaux: dedans.map((t) => ({
          debut: new Date(t).toISOString(),
          fin: new Date(t + duree).toISOString(),
          personnes: parDebut.get(t) ?? [],
        })),
      };
    }
  }

  return { etat: "complet", jours: regles.fenetreMaxJours, creneaux: [] };
}

/**
 * Qui est libre à cet instant précis, pour réserver ou reporter. Pas de
 * palier ici : un créneau libre dans la fenêtre maximale se prend, même si la
 * page, chargée plus tôt, l'a montré dans une fenêtre élargie depuis refermée.
 */
export function personnesLibresA(
  personnes: PersonneDispo[],
  regles: Regles,
  maintenant: number,
  debut: number,
): string[] {
  const aujourdhui = jourLocal(maintenant, regles.fuseau);
  const limite = instantLocal(ajouterJours(aujourdhui, regles.fenetreMaxJours + 1), 0, 0, regles.fuseau);
  if (debut < maintenant + regles.preavisMinutes * MINUTE || debut >= limite) return [];
  return personnes
    .filter((p) => creneauxDePersonne(p, regles, debut, debut + 1).includes(debut))
    .map((p) => p.id);
}

/** Les créneaux rangés par jour, dans le fuseau de la cliente. */
export function parJour(creneaux: Creneau[], fuseau: string): { jour: string; creneaux: Creneau[] }[] {
  const jours = new Map<string, Creneau[]>();
  for (const c of creneaux) {
    const jour = jourLocal(c.debut, fuseau);
    const liste = jours.get(jour) ?? [];
    liste.push(c);
    jours.set(jour, liste);
  }
  return [...jours.entries()].map(([jour, liste]) => ({ jour, creneaux: liste }));
}
