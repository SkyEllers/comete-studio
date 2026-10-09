import type { Profil, SensBouton } from "./profil.ts";

/**
 * Ce qu'un message entrant veut dire, sans IA.
 *
 * Deux choses se lisent sans rien comprendre : un STOP, et un bouton touché.
 * Elles ne passent jamais par le modèle de langue : un STOP raté parce que
 * l'API était lente, c'est un signalement, et un numéro bloqué par Meta.
 */

/**
 * STOP seul, ou « arrête », « arrêt » : rien d'autre dans le message. Ou une
 * demande d'arrêter les messages écrite en toutes lettres (`demandeArret`).
 *
 * « Stop, je ne pourrai pas venir » n'est pas une demande de désinscription,
 * c'est un empêchement : l'agent doit y répondre.
 */
export function estStop(texte: string): boolean {
  return /^\s*(stop|arr[eê]te?r?|arr[eê]t)\s*[.!]*\s*$/i.test(texte) || demandeArret(texte) === "tout";
}

/**
 * « Ne plus recevoir » : le bouton du modèle de contenu (Louis, 27/09/2026),
 * ou la même phrase écrite, ou une demande d'arrêter les articles. Plus
 * d'articles ; les rappels continuent (option A, Louis, 06/10/2026).
 */
export function estSansContenus(texte: string): boolean {
  return /^\s*ne plus recevoir\s*[.!]*\s*$/i.test(texte) || demandeArret(texte) === "articles";
}

// ------------------- Une demande d'arrêt en toutes lettres -------------------

const VERBE = String.raw`(?:arret\w*|stopp?\w*|cess\w*)`;
const ENVOYER = String.raw`(?:envoy|ecri|contact|relanc|harcel|spam)\w*`;
const MESSAGES = String.raw`(?:messages?|msgs?|sms|relances?|notifications?|rappels?|whatsapp)`;
const ENVOIS = String.raw`(?:${MESSAGES}|articles?|contenus?|recettes?)`;

/** Les phrases validées par Louis le 09/10/2026 (liste A). */
const PHRASES_ARRET = [
  // « Merci d'arrêter d'envoyer des msg », « arrêtez de m'écrire »
  new RegExp(String.raw`\b${VERBE} (?:de |d')(?:m'|me |nous )?${ENVOYER}`),
  // « arrêtez les messages », « cessez vos relances »
  new RegExp(String.raw`\b${VERBE} (?:les |vos |tes |ces |avec les |avec vos )${ENVOIS}`),
  // « stop aux messages »
  new RegExp(String.raw`\bstop (?:aux |a vos |a tes )${ENVOIS}`),
  // « ne m'écrivez plus », « ne m'envoyez plus rien »
  new RegExp(String.raw`\bne (?:m'|me )?${ENVOYER} (?:plus|rien)`),
  // « je ne veux plus recevoir de messages », « ne souhaite plus être contactée »
  new RegExp(
    String.raw`\bne (?:veux|souhaite|desire|voudrais|souhaiterais) plus (?:recevoir|etre contacte|de ${MESSAGES}|d'${MESSAGES})`,
  ),
  // « désinscrivez-moi », « je veux me désabonner »
  /\bdesinscri\w*|\bdesabonn\w*/,
  // « supprimez mon numéro », « retirez-moi de la liste »
  /\b(?:supprim|retir|effac|enlev)\w*(?: |-)(?:mon numero|moi de|mon contact)/,
  // « laissez-moi tranquille », « fichez-moi la paix »
  /\blaiss\w*[- ]moi tranquille|\bfich\w*[- ]moi la paix/,
];
const ARTICLES = /\b(?:articles?|contenus?|recettes?|liens?)\b/;
const TOUT = new RegExp(String.raw`\b${MESSAGES}\b|\brien\b`);

/** Minuscules, sans accents, apostrophes droites, espaces resserrés. */
function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * Elle demande d'arrêter, en toutes lettres : « tout » (les messages), ou
 * « articles » seulement quand la phrase ne parle que d'articles, de recettes
 * ou de liens. `null` sinon.
 *
 * 09/10/2026 : « Merci d'arrêter d'envoyer des msg. » (Coralie) n'était pas
 * lu, et la question était montée dans la file avec « je vérifie ». « Je dois
 * arrêter le sucre » ou « envie de tout arrêter » (la détresse) ne sont pas
 * des demandes d'arrêt : il faut un verbe d'envoi ou un mot qui désigne les
 * messages. Ce que cette liste rate, l'IA le rattrape (`arret` de sa décision).
 */
export function demandeArret(texte: string): "tout" | "articles" | null {
  const t = normaliser(texte);
  if (!PHRASES_ARRET.some((re) => re.test(t))) return null;
  return ARTICLES.test(t) && !TOUT.test(t) ? "articles" : "tout";
}

/**
 * Une réaction (un emoji posé sur un message) : rien à quoi répondre. Elle
 * ne doit ni faire écrire l'agent ni le mettre en attente d'une réponse
 * (05/10/2026 : Anastasie avait reçu « je vérifie et je reviens vers toi »
 * pour un cœur, et sa question était montée dans la file).
 */
export function estReaction(texte: string): boolean {
  return texte.trim() === "[Elle a envoyé une réaction]";
}

/** Le sens d'un bouton, retrouvé par son libellé dans les modèles du profil. */
export function sensDuBouton(profil: Profil, libelle: string): SensBouton | null {
  for (const modele of Object.values(profil.modeles)) {
    const bouton = modele.boutons.find((b) => b.texte === libelle);
    if (bouton) return bouton.sens;
  }
  return profil.boutonsAnciens?.find((b) => b.texte === libelle)?.sens ?? null;
}
