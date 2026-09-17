/**
 * Horizon : les calculs d'un relevé et la lecture des lignes saisies.
 *
 *   npm run test
 *
 * Un relevé d'argent qui se trompe d'un euro perd la confiance du client pour
 * tous les mois suivants : le circuit (résultat, impôts, salaire, réserve) et
 * la saisie « Libellé ; montant » sont vérifiés ici, hors du navigateur.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { avancement, calculer } from "./calculs.ts";
import { contenuSchema, ecrireLignes, lireLignes, lireMontant } from "./contenu.ts";

describe("lireMontant", () => {
  it("lit les montants tels qu'on les tape", () => {
    assert.equal(lireMontant("1650"), 165000);
    assert.equal(lireMontant("1 650"), 165000);
    assert.equal(lireMontant("1 650 €"), 165000);
    assert.equal(lireMontant("14,40"), 1440);
    assert.equal(lireMontant("0"), 0);
  });

  it("refuse ce qui n'est pas un montant", () => {
    assert.equal(lireMontant("mille"), null);
    assert.equal(lireMontant("-20"), null);
    assert.equal(lireMontant("12,345"), null);
    assert.equal(lireMontant(""), null);
  });
});

describe("lireLignes", () => {
  it("lit une ligne par libellé, ignore les lignes vides", () => {
    const lu = lireLignes("Laetitia ; 1650\n\nComète ; 2 100\n");
    assert.equal(lu.ok, true);
    if (lu.ok) {
      assert.deepEqual(lu.lignes, [
        { libelle: "Laetitia", centimes: 165000, budgetCentimes: null },
        { libelle: "Comète", centimes: 210000, budgetCentimes: null },
      ]);
    }
  });

  it("lit le budget quand on le demande", () => {
    const lu = lireLignes("Courses ; 700 ; 650", { avecBudget: true });
    assert.equal(lu.ok, true);
    if (lu.ok) assert.equal(lu.lignes[0]!.budgetCentimes, 65000);
  });

  it("donne le numéro de la ligne fautive", () => {
    const lu = lireLignes("Laetitia ; 1650\nComète deux mille");
    assert.equal(lu.ok, false);
    if (!lu.ok) assert.match(lu.erreur, /Ligne 2/);
  });

  it("se relit dans le même format", () => {
    const texte = "Courses ; 700 ; 650\nFloride ; 60,50";
    const lu = lireLignes(texte, { avecBudget: true });
    assert.equal(lu.ok, true);
    if (lu.ok) assert.equal(ecrireLignes(lu.lignes), texte);
  });
});

describe("calculer", () => {
  const base = contenuSchema.parse({
    entrees: [{ libelle: "Clientes", centimes: 1_450_000 }],
    charges: [{ libelle: "Charges", centimes: 820_000 }],
    tauxImpots: 40,
    salaireCentimes: 340_000,
  });

  it("déroule le circuit : résultat, impôts, salaire, réserve", () => {
    const calculs = calculer(base);
    assert.equal(calculs.resultat, 630_000);
    assert.equal(calculs.impots, 252_000);
    assert.equal(calculs.apresImpots, 378_000);
    assert.equal(calculs.versReserve, 38_000);
  });

  it("ne met rien de côté un mois à perte, et prend le salaire sur la réserve", () => {
    const calculs = calculer({ ...base, entrees: [{ libelle: "Clientes", centimes: 700_000, budgetCentimes: null }] });
    assert.equal(calculs.resultat, -120_000);
    assert.equal(calculs.impots, 0);
    assert.equal(calculs.versReserve, -460_000);
  });

  it("ne compte le budget de la vie que s'il est renseigné", () => {
    assert.equal(calculer(base).vieBudget, null);
  });
});

describe("avancement", () => {
  it("borne entre 0 et 100", () => {
    assert.equal(avancement(38_000, 1_020_000), 4);
    assert.equal(avancement(2_000_000, 1_020_000), 100);
    assert.equal(avancement(-10, 1_020_000), 0);
    assert.equal(avancement(10, 0), 0);
  });
});
