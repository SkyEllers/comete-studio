/**
 * Les chiffres d'ensemble de l'analyse : les repères d'une closeuse sur tous
 * ses appels, ceux de l'équipe, et le portrait de la cliente compté par
 * issue. Module pur : rien ne sort d'ici avec un nom ou un prénom.
 */

import { CLES_POINTS, LIBELLES_REPERE, type ClePoint, type Issue, type Repere } from "./grille.ts";
import { LIBELLES_FICHE, type AnalyseRangee, type Fiche } from "./schema.ts";

export type Compte = Record<Exclude<Repere, "sans_objet">, number>;

const vide = (): Compte => ({ acquis: 0, en_progres: 0, a_travailler: 0 });

export function compterReperes(analyses: Pick<AnalyseRangee, "points">[]): Record<ClePoint, Compte> {
  const comptes = Object.fromEntries(CLES_POINTS.map((c) => [c, vide()])) as Record<ClePoint, Compte>;
  for (const a of analyses) {
    for (const p of a.points) {
      if (p.repere === "sans_objet") continue;
      const c = comptes[p.cle as ClePoint];
      if (c) c[p.repere] += 1;
    }
  }
  return comptes;
}

/** Le repère le plus fréquent ; à égalité, « en progrès ». Null sans aucun appel jugé. */
export function dominant(c: Compte): Exclude<Repere, "sans_objet"> | null {
  const total = c.acquis + c.en_progres + c.a_travailler;
  if (total === 0) return null;
  const max = Math.max(c.acquis, c.en_progres, c.a_travailler);
  const enTete = (["acquis", "en_progres", "a_travailler"] as const).filter((r) => c[r] === max);
  return enTete.length === 1 ? enTete[0] : "en_progres";
}

export function libelleCompte(c: Compte): string {
  return (["acquis", "en_progres", "a_travailler"] as const)
    .filter((r) => c[r] > 0)
    .map((r) => `${LIBELLES_REPERE[r].toLowerCase()} ${c[r]}`)
    .join(" · ");
}

/**
 * Elle face à l'équipe, point par point. L'équipe, ce sont les autres
 * closeuses du client : ni elle, ni la titulaire.
 */
export function comparaison(
  siennes: Pick<AnalyseRangee, "points">[],
  equipe: Pick<AnalyseRangee, "points">[],
): { cle: ClePoint; moi: Compte; equipe: Compte }[] {
  const moi = compterReperes(siennes);
  const eux = compterReperes(equipe);
  return CLES_POINTS.map((cle) => ({ cle, moi: moi[cle], equipe: eux[cle] }));
}

// ------------------------------------------------------------ Le portrait

export type EntreePortrait = { issue: Issue; fiche: Fiche | null; budget: string | null };

export type LignePortrait = { valeur: string; libelle: string; total: number; ventes: number };
export type DimensionPortrait = { cle: string; libelle: string; lignes: LignePortrait[] };

const DIMENSIONS: { cle: string; libelle: string; lire: (e: EntreePortrait) => string[] }[] = [
  { cle: "intention", libelle: "Pourquoi elle est venue", lire: (e) => (e.fiche ? [e.fiche.intention] : []) },
  { cle: "capacite", libelle: "Capacité à payer maintenant", lire: (e) => (e.fiche ? [e.fiche.capacite] : []) },
  { cle: "tranche_age", libelle: "Âge", lire: (e) => (e.fiche ? [e.fiche.tranche_age] : []) },
  { cle: "menopause", libelle: "Ménopause", lire: (e) => (e.fiche ? [e.fiche.menopause] : []) },
  { cle: "profil_disc", libelle: "Profil DISC supposé", lire: (e) => (e.fiche ? [e.fiche.profil_disc] : []) },
  { cle: "couple", libelle: "En couple", lire: (e) => (e.fiche ? [e.fiche.couple] : []) },
  { cle: "declencheur", libelle: "Ce qui l'a fait réserver", lire: (e) => (e.fiche ? [e.fiche.declencheur] : []) },
  { cle: "nb_essais", libelle: "Régimes et programmes déjà essayés", lire: (e) => (e.fiche ? [trancheEssais(e.fiche.essais.length)] : []) },
  { cle: "essais", libelle: "Ce qu'elle a essayé", lire: (e) => e.fiche?.essais ?? [] },
  { cle: "souffrances", libelle: "Ce qui la fait souffrir", lire: (e) => e.fiche?.souffrances ?? [] },
  { cle: "freins", libelle: "Ses freins", lire: (e) => e.fiche?.freins ?? [] },
  { cle: "decide", libelle: "Qui décide", lire: (e) => (e.fiche ? [e.fiche.decide] : []) },
  { cle: "source", libelle: "Comment elle est arrivée", lire: (e) => (e.fiche ? [e.fiche.source] : []) },
  { cle: "budget", libelle: "Budget coché au questionnaire", lire: (e) => (e.budget ? [e.budget] : ["inconnu"]) },
];

function trancheEssais(n: number): string {
  if (n <= 1) return "essais_0_1";
  if (n <= 3) return "essais_2_3";
  return "essais_4_plus";
}

const LIBELLES_ESSAIS: Record<string, string> = {
  essais_0_1: "aucun ou un seul",
  essais_2_3: "deux ou trois",
  essais_4_plus: "quatre et plus",
};

function libelleValeur(v: string): string {
  return LIBELLES_ESSAIS[v] ?? LIBELLES_FICHE[v] ?? v;
}

/** Le portrait compté : pour chaque case, combien de rendez-vous, et combien de ventes parmi eux. */
export function chiffresPortrait(entrees: EntreePortrait[]): {
  total: number;
  ventes: number;
  dimensions: DimensionPortrait[];
} {
  const jugees = entrees.filter((e) => e.issue !== "inconnue");
  const dimensions = DIMENSIONS.map((d) => {
    const lignes = new Map<string, LignePortrait>();
    for (const e of jugees) {
      for (const v of new Set(d.lire(e))) {
        const l = lignes.get(v) ?? { valeur: v, libelle: libelleValeur(v), total: 0, ventes: 0 };
        l.total += 1;
        if (e.issue === "vente") l.ventes += 1;
        lignes.set(v, l);
      }
    }
    return {
      cle: d.cle,
      libelle: d.libelle,
      lignes: [...lignes.values()].sort((a, b) => b.total - a.total || a.libelle.localeCompare(b.libelle, "fr")),
    };
  });
  return { total: jugees.length, ventes: jugees.filter((e) => e.issue === "vente").length, dimensions };
}

/** Le budget coché au questionnaire de réservation, s'il y est. */
export function budgetDuQuestionnaire(reponses: { q: string; r: string }[] | null | undefined): string | null {
  const ligne = reponses?.find((x) => /budget/i.test(x.q));
  const r = ligne?.r?.trim();
  return r ? r.slice(0, 80) : null;
}

/** Les réponses du questionnaire qu'on donne à lire à l'IA : sans le téléphone ni l'adresse mail. */
export function reponsesPourAnalyse(reponses: { q: string; r: string }[] | null | undefined): { q: string; r: string }[] {
  return (reponses ?? []).filter((x) => !/t[ée]l[ée]phone|e-?mail|courriel|adresse/i.test(x.q));
}
