/**
 * La grille de l'analyse des diagnostics (0056, Louis, 07/10/2026).
 *
 * Douze repères, dans l'ordre du script de Peggy, chacun lu « acquis »,
 * « en progrès » ou « à travailler » : pas de note chiffrée (Louis : A). Les
 * règles qu'on ne discute pas sont des alertes à part. Module pur : il est
 * lu par le prompt, par l'écran et par les tests.
 */

export const POINTS = [
  {
    cle: "preparation",
    libelle: "Préparation",
    aide: "Elle a lu le questionnaire, s'en sert dès le début, et le devis est prêt.",
  },
  {
    cle: "ouverture",
    libelle: "Ouverture",
    aide: "Elle installe le cadre, dit qu'elle n'est pas Peggy et ce qu'elle fait, demande « ça vous convient ? ».",
  },
  {
    cle: "pourquoi_maintenant",
    libelle: "Pourquoi maintenant",
    aide: "Le vrai déclencheur est trouvé, pas seulement « j'ai vu la pub ».",
  },
  {
    cle: "ecoute",
    libelle: "Écoute",
    aide: "80 % d'écoute : des questions ouvertes, des relances, sans cours ni jugement.",
  },
  {
    cle: "vraie_demande",
    libelle: "La vraie demande",
    aide: "Ce qu'elle veut retrouver, et ce qui se passe si rien ne change.",
  },
  {
    cle: "reformulation",
    libelle: "Grande reformulation",
    aide: "Avec les mots de la cliente, et validée par elle.",
  },
  {
    cle: "hypotheses",
    libelle: "Hypothèses",
    aide: "Au conditionnel (« je me demande si… »), sans long exposé technique.",
  },
  {
    cle: "offre_reliee",
    libelle: "L'offre reliée à son histoire",
    aide: "Les quatre étapes rattachées à ce qu'elle a raconté.",
  },
  {
    cle: "prix_devis",
    libelle: "Prix et devis",
    aide: "Clairs, après le programme, lus ensemble, sans se justifier.",
  },
  {
    cle: "objections",
    libelle: "Objections",
    aide: "Elle creuse avant de répondre (« qu'est-ce qui vous fait hésiter ? »).",
  },
  {
    cle: "decision",
    libelle: "Question de décision",
    aide: "Posée nettement, puis elle se tait.",
  },
  {
    cle: "jusquau_bout",
    libelle: "Jusqu'au bout",
    aide: "Signature et paiement, ou une suite datée, ou un R2 selon le protocole, ou un non respecté avec sa raison.",
  },
] as const;

export type ClePoint = (typeof POINTS)[number]["cle"];
export const CLES_POINTS = POINTS.map((p) => p.cle) as ClePoint[];

export const REPERES = ["acquis", "en_progres", "a_travailler", "sans_objet"] as const;
export type Repere = (typeof REPERES)[number];

export const LIBELLES_REPERE: Record<Repere, string> = {
  acquis: "Acquis",
  en_progres: "En progrès",
  a_travailler: "À travailler",
  sans_objet: "Pas vu dans l'appel",
};

export const ALERTES = [
  { cle: "diagnostic_medical", libelle: "Diagnostic ou avis sur un traitement" },
  { cle: "promesse", libelle: "Promesse de kilos, de délai ou de résultat" },
  { cle: "peur", libelle: "La peur pour faire signer" },
  { cle: "devalorisation", libelle: "Dévaloriser ce qu'elle a essayé" },
  { cle: "conseils_gratuits", libelle: "Conseils gratuits (plan, compléments)" },
  { cle: "info_inventee", libelle: "Une info inventée ou fausse (prix, délai, contenu)" },
] as const;

export type CleAlerte = (typeof ALERTES)[number]["cle"];
export const CLES_ALERTES = ALERTES.map((a) => a.cle) as CleAlerte[];

/** Les moments d'un appel où un passage peut servir d'exemple aux autres. */
export const MOMENTS = [
  { cle: "ouverture", libelle: "L'ouverture" },
  { cle: "pourquoi_maintenant", libelle: "Trouver le déclencheur" },
  { cle: "reformulation", libelle: "La reformulation" },
  { cle: "exemple_analyse", libelle: "Montrer un exemple d'analyse" },
  { cle: "offre", libelle: "Présenter l'accompagnement" },
  { cle: "prix", libelle: "Annoncer le prix" },
  { cle: "objection_prix", libelle: "« C'est cher »" },
  { cle: "objection_conjoint", libelle: "« J'en parle à mon conjoint »" },
  { cle: "objection_peur", libelle: "« J'ai peur que ça ne marche pas »" },
  { cle: "objection_reflechir", libelle: "« Je dois réfléchir »" },
  { cle: "decision", libelle: "La question de décision" },
  { cle: "signature", libelle: "Accompagner la signature" },
  { cle: "r2", libelle: "Proposer le R2 avec Peggy" },
] as const;

export type CleMoment = (typeof MOMENTS)[number]["cle"];
export const CLES_MOMENTS = MOMENTS.map((m) => m.cle) as CleMoment[];

export const ISSUES = ["vente", "r2", "en_attente", "non", "inconnue"] as const;
export type Issue = (typeof ISSUES)[number];

export const LIBELLES_ISSUE: Record<Issue, string> = {
  vente: "Vente",
  r2: "R2 avec Peggy",
  en_attente: "En attente",
  non: "Pas de vente",
  inconnue: "Résultat pas encore noté",
};

/** L'outil s'ouvre pour une closeuse à son dixième rendez-vous tenu (Louis, 07/10/2026). */
export const SEUIL_OUVERTURE = 10;

/** Une leçon entre seule dans le carnet à partir de dix appels qui la soutiennent (Louis : C). */
export const SEUIL_LECON = 10;

export function libellePoint(cle: string): string {
  return POINTS.find((p) => p.cle === cle)?.libelle ?? (cle === "general" ? "En général" : cle);
}

export function libelleMoment(cle: string): string {
  return MOMENTS.find((m) => m.cle === cle)?.libelle ?? cle;
}

export function libelleAlerte(cle: string): string {
  return ALERTES.find((a) => a.cle === cle)?.libelle ?? cle;
}

/** « Encore 7 rendez-vous avant d'ouvrir tes analyses », ou null une fois ouvert. */
export function resteAvantOuverture(tenus: number): number | null {
  return tenus >= SEUIL_OUVERTURE ? null : SEUIL_OUVERTURE - Math.max(0, tenus);
}
