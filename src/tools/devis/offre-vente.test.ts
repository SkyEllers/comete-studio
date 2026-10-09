import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { choixDUneVente, choixParCle } from "./offre-vente-choix.ts";
import { choixDeVente, offreDeVente } from "./offre-vente.ts";
import { devisPeggy } from "./profils/peggy.ts";

describe("la vente notée dans Radar, sur l'offre du devis (08/10/2026)", () => {
  const offre = choixDeVente(devisPeggy);
  const par = (cle: string) => {
    const c = choixParCle(offre, cle);
    assert.ok(c, `choix ${cle} absent`);
    return c;
  };

  it("6, 9, 12 mois : 500 € + 150 €/mois, 50 € de moins en une fois", () => {
    assert.equal(par("6:une_fois").montantCents, 135_000);
    assert.equal(par("6:plusieurs").montantCents, 140_000);
    assert.equal(par("9:une_fois").montantCents, 180_000);
    assert.equal(par("9:plusieurs").montantCents, 185_000);
    assert.equal(par("12:une_fois").montantCents, 225_000);
    assert.equal(par("12:plusieurs").montantCents, 230_000);
  });

  it("aucun choix ne fait 2 310 € (le montant tapé le 08/10)", () => {
    assert.equal(offre.some((c) => c.montantCents === 231_000), false);
  });

  it("l'investigation seule : 500 €, en 1 fois seulement", () => {
    assert.equal(par("0:une_fois").montantCents, 50_000);
    assert.equal(choixParCle(offre, "0:plusieurs"), null);
  });

  it("le bilan microbiote seul : 365 € en 1 fois, 2 × 190 € en 2 fois", () => {
    assert.equal(par("-1:une_fois").montantCents, 36_500);
    const deux = par("-1:plusieurs");
    assert.equal(deux.montantCents, 38_000);
    assert.equal(deux.fois, 2);
    assert.equal(deux.premierCents, 19_000);
    assert.equal(deux.note, "Bilan microbiote, en 2 fois");
  });

  it("en plusieurs fois, comme un devis payé : un paiement par mois, le premier porte l'investigation", () => {
    const c = par("12:plusieurs");
    assert.equal(c.fois, 12);
    assert.equal(c.premierCents, 65_000);
    assert.equal(c.premierCents! + 11 * 15_000, c.montantCents);
    assert.equal(c.note, "12 mois, en 12 fois");
  });

  it("en une fois : un seul paiement", () => {
    const c = par("9:une_fois");
    assert.equal(c.fois, 1);
    assert.equal(c.premierCents, null);
    assert.equal(c.note, "9 mois, en 1 fois");
  });

  it("pas de 3 mois, ni de 24 : les durées des closeuses seulement", () => {
    assert.deepEqual(
      [...new Set(offre.map((c) => c.prise))],
      [6, 9, 12, 0, -1],
    );
  });

  it("une vente déjà notée retrouve son choix, sinon « Autre montant »", () => {
    assert.equal(choixDUneVente(offre, { montantCents: 225_000, fois: 1 })?.cle, "12:une_fois");
    assert.equal(choixDUneVente(offre, { montantCents: 230_000, fois: 12 })?.cle, "12:plusieurs");
    assert.equal(choixDUneVente(offre, { montantCents: 231_000, fois: 1 }), null);
    assert.equal(choixDUneVente(offre, { montantCents: 230_000, fois: 1 }), null);
  });

  it("un espace sans modèle de devis garde le montant libre", () => {
    assert.equal(offreDeVente("jonathan"), null);
    assert.ok(offreDeVente("peggy"));
  });
});
