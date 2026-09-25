import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estStop, sensDuBouton } from "./lecture.ts";
import { peggy } from "./profils/peggy.ts";

describe("estStop", () => {
  it("reconnaît STOP et ses variantes seules", () => {
    for (const t of ["STOP", "stop", " Stop. ", "Arrête", "arret", "ARRÊT !"]) {
      assert.equal(estStop(t), true, t);
    }
  });

  it("ne prend pas un empêchement pour un STOP", () => {
    for (const t of ["Stop, je ne pourrai pas venir", "stop tabac", "j'arrête pas de penser", ""]) {
      assert.equal(estStop(t), false, t);
    }
  });
});

describe("sensDuBouton", () => {
  it("retrouve le sens d'un bouton par son libellé", () => {
    assert.equal(sensDuBouton(peggy, "Oui, c'est bon"), "confirme");
    assert.equal(sensDuBouton(peggy, "Je dois décaler"), "changer");
    assert.equal(sensDuBouton(peggy, "J'ai un empêchement"), "changer");
    assert.equal(sensDuBouton(peggy, "Peut-être"), null);
  });
});
