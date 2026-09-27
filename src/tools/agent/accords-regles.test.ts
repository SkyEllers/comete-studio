import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { empreinte, finNumero, FORMAT_JETON, jetonNeuf } from "./accords-regles.ts";

describe("Accord WhatsApp — le lien", () => {
  it("un jeton neuf a la bonne forme et ne se répète pas", () => {
    const a = jetonNeuf();
    assert.match(a, FORMAT_JETON);
    assert.notEqual(a, jetonNeuf());
  });
  it("la base ne garde que l'empreinte SHA-256", () => {
    const e = empreinte("x".repeat(43));
    assert.match(e, /^[0-9a-f]{64}$/);
    assert.equal(e, empreinte("x".repeat(43)));
  });
  it("un jeton mal formé est refusé avant toute lecture", () => {
    assert.equal(FORMAT_JETON.test("court"), false);
    assert.equal(FORMAT_JETON.test("a".repeat(42) + "/"), false);
  });
  it("la page ne montre que les deux derniers chiffres", () => {
    assert.equal(finNumero("+33612345678"), "78");
    assert.equal(finNumero("06 12 34 56 78"), "78");
    assert.equal(finNumero(null), null);
    assert.equal(finNumero("123"), null);
  });
});
