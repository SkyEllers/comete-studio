/**
 * Deux flèches, deux lignes touchées. Ces cas-là décident de l'ordre dans
 * lequel Radar interroge ses canaux — Google Ads avant SEO — et se déroulent
 * en quelques microsecondes plutôt qu'à l'écran, un clic à la fois.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { echanger } from "./reordonner.ts";

const LISTE = [
  { id: "a", sort_order: 10 },
  { id: "b", sort_order: 20 },
  { id: "c", sort_order: 30 },
];

describe("échanger deux positions", () => {
  it("1. monter prend la place du voisin du dessus", () => {
    assert.deepEqual(echanger(LISTE, "b", "haut"), {
      bouge: { id: "b", sort_order: 10 },
      voisin: { id: "a", sort_order: 20 },
    });
  });

  it("2. descendre, celle du dessous", () => {
    assert.deepEqual(echanger(LISTE, "b", "bas"), {
      bouge: { id: "b", sort_order: 30 },
      voisin: { id: "c", sort_order: 20 },
    });
  });

  it("3. la liste d'entrée n'a pas besoin d'être triée", () => {
    const melangee = [LISTE[2]!, LISTE[0]!, LISTE[1]!];
    assert.deepEqual(echanger(melangee, "b", "haut"), {
      bouge: { id: "b", sort_order: 10 },
      voisin: { id: "a", sort_order: 20 },
    });
  });

  it("4. deux lignes, jamais trois", () => {
    const echange = echanger(LISTE, "a", "bas")!;
    assert.equal(new Set([echange.bouge.id, echange.voisin.id]).size, 2);
    assert.equal(echange.bouge.id === "c" || echange.voisin.id === "c", false);
  });
});

describe("les bouts de la liste", () => {
  it("5. la première ne monte pas", () => {
    assert.equal(echanger(LISTE, "a", "haut"), null);
  });

  it("6. la dernière ne descend pas", () => {
    assert.equal(echanger(LISTE, "c", "bas"), null);
  });

  it("7. une ligne seule ne bouge d'aucun côté", () => {
    const seule = [{ id: "a", sort_order: 0 }];
    assert.equal(echanger(seule, "a", "haut"), null);
    assert.equal(echanger(seule, "a", "bas"), null);
  });

  it("8. une ligne inconnue ne fait rien", () => {
    assert.equal(echanger(LISTE, "z", "haut"), null);
    assert.equal(echanger([], "a", "bas"), null);
  });
});

describe("les valeurs égales, héritées de la saisie libre", () => {
  /*
   * Deux voisins à la même valeur — ce que laissait passer un champ où l'on
   * tapait un entier — échangeraient deux fois la même chose, et le clic ne
   * ferait rien. On écarte alors d'un cran : ce clic répond à « celui-ci passe
   * avant celui-là », et c'est le seul ordre qu'il ait à corriger.
   */
  const EGALES = [
    { id: "a", sort_order: 5 },
    { id: "b", sort_order: 5 },
    { id: "c", sort_order: 9 },
  ];

  it("9. monter passe réellement devant", () => {
    const echange = echanger(EGALES, "b", "haut")!;
    assert.equal(echange.bouge.sort_order < echange.voisin.sort_order, true);
    assert.equal(echange.bouge.id, "b");
    assert.equal(echange.voisin.id, "a");
  });

  it("10. descendre passe réellement derrière", () => {
    const echange = echanger(EGALES, "a", "bas")!;
    assert.equal(echange.bouge.sort_order > echange.voisin.sort_order, true);
    assert.equal(echange.bouge.id, "a");
    assert.equal(echange.voisin.id, "b");
  });

  it("11. et l'ordre obtenu est bien inversé", () => {
    const echange = echanger(EGALES, "b", "haut")!;
    const apres = EGALES.map((ligne) =>
      ligne.id === echange.bouge.id
        ? echange.bouge
        : ligne.id === echange.voisin.id
          ? echange.voisin
          : ligne,
    ).sort((x, y) => x.sort_order - y.sort_order);

    assert.deepEqual(apres.map((l) => l.id), ["b", "a", "c"]);
  });
});
