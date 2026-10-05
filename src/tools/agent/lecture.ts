import type { Profil, SensBouton } from "./profil.ts";

/**
 * Ce qu'un message entrant veut dire, sans IA.
 *
 * Deux choses se lisent sans rien comprendre : un STOP, et un bouton touché.
 * Elles ne passent jamais par le modèle de langue : un STOP raté parce que
 * l'API était lente, c'est un signalement, et un numéro bloqué par Meta.
 */

/**
 * STOP seul, ou « arrête », « arrêt » : rien d'autre dans le message.
 *
 * Volontairement strict. « Stop, je ne pourrai pas venir » n'est pas une
 * demande de désinscription, c'est un empêchement : l'agent doit y répondre.
 */
export function estStop(texte: string): boolean {
  // « Ne plus recevoir » : le bouton du modèle de contenu (Louis, 27/09/2026).
  return /^\s*(stop|arr[eê]te?r?|arr[eê]t|ne plus recevoir)\s*[.!]*\s*$/i.test(texte);
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
