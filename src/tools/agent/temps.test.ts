import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { heureDuRdv, heureEnMots, intervalleMs, jourEnMots } from "./temps.ts";

describe("temps", () => {
  it("écrit le jour et l'heure dans le fuseau de la cliente", () => {
    assert.equal(jourEnMots("2026-10-08T12:00:00Z", "Europe/Paris"), "jeudi 8 octobre");
    assert.equal(heureEnMots("2026-10-08T12:00:00Z", "Europe/Paris"), "14h");
    assert.equal(heureEnMots("2026-10-08T07:30:00Z", "Europe/Paris"), "9h30");
    assert.equal(heureEnMots("2026-10-08T12:00:00Z", "America/Montreal"), "8h");
  });

  it("donne aussi l'heure de Paris quand son fuseau est ailleurs", () => {
    assert.equal(heureDuRdv("2026-10-22T17:00:00Z", "Europe/Paris"), "19h");
    assert.equal(heureDuRdv("2026-10-22T17:00:00Z", "Europe/Berlin"), "19h");
    assert.equal(heureDuRdv("2026-10-22T17:00:00Z", "America/Guadeloupe"), "13h chez toi (19h heure de Paris)");
    assert.equal(heureDuRdv("2026-10-21T08:00:00Z", "America/Santo_Domingo"), "4h chez toi (10h heure de Paris)");
  });

  it("lit les intervalles de Postgres", () => {
    assert.equal(intervalleMs("24:00:00"), 86_400_000);
    assert.equal(intervalleMs("1 day 02:00:00"), 93_600_000);
    assert.equal(intervalleMs("00:00:00"), 0);
  });
});
