/**
 * Le carnet de leçons : comment une synthèse le fait bouger. Module pur.
 *
 * L'IA désigne les appels qui soutiennent une leçon par des codes (« R12 »)
 * que le hub lui a donnés ; le hub les retraduit en rendez-vous et les compte
 * lui-même. Un code inconnu ne compte pas : aucun appui ne s'invente.
 *
 * Une leçon soutenue par dix appels ou plus entre seule dans le carnet ; en
 * dessous, elle attend le oui de Louis (Louis : C). Une leçon que Louis a
 * refusée ne revient pas d'elle-même ; une correction de Louis ne se retire
 * pas sans lui.
 */

import { CLES_POINTS, SEUIL_LECON } from "./grille.ts";
import type { SyntheseLue } from "./schema.ts";

export type StatutLecon = "proposee" | "active" | "refusee" | "retiree";

export type Lecon = {
  id: string;
  texte: string;
  point: string;
  sens: "vend" | "perd" | "conseil";
  appuis: string[];
  statut: StatutLecon;
  origine: "synthese" | "correction";
};

/** Les rendez-vous derrière une liste de codes, sans doublon ni code inconnu. */
export function resoudreAppuis(codes: string[], parCode: ReadonlyMap<string, string>): string[] {
  const ids = new Set<string>();
  for (const code of codes) {
    const id = parCode.get(code.trim().toUpperCase());
    if (id) ids.add(id);
  }
  return [...ids];
}

export function statutSelonAppuis(nb: number): "active" | "proposee" {
  return nb >= SEUIL_LECON ? "active" : "proposee";
}

const pointValide = (p: string) => ((CLES_POINTS as string[]).includes(p) ? p : "general");

export type Mouvements = {
  nouvelles: Omit<Lecon, "id">[];
  /** Les leçons existantes dont les appuis ou le statut changent. */
  majs: { id: string; appuis: string[]; statut: StatutLecon }[];
  retraits: { id: string; note: string }[];
};

/**
 * Ce que la synthèse change au carnet. Une leçon nouvelle sans aucun appui
 * réel est écartée ; une leçon renforcée garde ses anciens appuis ; une
 * proposée qui atteint le seuil devient active.
 */
export function mouvementsDuCarnet(
  synthese: Pick<SyntheseLue, "lecons_nouvelles" | "lecons_renforcees" | "lecons_a_retirer">,
  carnet: Lecon[],
  parCode: ReadonlyMap<string, string>,
): Mouvements {
  const parId = new Map(carnet.map((l) => [l.id, l]));
  const vivantes = new Set(carnet.filter((l) => l.statut === "active" || l.statut === "proposee").map((l) => l.texte.trim().toLowerCase()));

  const nouvelles: Omit<Lecon, "id">[] = [];
  for (const n of synthese.lecons_nouvelles) {
    const texte = n.texte.trim();
    if (!texte || vivantes.has(texte.toLowerCase())) continue;
    const appuis = resoudreAppuis(n.appuis, parCode);
    if (appuis.length === 0) continue;
    vivantes.add(texte.toLowerCase());
    nouvelles.push({
      texte,
      point: pointValide(n.point),
      sens: n.sens,
      appuis,
      statut: statutSelonAppuis(appuis.length),
      origine: "synthese",
    });
  }

  const retires = new Set<string>();
  const retraits: Mouvements["retraits"] = [];
  for (const r of synthese.lecons_a_retirer) {
    const l = parId.get(r.id);
    if (!l || l.origine === "correction" || (l.statut !== "active" && l.statut !== "proposee")) continue;
    retires.add(l.id);
    retraits.push({ id: l.id, note: r.raison.trim().slice(0, 600) });
  }

  const majs: Mouvements["majs"] = [];
  for (const r of synthese.lecons_renforcees) {
    const l = parId.get(r.id);
    if (!l || retires.has(l.id) || l.statut === "refusee" || l.statut === "retiree") continue;
    const appuis = [...new Set([...l.appuis, ...resoudreAppuis(r.appuis, parCode)])];
    const statut = l.statut === "proposee" ? statutSelonAppuis(appuis.length) : l.statut;
    if (appuis.length === l.appuis.length && statut === l.statut) continue;
    majs.push({ id: l.id, appuis, statut });
  }

  return { nouvelles, majs, retraits };
}

/** Les leçons que l'analyse d'un appel relit : les actives, corrections de Louis d'abord. */
export function leconsPourAnalyse(carnet: Lecon[]): Lecon[] {
  return carnet
    .filter((l) => l.statut === "active")
    .sort((a, b) => (a.origine === b.origine ? b.appuis.length - a.appuis.length : a.origine === "correction" ? -1 : 1));
}
