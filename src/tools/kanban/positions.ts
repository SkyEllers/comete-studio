/**
 * Positions en nombres à virgule : insérer entre deux éléments, c'est prendre
 * le milieu. Aucun voisin n'est réécrit, donc un déplacement = une seule
 * écriture, ce qui compte quand plusieurs personnes bougent des cartes en même
 * temps.
 *
 * La contrepartie, c'est l'épuisement : au bout d'une cinquantaine
 * d'insertions au même endroit, l'écart devient trop petit pour la précision
 * d'un flottant. `ecartTropPetit` le détecte et une Server Action renumérote.
 */
export const PAS_POSITION = 1024;
export const ECART_MINIMAL = 0.001;

export function positionEntre(avant?: number, apres?: number): number {
  if (avant === undefined && apres === undefined) return PAS_POSITION;
  if (avant === undefined) return apres! / 2;
  if (apres === undefined) return avant + PAS_POSITION;
  return (avant + apres) / 2;
}

export function ecartTropPetit(avant?: number, apres?: number): boolean {
  if (avant === undefined || apres === undefined) return false;
  return Math.abs(apres - avant) < ECART_MINIMAL;
}

/** Positions renumérotées proprement : 1024, 2048, 3072… */
export function renumerote(ids: string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id, index) => [id, (index + 1) * PAS_POSITION]));
}
