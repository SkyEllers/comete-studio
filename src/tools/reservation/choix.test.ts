import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ordonner, rang, taux, type Candidate } from "./choix.ts";

function c(id: string, sur: Partial<Candidate> = {}): Candidate {
  return {
    id,
    role: "closeuse",
    honoresTotal: 20,
    honoresPeriode: 10,
    ventesPeriode: 2,
    derniereAttribution: null,
    ...sur,
  };
}

const ids = (liste: Candidate[]) => liste.map((x) => x.id);

describe("le choix de la personne", () => {
  it("la titulaire passe après les closeuses, même quand elle vend mieux", () => {
    const peggy = c("peggy", { role: "titulaire", honoresPeriode: 10, ventesPeriode: 9 });
    const closeuse = c("c", { honoresPeriode: 10, ventesPeriode: 1 });
    assert.deepEqual(ids(ordonner([peggy, closeuse], 10)), ["c", "peggy"]);
  });

  it("une débutante passe avant une closeuse confirmée qui vend bien", () => {
    const debutante = c("d", { honoresTotal: 3, honoresPeriode: 3, ventesPeriode: 0 });
    const confirmee = c("c", { honoresPeriode: 10, ventesPeriode: 5 });
    assert.deepEqual(ids(ordonner([confirmee, debutante], 10)), ["d", "c"]);
  });

  it("le seuil : 9 rendez-vous honorés, débutante ; 10, confirmée", () => {
    assert.equal(rang(c("x", { honoresTotal: 9 }), 10), "debutante");
    assert.equal(rang(c("x", { honoresTotal: 10 }), 10), "closeuse");
    assert.equal(rang(c("x", { role: "titulaire", honoresTotal: 0 }), 10), "titulaire");
  });

  it("entre débutantes, à tour de rôle : jamais servie d'abord, puis la plus anciennement servie", () => {
    const d1 = c("d1", { honoresTotal: 0, derniereAttribution: 2_000 });
    const d2 = c("d2", { honoresTotal: 0, derniereAttribution: 1_000 });
    const d3 = c("d3", { honoresTotal: 0, derniereAttribution: null });
    assert.deepEqual(ids(ordonner([d1, d2, d3], 10)), ["d3", "d2", "d1"]);
  });

  it("entre débutantes, le taux ne compte pas", () => {
    const bonne = c("bonne", { honoresTotal: 5, honoresPeriode: 5, ventesPeriode: 4, derniereAttribution: 2_000 });
    const autre = c("autre", { honoresTotal: 5, honoresPeriode: 5, ventesPeriode: 0, derniereAttribution: 1_000 });
    assert.deepEqual(ids(ordonner([bonne, autre], 10)), ["autre", "bonne"]);
  });

  it("entre closeuses confirmées, celle qui vend le mieux d'abord", () => {
    const a = c("a", { honoresPeriode: 10, ventesPeriode: 2 });
    const b = c("b", { honoresPeriode: 8, ventesPeriode: 3 });
    const d = c("d", { honoresPeriode: 20, ventesPeriode: 3 });
    assert.deepEqual(ids(ordonner([a, b, d], 10)), ["b", "a", "d"]);
  });

  it("à taux égal, à tour de rôle", () => {
    const a = c("a", { honoresPeriode: 10, ventesPeriode: 2, derniereAttribution: 5_000 });
    const b = c("b", { honoresPeriode: 5, ventesPeriode: 1, derniereAttribution: 1_000 });
    assert.deepEqual(ids(ordonner([a, b], 10)), ["b", "a"]);
  });

  it("sans rendez-vous honoré sur la période, le taux vaut 0", () => {
    assert.equal(taux({ honoresPeriode: 0, ventesPeriode: 0 }), 0);
    const silencieuse = c("s", { honoresPeriode: 0, ventesPeriode: 0 });
    const faible = c("f", { honoresPeriode: 10, ventesPeriode: 1 });
    assert.deepEqual(ids(ordonner([silencieuse, faible], 10)), ["f", "s"]);
  });

  it("à égalité parfaite, l'ordre est stable (par identifiant)", () => {
    assert.deepEqual(ids(ordonner([c("b"), c("a")], 10)), ["a", "b"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const liste = [c("b"), c("a")];
    ordonner(liste, 10);
    assert.deepEqual(ids(liste), ["b", "a"]);
  });
});
