/**
 * Le seul endroit du hub où du texte tapé par un client entre dans la
 * grammaire de filtre de PostgREST. Ces cas-là se déroulent en quelques
 * microsecondes ; les découvrir en production coûterait une requête cassée sur
 * l'écran d'une cliente.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nettoyerRecherche } from "./recherche.ts";

describe("nettoyerRecherche — ce qui passe", () => {
  it("1. un nom ordinaire passe tel quel", () => {
    assert.equal(nettoyerRecherche("Dupont"), "Dupont");
  });

  it("2. les accents et les écritures non latines sont des lettres", () => {
    assert.equal(nettoyerRecherche("Géraldine"), "Géraldine");
    assert.equal(nettoyerRecherche("Aliyah Хмельницька"), "Aliyah Хмельницька");
  });

  it("3. la ponctuation d'un nom survit", () => {
    assert.equal(nettoyerRecherche("Martin-Blanc"), "Martin-Blanc");
    assert.equal(nettoyerRecherche("O'Connor"), "O'Connor");
    assert.equal(nettoyerRecherche("D’Angelo"), "D’Angelo");
    assert.equal(nettoyerRecherche("J. Martin"), "J. Martin");
  });

  it("4. les espaces de bord et les doublons sont réduits", () => {
    assert.equal(nettoyerRecherche("  Camille   Dupont  "), "Camille Dupont");
  });
});

describe("nettoyerRecherche — ce qui tombe", () => {
  it("5. rien de cherchable rend null", () => {
    assert.equal(nettoyerRecherche(""), null);
    assert.equal(nettoyerRecherche("   "), null);
    assert.equal(nettoyerRecherche(null), null);
    assert.equal(nettoyerRecherche(undefined), null);
    assert.equal(nettoyerRecherche("%%%"), null);
  });

  it("6. les jokers de `like` ne servent pas à tout afficher", () => {
    assert.equal(nettoyerRecherche("%"), null);
    assert.equal(nettoyerRecherche("a%b"), "a b");
    assert.equal(nettoyerRecherche("a_b"), "a b");
  });

  it("7. la grammaire de PostgREST ne traverse pas", () => {
    // Virgule : sépare deux conditions. Parenthèses : ouvrent un groupe.
    // Le terme sort désarmé, et surtout : il sort.
    const terme = nettoyerRecherche("a,invitee_key.ilike.*") ?? "";
    assert.equal(terme.includes(","), false);
    assert.equal(terme.includes("*"), false);

    for (const caractere of [",", "(", ")", "*", ":", '"', "\\", "%", "_"]) {
      assert.equal((nettoyerRecherche(`x${caractere}y`) ?? "").includes(caractere), false);
    }
  });

  it("8. le point reste, parce qu'un nom abrégé en porte un", () => {
    // Il est sans danger : il ne sépare colonne et opérateur qu'en tête de
    // condition, jamais à l'intérieur d'une valeur.
    assert.equal(nettoyerRecherche("J.-P. Martin"), "J.-P. Martin");
  });

  it("9. un terme démesuré est coupé", () => {
    assert.equal(nettoyerRecherche("a".repeat(500))?.length, 60);
  });

  it("10. une coupure ne laisse pas d'espace en fin de terme", () => {
    const terme = nettoyerRecherche(`${"a".repeat(59)} bcdef`);
    assert.equal(terme, "a".repeat(59));
  });
});
