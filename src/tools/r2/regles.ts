/**
 * Le R2 avec la titulaire (0054, Louis, 07/10/2026) : la fiche du protocole
 * écrit par Peggy (« Protocole R2 expert », kit des closeuses), ses règles et
 * les mails. Sans dépendance au serveur : testable seul.
 */

export const CHAMPS_FICHE = [
  { cle: "venue", libelle: "Pourquoi elle est venue", aide: "En une ou deux phrases : son vrai objectif.", requis: true },
  { cle: "problematique", libelle: "Sa problématique principale", aide: "", requis: false },
  {
    cle: "chronologie",
    libelle: "Chronologie, éléments importants",
    aide: "Depuis quand, ce qui s'est passé, symptômes, examens, professionnels vus. Des faits, pas de diagnostic.",
    requis: false,
  },
  {
    cle: "essaye",
    libelle: "Ce qu'elle a déjà essayé",
    aide: "Régimes, naturopathe, nutritionniste, analyses, probiotiques, compléments…",
    requis: false,
  },
  { cle: "pourquoiPeggy", libelle: "Pourquoi elle demande Peggy", aide: "", requis: false },
  {
    cle: "questions",
    libelle: "Ses questions exactes pour Peggy",
    aide: "Mot pour mot autant que possible, une par ligne.",
    requis: true,
  },
  { cle: "budget", libelle: "Budget, objection financière", aide: "", requis: false },
  { cle: "ressenti", libelle: "Ton ressenti : pourquoi ce R2 est justifié", aide: "", requis: false },
] as const;

export type CleFiche = (typeof CHAMPS_FICHE)[number]["cle"];

export const FREINS = [
  { cle: "competence", libelle: "Compétence, crédibilité" },
  { cle: "methode", libelle: "Comprendre la méthode" },
  { cle: "experience", libelle: "Peur d'une mauvaise expérience" },
  { cle: "budget", libelle: "Budget" },
  { cle: "cas", libelle: "Savoir si son cas peut être accompagné" },
  { cle: "autre", libelle: "Autre" },
] as const;

export type CleFrein = (typeof FREINS)[number]["cle"];

/** « Si Peggy répond à ses questions, est-elle prête à envisager l'accompagnement ? » */
export const PRETE = [
  { cle: "oui", libelle: "Oui" },
  { cle: "a_preciser", libelle: "À préciser" },
  { cle: "non", libelle: "Non" },
] as const;

export type ClePrete = (typeof PRETE)[number]["cle"];

export const RESULTATS = [
  { cle: "demarrer", libelle: "Elle veut démarrer" },
  { cle: "reflechit", libelle: "Elle réfléchit" },
  { cle: "non", libelle: "Non" },
] as const;

export type ResultatR2 = (typeof RESULTATS)[number]["cle"];

export type DemandeR2 = {
  fiche: Partial<Record<CleFiche, string>>;
  freins: CleFrein[];
  prete: ClePrete;
  joindre: string;
  telephone: string;
};

export type R2Vu = {
  demandeeLe: string;
  resultat: ResultatR2 | null;
  appeleeLe: string | null;
  noteTitulaire: string | null;
};

/**
 * Ce qui manque pour envoyer la demande, ou null. Le protocole de Peggy : sans
 * intention d'avancer si elle répond, « ce n'est pas un R2 de vente ».
 */
export function manqueR2(d: DemandeR2): string | null {
  for (const champ of CHAMPS_FICHE) {
    if (champ.requis && !d.fiche[champ.cle]?.trim()) return `Écris : ${champ.libelle.toLowerCase()}.`;
  }
  if (d.prete === "non") {
    return "Si elle ne prendra pas l'accompagnement même rassurée, ce n'est pas un R2 de vente (protocole de Peggy).";
  }
  if (!d.joindre.trim()) return "Dis quand Peggy peut la joindre.";
  if (d.telephone.replace(/\D/g, "").length < 8) return "Écris son numéro de téléphone.";
  return null;
}

/** La fiche telle qu'elle s'enregistre : textes coupés, freins et réponse dedans. */
export function ficheEnregistree(d: DemandeR2): Record<string, string> {
  const fiche: Record<string, string> = {};
  for (const champ of CHAMPS_FICHE) {
    const texte = d.fiche[champ.cle]?.trim();
    if (texte) fiche[champ.cle] = texte.slice(0, 3000);
  }
  if (d.freins.length) fiche.freins = d.freins.join(",");
  fiche.prete = d.prete;
  return fiche;
}

