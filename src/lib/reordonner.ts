/**
 * L'échange de deux positions dans une liste rangée par `sort_order`.
 *
 * Fonction pure, sans `server-only` : elle décide de l'ordre d'attribution des
 * canaux de Radar, et c'est le genre de code qu'on veut pouvoir dérouler en
 * une seconde plutôt que de vérifier à l'écran.
 *
 * La règle est simple à dire et facile à écrire de travers : on ne recalcule
 * pas toute la liste, on échange deux valeurs. C'est ce qui rend le geste sûr
 * — deux lignes touchées, jamais dix — et c'est aussi ce qui oblige à traiter
 * le cas de deux voisins qui portent déjà la même valeur.
 */

export type Rangee = { id: string; sort_order: number };

export type Echange = {
  /** La ligne qu'on déplace, et sa nouvelle valeur. */
  bouge: { id: string; sort_order: number };
  /** Le voisin, qui prend l'ancienne. */
  voisin: { id: string; sort_order: number };
};

/**
 * Qui échange avec qui, et quelles valeurs prennent-ils.
 *
 * `null` quand il n'y a rien à faire : la ligne est introuvable, ou déjà au
 * bout. L'appelant répond alors « c'est fait » sans rien écrire, plutôt que
 * d'inventer une erreur pour un clic qui n'aurait pas dû être proposé.
 *
 * Le cas des valeurs égales : deux voisins à `0` — ce que laissait la saisie
 * libre — échangeraient deux fois la même chose, et le clic ne ferait rien.
 * On écarte alors d'un cran, ce qui suffit à inverser les deux **l'un par
 * rapport à l'autre**. Le reste de la liste peut garder ses doublons ; ce clic
 * répond à « celui-ci passe avant celui-là », pas à « range tout ».
 */
export function echanger(
  lignes: Rangee[],
  id: string,
  sens: "haut" | "bas",
): Echange | null {
  const rangees = [...lignes].sort((a, b) => a.sort_order - b.sort_order);

  const position = rangees.findIndex((ligne) => ligne.id === id);
  if (position < 0) return null;

  const cible = sens === "haut" ? position - 1 : position + 1;
  if (cible < 0 || cible >= rangees.length) return null;

  const bouge = rangees[position]!;
  const voisin = rangees[cible]!;

  if (bouge.sort_order !== voisin.sort_order) {
    return {
      bouge: { id: bouge.id, sort_order: voisin.sort_order },
      voisin: { id: voisin.id, sort_order: bouge.sort_order },
    };
  }

  const commun = bouge.sort_order;
  return sens === "haut"
    ? {
        bouge: { id: bouge.id, sort_order: commun - 1 },
        voisin: { id: voisin.id, sort_order: commun },
      }
    : {
        bouge: { id: bouge.id, sort_order: commun + 1 },
        voisin: { id: voisin.id, sort_order: commun },
      };
}
