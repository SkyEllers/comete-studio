/**
 * Un montant tapé à la main devient une facture. Ces cas-là valent d'être
 * déroulés en une seconde plutôt que découverts sur un relevé contesté.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  centimesSaisis,
  dateDeVente,
  moisDeLaVente,
  montant,
  nomComplet,
} from "./format.ts";

describe("centimesSaisis — les formes qu'on accepte", () => {
  it("1. un entier", () => {
    assert.equal(centimesSaisis("1200"), 120000);
  });

  it("2. une virgule décimale, comme on écrit en français", () => {
    assert.equal(centimesSaisis("1200,50"), 120050);
    assert.equal(centimesSaisis("0,05"), 5);
  });

  it("3. un point décimal, comme le tape un clavier de téléphone", () => {
    assert.equal(centimesSaisis("1200.50"), 120050);
  });

  it("4. des espaces de milliers, y compris insécables et fines", () => {
    assert.equal(centimesSaisis("1 200"), 120000);
    assert.equal(centimesSaisis("1 200,50"), 120050);
    assert.equal(centimesSaisis("1 200"), 120000);
  });

  it("5. quand les deux séparateurs sont là, la virgule décide", () => {
    assert.equal(centimesSaisis("1.200,50"), 120050);
    assert.equal(centimesSaisis("1.200.000,10"), 120000010);
  });

  it("6. le symbole recopié avec le montant", () => {
    assert.equal(centimesSaisis("1 200 €"), 120000);
  });

  it("7. un centime ne se perd pas en virgule flottante", () => {
    // 12,29 × 100 vaut 1228.9999999999998 sans arrondi.
    assert.equal(centimesSaisis("12,29"), 1229);
    assert.equal(centimesSaisis("1,15"), 115);
    assert.equal(centimesSaisis("8,45"), 845);
  });
});

describe("centimesSaisis — ce qu'on refuse", () => {
  it("8. rien, ou des espaces", () => {
    assert.equal(centimesSaisis(""), null);
    assert.equal(centimesSaisis("   "), null);
    assert.equal(centimesSaisis(null), null);
    assert.equal(centimesSaisis(undefined), null);
  });

  it("9. ce qui n'est pas un nombre", () => {
    assert.equal(centimesSaisis("mille deux cents"), null);
    assert.equal(centimesSaisis("1200x"), null);
    assert.equal(centimesSaisis("--12"), null);
  });

  it("10. un montant négatif : une vente ne retire pas d'argent", () => {
    assert.equal(centimesSaisis("-1200"), null);
  });

  it("11. plus de deux décimales : personne ne facture des millièmes", () => {
    assert.equal(centimesSaisis("12,345"), null);
  });
});

describe("les dates d'une vente", () => {
  it("12. « 2026-09-03 » se lit « 3 septembre »", () => {
    assert.equal(dateDeVente("2026-09-03"), "3 septembre");
  });

  it("13. le premier du mois ne recule pas la veille", () => {
    // Le piège du fuseau : lu à Paris, « 2026-09-01T00:00Z » est déjà le 1er,
    // mais un décalage négatif le ramènerait au 31 août.
    assert.equal(dateDeVente("2026-09-01"), "1 septembre");
    assert.equal(moisDeLaVente("2026-09-01"), "2026-09-01");
  });

  it("14. le mois d'une vente est celui de sa date", () => {
    assert.equal(moisDeLaVente("2026-09-30"), "2026-09-01");
    assert.equal(moisDeLaVente("2026-12-31"), "2026-12-01");
  });
});

describe("montant — le cache ne décide pas des centimes", () => {
  /*
   * Le défaut qu'ils fixent : le formateur était mis en cache sur la seule
   * devise, alors que ses options dépendent du montant. Le premier appel d'une
   * instance décidait donc du format de tous les suivants — « 90 € » d'abord,
   * et une vente de 2 450,50 € s'affichait « 2 451 € ».
   *
   * L'ordre des appels fait tout : ces deux tests seraient verts, séparément,
   * avec le code fautif.
   */
  /*
   * Les espaces d'`Intl` sont insécables et invisibles à la relecture : fine
   * (U+202F) entre les milliers, normale (U+00A0) devant le symbole. Écrites
   * en échappement, elles ne se perdent pas dans un copier-coller.
   */
  const MILLIERS = " ";
  const AVANT_SYMBOLE = " ";
  const eur = (texte: string) => `${texte}${AVANT_SYMBOLE}€`;

  it("17. un montant rond n'affiche pas de centimes, un autre si", () => {
    assert.equal(montant(9000), eur("90"));
    assert.equal(montant(245050), eur(`2${MILLIERS}450,50`));
  });

  it("18. … et l'inverse, après un montant à centimes", () => {
    assert.equal(montant(245050), eur(`2${MILLIERS}450,50`));
    assert.equal(montant(9000), eur("90"));
    assert.equal(montant(120000), eur(`1${MILLIERS}200`));
  });

  it("19. aucun centime ne disparaît d'un écran de commission", () => {
    assert.equal(montant(1), eur("0,01"));
    assert.equal(montant(99), eur("0,99"));
    assert.equal(montant(0), eur("0"));
  });
});

describe("nomComplet", () => {
  it("15. les deux morceaux, ou celui qui existe", () => {
    assert.equal(nomComplet("Camille", "Dupont"), "Camille Dupont");
    assert.equal(nomComplet("Camille", ""), "Camille");
    assert.equal(nomComplet("", "Dupont"), "Dupont");
  });

  it("16. rien du tout rend null : c'est à l'écran de nommer l'absence", () => {
    assert.equal(nomComplet("", ""), null);
    assert.equal(nomComplet(null, undefined), null);
    assert.equal(nomComplet("  ", " "), null);
  });
});
