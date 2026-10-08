import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HEURES_POSSIBLES, parisVersIso } from "./deplacer.ts";

describe("Déplacer : l'heure de Paris", () => {
  it("passe l'heure de Paris en UTC, été comme hiver", () => {
    assert.equal(parisVersIso("2026-10-09", "19:15"), "2026-10-09T17:15:00.000Z");
    assert.equal(parisVersIso("2026-11-05", "19:15"), "2026-11-05T18:15:00.000Z");
    // Le dimanche du passage à l'heure d'hiver.
    assert.equal(parisVersIso("2026-10-25", "10:00"), "2026-10-25T09:00:00.000Z");
  });

  it("refuse une date qui n'existe pas", () => {
    assert.equal(parisVersIso("2026-02-30", "10:00"), null);
    assert.equal(parisVersIso("2026-10-09", "25:00"), null);
  });

  it("propose les quarts d'heure de 7h à 21h45", () => {
    assert.equal(HEURES_POSSIBLES[0], "07:00");
    assert.equal(HEURES_POSSIBLES.at(-1), "21:45");
    assert.equal(HEURES_POSSIBLES.length, 60);
  });
});
