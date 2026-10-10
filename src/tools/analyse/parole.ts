/**
 * Le temps de parole d'un appel, compté par le hub sur la transcription, sans
 * l'IA (Peggy, 10/10/2026 : « closeuse ~73 %, cliente ~27 % ») : la part des
 * mots de chaque voix, sur tout l'appel et par tranche, et la durée réelle.
 * Module pur.
 */

import type { Replique } from "../resultats/enregistrement-format.ts";

/** Un diagnostic dure 45 minutes : en dessous de 35, l'enregistrement est sans doute coupé. */
export const MINUTES_APPEL_COMPLET = 35;

/** La longueur d'une tranche, pour voir où la parole bascule. */
export const MINUTES_PAR_TRANCHE = 15;

export type Parole = {
  /** Durée enregistrée, en minutes. */
  minutes: number;
  incomplet: boolean;
  /** Part des mots de chaque voix (« A » : 73), sur tout l'appel. */
  parts: Record<string, number>;
  /** Par tranche de 15 minutes : la part des mots de chaque voix. */
  tranches: { debut: number; fin: number; parts: Record<string, number> }[];
};

const mots = (texte: string) => texte.split(/\s+/).filter(Boolean).length;

function enPourcents(compte: Map<string, number>): Record<string, number> {
  const total = [...compte.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return {};
  return Object.fromEntries([...compte].map(([qui, n]) => [qui, Math.round((n / total) * 100)]));
}

export function compterParole(repliques: Replique[]): Parole {
  const fin = repliques.reduce((m, r) => Math.max(m, r.fin), 0);
  const minutes = Math.round(fin / 60_000);
  const total = new Map<string, number>();
  const parTranche = new Map<number, Map<string, number>>();

  for (const r of repliques) {
    const n = mots(r.texte);
    total.set(r.qui, (total.get(r.qui) ?? 0) + n);
    const t = Math.floor(r.debut / (MINUTES_PAR_TRANCHE * 60_000));
    const compte = parTranche.get(t) ?? new Map<string, number>();
    compte.set(r.qui, (compte.get(r.qui) ?? 0) + n);
    parTranche.set(t, compte);
  }

  return {
    minutes,
    incomplet: minutes < MINUTES_APPEL_COMPLET,
    parts: enPourcents(total),
    tranches: [...parTranche.keys()]
      .sort((a, b) => a - b)
      .map((t) => ({
        debut: t * MINUTES_PAR_TRANCHE,
        fin: Math.min((t + 1) * MINUTES_PAR_TRANCHE, minutes),
        parts: enPourcents(parTranche.get(t) as Map<string, number>),
      })),
  };
}

/** « Voix A », « A » ou « a » : la lettre de la voix, telle que la transcription la note. */
export function lettreVoix(voix: string): string {
  return voix.replace(/^voix\s*/i, "").trim().toUpperCase();
}

/** La part de la closeuse, sur tout l'appel et par tranche, une fois sa voix connue. */
export function partDe(parole: Parole, voix: string): { total: number | null; tranches: { debut: number; fin: number; part: number | null }[] } {
  const v = lettreVoix(voix);
  // Absente d'une tranche où l'autre parle : 0 %. Une tranche vide : rien à dire.
  const part = (parts: Record<string, number>) => (v in parts ? parts[v] : Object.keys(parts).length ? 0 : null);
  return {
    total: part(parole.parts),
    tranches: parole.tranches.map((t) => ({ debut: t.debut, fin: t.fin, part: part(t.parts) })),
  };
}

/** Ce que l'analyse lit du temps de parole, avant de savoir qui est la closeuse. */
export function resumeParole(p: Parole): string {
  const voix = (parts: Record<string, number>) =>
    Object.entries(parts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([qui, n]) => `Voix ${qui} ${n} %`)
      .join(", ");
  const lignes = [
    `Durée enregistrée : ${p.minutes} minutes${p.incomplet ? " (enregistrement sans doute coupé : un diagnostic dure 45 minutes)" : ""}.`,
    `Part des mots sur tout l'appel : ${voix(p.parts)}.`,
    ...p.tranches.map((t) => `De ${t.debut} à ${t.fin} min : ${voix(t.parts)}.`),
  ];
  return lignes.join("\n");
}
