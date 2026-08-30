/**
 * Les tournures qu'on répète.
 *
 * Une fonction plutôt qu'un ternaire recopié dix fois : le jour où « idée »
 * devient autre chose, il n'y a qu'un endroit à changer, et l'accord au
 * pluriel ne s'oublie nulle part.
 */

/** « 3 idées », « 1 idée », « Aucune idée ». */
export function compteIdees(nombre: number): string {
  if (nombre === 0) return "Aucune idée";
  return `${nombre} idée${nombre > 1 ? "s" : ""}`;
}

/** « 3 résultats », « 1 résultat », « Aucun résultat ». */
export function compteResultats(nombre: number): string {
  if (nombre === 0) return "Aucun résultat";
  return `${nombre} résultat${nombre > 1 ? "s" : ""}`;
}
