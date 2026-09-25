import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { heureEnMots, intervalleMs, jourEnMots } from "./temps.ts";

describe("temps", () => {
  it("écrit le jour et l'heure dans le fuseau de la cliente", () => {
    assert.equal(jourEnMots("2026-10-08T12:00:00Z", "Europe/Paris"), "jeudi 8 octobre");
    assert.equal(heureEnMots("2026-10-08T12:00:00Z", "Europe/Paris"), "14h");
    assert.equal(heureEnMots("2026-10-08T07:30:00Z", "Europe/Paris"), "9h30");
    assert.equal(heureEnMots("2026-10-08T12:00:00Z", "America/Montreal"), "8h");
  });

  it("lit les intervalles de Postgres", () => {
    assert.equal(intervalleMs("24:00:00"), 86_400_000);
    assert.equal(intervalleMs("1 day 02:00:00"), 93_600_000);
    assert.equal(intervalleMs("00:00:00"), 0);
  });
});
