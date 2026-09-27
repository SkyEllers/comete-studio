import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { absenceEnMots, maximumSchema, plagesSchema, problemeAbsence, problemePlages, visioSchema } from "./reglages.ts";

describe("les horaires saisis", () => {
  it("acceptent plusieurs plages le même jour, qui se suivent", () => {
    assert.equal(problemePlages([
      { jour: 1, debut: "09:00", fin: "12:00" },
      { jour: 1, debut: "12:00", fin: "13:00" },
      { jour: 2, debut: "14:00", fin: "18:00" },
    ]), null);
  });

  it("refusent une plage à l'envers ou vide", () => {
    assert.equal(problemePlages([{ jour: 1, debut: "12:00", fin: "09:00" }]), "Une plage finit avant de commencer.");
    assert.equal(problemePlages([{ jour: 1, debut: "09:00", fin: "09:00" }]), "Une plage finit avant de commencer.");
  });

  it("refusent deux plages qui se chevauchent, en nommant le jour", () => {
    assert.equal(
      problemePlages([
        { jour: 3, debut: "14:00", fin: "16:00" },
        { jour: 3, debut: "09:00", fin: "14:30" },
      ]),
      "Deux plages se chevauchent le mercredi.",
    );
  });

  it("refusent plus de cinq plages par jour", () => {
    const six = [8, 9, 10, 11, 12, 13].map((h) => ({ jour: 1, debut: `${String(h).padStart(2, "0")}:00`, fin: `${String(h).padStart(2, "0")}:30` }));
    assert.match(problemePlages(six) ?? "", /cinq par jour/);
  });

  it("refusent une heure mal écrite ou un jour inconnu", () => {
    assert.equal(plagesSchema.safeParse([{ jour: 1, debut: "9h", fin: "12:00" }]).success, false);
    assert.equal(plagesSchema.safeParse([{ jour: 8, debut: "09:00", fin: "12:00" }]).success, false);
    assert.equal(plagesSchema.safeParse([{ jour: 1, debut: "24:00", fin: "12:00" }]).success, false);
    assert.equal(plagesSchema.safeParse([]).success, true);
  });
});

describe("les absences saisies", () => {
  it("un jour, ou une période", () => {
    assert.equal(problemeAbsence({ du: "2026-10-05", au: "2026-10-05" }, "2026-10-01"), null);
    assert.equal(problemeAbsence({ du: "2026-10-05", au: "2026-10-09" }, "2026-10-01"), null);
  });

  it("refusent une fin avant le début, et une période déjà passée", () => {
    assert.equal(problemeAbsence({ du: "2026-10-09", au: "2026-10-05" }, "2026-10-01"), "La fin tombe avant le début.");
    assert.equal(problemeAbsence({ du: "2026-09-20", au: "2026-09-22" }, "2026-10-01"), "Cette date est déjà passée.");
  });

  it("acceptent une période commencée qui n'est pas finie", () => {
    assert.equal(problemeAbsence({ du: "2026-09-28", au: "2026-10-03" }, "2026-10-01"), null);
  });

  it("se disent en mots", () => {
    assert.equal(absenceEnMots("2026-10-05", "2026-10-05"), "le lundi 5 octobre");
    assert.equal(absenceEnMots("2026-10-05", "2026-10-07"), "du lundi 5 au mercredi 7 octobre");
    assert.equal(absenceEnMots("2026-10-30", "2026-11-02"), "du vendredi 30 octobre au lundi 2 novembre");
  });
});

describe("le maximum et la visio", () => {
  it("un maximum entre 1 et 20", () => {
    assert.equal(maximumSchema.parse("4"), 4);
    assert.equal(maximumSchema.safeParse("0").success, false);
    assert.equal(maximumSchema.safeParse("21").success, false);
    assert.equal(maximumSchema.safeParse("2.5").success, false);
  });

  it("Meet, ou un lien fixe en https", () => {
    assert.equal(visioSchema.safeParse({ visio: "meet" }).success, true);
    assert.equal(visioSchema.safeParse({ visio: "lien", lien: "https://zoom.us/j/123" }).success, true);
    const http = visioSchema.safeParse({ visio: "lien", lien: "http://zoom.us/j/123" });
    assert.equal(http.success, false);
    assert.equal(http.error?.issues[0].message, "Colle un lien qui commence par https://");
    assert.equal(visioSchema.safeParse({ visio: "lien", lien: "" }).success, false);
  });
});
