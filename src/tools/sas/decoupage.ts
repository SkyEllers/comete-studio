import { LIMITE_IDEE, type IdeeProposee } from "./types.ts";

/**
 * Le découpage de secours : une idée par ligne.
 *
 * C'est ce qui tient quand l'IA ne répond pas, répond trop tard, ou répond
 * n'importe quoi. Il ne cherche pas à être malin — il ne coupe ni sur « et »,
 * ni sur « / », parce qu'un découpage de secours qui se trompe est pire que
 * pas de découpage du tout : Louis peut fusionner deux lignes en éditant le
 * texte d'une carte, il ne peut pas rattraper une idée coupée en deux.
 *
 * Il vit dans un module sans dépendance au serveur pour une raison précise :
 * si l'appel à la Server Action lui-même échoue, le navigateur doit pouvoir
 * découper tout seul et laisser Louis ranger à la main. L'outil ne dépend
 * jamais du réseau pour rendre ce qui a déjà été tapé.
 */

/** Les tirets et puces de liste, que personne ne veut voir dans son idée. */
const PUCE = /^[-–—•*]\s+/;

export function decouper(texte: string): string[] {
  return texte
    .split(/\r?\n/)
    .map((ligne) => ligne.replace(PUCE, "").trim())
    .filter((ligne) => ligne.length > 0)
    .map((ligne) => ligne.slice(0, LIMITE_IDEE));
}

/** Les mêmes lignes, prêtes pour l'écran de vérification, sans destination. */
export function ideesManuelles(texte: string): IdeeProposee[] {
  return decouper(texte).map((ligne, index) => ({
    cle: `manuel-${index}`,
    texte: ligne,
    destination: null,
    incertain: false,
  }));
}