/** Les lignes de la fiche, dans l'ordre du protocole, pour un mail ou un écran. */
export function lignesFiche(fiche: Record<string, string>): { libelle: string; texte: string }[] {
  const lignes: { libelle: string; texte: string }[] = [];
  for (const champ of CHAMPS_FICHE) {
    const texte = fiche[champ.cle];
    if (texte) lignes.push({ libelle: champ.libelle, texte });
    if (champ.cle === "questions") {
      const freins = (fiche.freins ?? "")
        .split(",")
        .map((c) => FREINS.find((f) => f.cle === c)?.libelle)
        .filter((l): l is (typeof FREINS)[number]["libelle"] => Boolean(l));
      if (freins.length) lignes.push({ libelle: "Frein principal", texte: freins.join(", ") });
      const prete = PRETE.find((p) => p.cle === fiche.prete);
      if (prete) lignes.push({ libelle: "Si Peggy répond, prête à envisager l'accompagnement ?", texte: prete.libelle });
    }
  }
  return lignes;
}

export const libelleResultat = (r: ResultatR2) => RESULTATS.find((x) => x.cle === r)?.libelle ?? r;

function echapper(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const para = (t: string) => echapper(t).replace(/\n/g, "<br>");

/** Le mail à la titulaire : la fiche, le numéro, quand la joindre. */
export function mailTitulaire(p: {
  prenomTitulaire: string;
  cliente: string;
  closeuse: string;
  quandRdv: string;
  telephone: string;
  joindre: string;
  fiche: Record<string, string>;
  lienRadar: string;
}): { sujet: string; texte: string; html: string } {
  const sujet = `R2 à rappeler : ${p.cliente}`;
  const phrase = `${p.closeuse} a reçu ${p.cliente} en diagnostic ${p.quandRdv}. ${p.cliente} voudrait te parler avant de décider : c'est un R2, au téléphone.`;
  const lignes = lignesFiche(p.fiche);
  const texte = [
    `Bonjour ${p.prenomTitulaire},`,
    "",
    phrase,
    "",
    `Téléphone : ${p.telephone}`,
    `Quand la joindre : ${p.joindre}`,
    "",
    ...lignes.flatMap((l) => [l.libelle, l.texte, ""]),
    `Après l'appel, note ce qu'il a donné dans Radar : ${p.lienRadar}`,
    "",
  ].join("\n");
  const html = [
    `<p>Bonjour ${echapper(p.prenomTitulaire)},</p>`,
    `<p>${echapper(phrase)}</p>`,
    `<p><strong>Téléphone :</strong> <a href="tel:${echapper(p.telephone.replace(/[^\d+]/g, ""))}">${echapper(p.telephone)}</a><br><strong>Quand la joindre :</strong> ${echapper(p.joindre)}</p>`,
    ...lignes.map((l) => `<p><strong>${echapper(l.libelle)}</strong><br>${para(l.texte)}</p>`),
    `<p>Après l'appel, note ce qu'il a donné dans <a href="${echapper(p.lienRadar)}">Radar</a>.</p>`,
  ].join("\n");
  return { sujet, texte, html };
}

/** Le mail à la closeuse, une fois l'appel fait. */
export function mailCloseuse(p: {
  prenomCloseuse: string;
  titulaire: string;
  cliente: string;
  resultat: ResultatR2;
  note: string | null;
  lienEspace: string;
}): { sujet: string; texte: string; html: string } {
  const sujet =
    p.resultat === "demarrer" ? `R2 de ${p.cliente} : elle veut démarrer` : `R2 de ${p.cliente} : ${libelleResultat(p.resultat).toLowerCase()}`;
  const phrase =
    p.resultat === "demarrer"
      ? `${p.titulaire} a appelé ${p.cliente} : elle veut démarrer. À toi de lui envoyer le devis, depuis son rendez-vous dans ton espace (« Envoyer le devis »).`
      : p.resultat === "reflechit"
        ? `${p.titulaire} a appelé ${p.cliente} : elle réfléchit encore.`
        : `${p.titulaire} a appelé ${p.cliente} : elle ne démarre pas.`;
  const texte = [
    `Bonjour${p.prenomCloseuse ? ` ${p.prenomCloseuse}` : ""},`,
    "",
    phrase,
    ...(p.note ? ["", `Ce que ${p.titulaire} en dit :`, p.note] : []),
    "",
    `Ton espace : ${p.lienEspace}`,
    "",
  ].join("\n");
  const html = [
    `<p>Bonjour${p.prenomCloseuse ? ` ${echapper(p.prenomCloseuse)}` : ""},</p>`,
    `<p>${echapper(phrase)}</p>`,
    ...(p.note ? [`<p><strong>Ce que ${echapper(p.titulaire)} en dit</strong><br>${para(p.note)}</p>`] : []),
    `<p><a href="${echapper(p.lienEspace)}">Ton espace</a></p>`,
  ].join("\n");
  return { sujet, texte, html };
}
