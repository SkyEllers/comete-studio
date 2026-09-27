/**
 * Qui prend le rendez-vous, parmi les personnes libres à ce créneau.
 *
 * Décidé par Louis le 27/09/2026 :
 * 1. Les closeuses d'abord, la titulaire (Peggy) après.
 * 2. Une closeuse qui a moins de 10 rendez-vous honorés est une débutante :
 *    les débutantes passent en premier, à tour de rôle (celle qui a reçu un
 *    rendez-vous il y a le plus longtemps, ou jamais, d'abord).
 * 3. Entre les autres closeuses : celle qui vend le mieux, ventes ÷ rendez-vous
 *    honorés sur les 60 derniers jours, lus dans Radar. À taux égal, tour de
 *    rôle. Sans rendez-vous honoré sur la période, son taux vaut 0.
 */

export type Candidate = {
  id: string;
  role: "closeuse" | "titulaire";
  /** Rendez-vous honorés depuis toujours (Radar). */
  honoresTotal: number;
  /** Sur la période du taux (Radar). */
  honoresPeriode: number;
  ventesPeriode: number;
  /** Dernier rendez-vous que l'outil lui a donné, en ms, ou null. */
  derniereAttribution: number | null;
};

export type Rang = "debutante" | "closeuse" | "titulaire";

export function rang(c: Candidate, seuilDebutante: number): Rang {
  if (c.role === "titulaire") return "titulaire";
  return c.honoresTotal < seuilDebutante ? "debutante" : "closeuse";
}

export function taux(c: Pick<Candidate, "honoresPeriode" | "ventesPeriode">): number {
  return c.honoresPeriode > 0 ? c.ventesPeriode / c.honoresPeriode : 0;
}

const ORDRE: Record<Rang, number> = { debutante: 0, closeuse: 1, titulaire: 2 };

/** Jamais servie avant tout le monde, puis la plus anciennement servie. */
function tourDeRole(a: Candidate, b: Candidate): number {
  const x = a.derniereAttribution ?? -Infinity;
  const y = b.derniereAttribution ?? -Infinity;
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Les candidates, de la première à qui donner le rendez-vous à la dernière. */
export function ordonner(candidates: Candidate[], seuilDebutante: number): Candidate[] {
  return [...candidates].sort((a, b) => {
    const ra = rang(a, seuilDebutante);
    const rb = rang(b, seuilDebutante);
    if (ra !== rb) return ORDRE[ra] - ORDRE[rb];
    if (ra === "closeuse") {
      const ecart = taux(b) - taux(a);
      if (ecart !== 0) return ecart;
    }
    return tourDeRole(a, b);
  });
}
