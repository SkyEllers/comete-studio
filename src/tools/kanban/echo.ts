/**
 * Écho de nos propres écritures.
 *
 * Le temps réel renvoie aussi ce qu'on vient d'écrire. Comme l'écran a déjà
 * été mis à jour de façon optimiste, rejouer l'événement ne changerait rien —
 * sauf quand deux gestes se suivent vite : l'écho du premier arrive après
 * qu'on a appliqué le second et fait sauter la carte en arrière.
 *
 * On note donc l'identifiant *avant* d'écrire, et le canal ignore le premier
 * événement qui le concerne. Une marque n'est valable qu'une fois et qu'un
 * court instant : passé ce délai, un changement venu d'ailleurs doit passer.
 *
 * Les insertions n'ont pas besoin de ça : leur identifiant n'existe pas encore,
 * et le réducteur ignore une ligne déjà présente.
 */

const RECENTES = new Map<string, number>();
const FENETRE = 4000;

function purge(maintenant: number) {
  for (const [cle, instant] of RECENTES) {
    if (maintenant - instant > FENETRE) RECENTES.delete(cle);
  }
}

/** À appeler juste avant une mise à jour ou une suppression. */
export function marquerEcriture(table: string, id: string) {
  const maintenant = Date.now();
  if (RECENTES.size > 100) purge(maintenant);
  RECENTES.set(`${table}:${id}`, maintenant);
}

/** Consomme la marque : le prochain événement sur cette ligne sera pris. */
export function estNotreEcho(table: string, id: string) {
  const cle = `${table}:${id}`;
  const instant = RECENTES.get(cle);
  if (instant === undefined) return false;

  RECENTES.delete(cle);
  return Date.now() - instant < FENETRE;
}
