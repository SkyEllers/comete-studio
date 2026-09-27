import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { instantLocal } from "../agent/temps.ts";

import {
  calculerCreneaux,
  creneauxDePersonne,
  jourDeSemaine,
  paliers,
  parJour,
  personnesLibresA,
  type PersonneDispo,
  type Regles,
} from "./creneaux.ts";

const P = "Europe/Paris";
const M = 60_000;
const heure = (jour: string, h: number, m = 0, fuseau = P) => instantLocal(jour, h, m, fuseau);
const iso = (t: number) => new Date(t).toISOString();

const regles: Regles = {
  dureeMinutes: 45,
  pauseMinutes: 15,
  pasMinutes: 15,
  preavisMinutes: 120,
  fenetreJours: 4,
  fenetrePasJours: 2,
  fenetreMaxJours: 21,
  fuseau: P,
};

// Dimanche 4 octobre 2026, 10h à Paris.
const DIMANCHE = "2026-10-04";
const LUNDI = "2026-10-05";
const maintenant = heure(DIMANCHE, 10);

function personne(sur: Partial<PersonneDispo> = {}): PersonneDispo {
  return {
    id: "a",
    fuseau: P,
    maxParJour: 10,
    plages: [{ jour: 1, debut: "09:00", fin: "12:00" }],
    absences: [],
    occupe: [],
    diagnostics: [],
    ...sur,
  };
}

/** Les heures libres d'un jour, en « 9:15 ». */
function heures(p: PersonneDispo, jour: string, r: Regles = regles, fuseau = P): string[] {
  return creneauxDePersonne(p, r, heure(jour, 0, 0, fuseau), heure(jour, 23, 59, fuseau)).map((t) => {
    const f = new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau, hour: "numeric", minute: "2-digit", hourCycle: "h23" });
    return f.format(new Date(t)).replace(/^0/, "");
  });
}

describe("jours de la semaine", () => {
  it("lundi vaut 1, dimanche 7", () => {
    assert.equal(jourDeSemaine(LUNDI), 1);
    assert.equal(jourDeSemaine(DIMANCHE), 7);
  });
});

describe("les plages habituelles", () => {
  it("découpe la plage au quart d'heure, et le dernier créneau finit à l'heure de fin", () => {
    const h = heures(personne(), LUNDI);
    assert.equal(h[0], "9:00");
    assert.equal(h.at(-1), "11:15");
    assert.equal(h.length, 10);
  });

  it("ne propose rien les jours sans plage", () => {
    assert.deepEqual(heures(personne(), "2026-10-06"), []);
  });

  it("additionne plusieurs plages le même jour, sans doublon", () => {
    const p = personne({
      plages: [
        { jour: 1, debut: "09:00", fin: "10:00" },
        { jour: 1, debut: "14:00", fin: "15:00" },
        { jour: 1, debut: "09:00", fin: "10:00" },
      ],
    });
    assert.deepEqual(heures(p, LUNDI), ["9:00", "9:15", "14:00", "14:15"]);
  });

  it("une plage trop courte pour un diagnostic ne donne rien", () => {
    assert.deepEqual(heures(personne({ plages: [{ jour: 1, debut: "09:00", fin: "09:30" }] }), LUNDI), []);
  });
});

describe("la pause de 15 minutes", () => {
  it("laisse 15 minutes avant et après chaque diagnostic", () => {
    const p = personne({ diagnostics: [{ debut: heure(LUNDI, 10), fin: heure(LUNDI, 10, 45) }] });
    assert.deepEqual(heures(p, LUNDI), ["9:00", "11:00", "11:15"]);
  });

  it("sans pause réglée, les diagnostics se touchent", () => {
    const p = personne({ diagnostics: [{ debut: heure(LUNDI, 10), fin: heure(LUNDI, 10, 45) }] });
    assert.deepEqual(heures(p, LUNDI, { ...regles, pauseMinutes: 0 }), ["9:00", "9:15", "10:45", "11:00", "11:15"]);
  });
});

describe("le maximum par jour", () => {
  it("un jour où elle a atteint son maximum ne propose plus rien", () => {
    const p = personne({ maxParJour: 1, diagnostics: [{ debut: heure(LUNDI, 9), fin: heure(LUNDI, 9, 45) }] });
    assert.deepEqual(heures(p, LUNDI), []);
  });

  it("sous le maximum, le jour reste ouvert", () => {
    const p = personne({ maxParJour: 2, diagnostics: [{ debut: heure(LUNDI, 9), fin: heure(LUNDI, 9, 45) }] });
    assert.deepEqual(heures(p, LUNDI), ["10:00", "10:15", "10:30", "10:45", "11:00", "11:15"]);
  });

  it("compte les diagnostics dans son fuseau à elle", () => {
    // Lundi 21h à Montréal, c'est mardi 3h à Paris : ça compte pour son lundi.
    const M_ = "America/Montreal";
    const p = personne({
      fuseau: M_,
      maxParJour: 1,
      plages: [{ jour: 1, debut: "09:00", fin: "12:00" }, { jour: 1, debut: "20:00", fin: "22:00" }],
      diagnostics: [{ debut: heure(LUNDI, 20, 0, M_), fin: heure(LUNDI, 20, 45, M_) }],
    });
    assert.deepEqual(heures(p, LUNDI, regles, M_), []);
  });
});

describe("les absences", () => {
  it("un jour d'absence ne propose rien", () => {
    assert.deepEqual(heures(personne({ absences: [{ du: LUNDI, au: LUNDI }] }), LUNDI), []);
  });

  it("une période couvre ses deux bornes", () => {
    const p = personne({
      plages: [1, 2, 3].map((jour) => ({ jour, debut: "09:00", fin: "10:00" })),
      absences: [{ du: "2026-10-05", au: "2026-10-06" }],
    });
    assert.deepEqual(heures(p, "2026-10-05"), []);
    assert.deepEqual(heures(p, "2026-10-06"), []);
    assert.deepEqual(heures(p, "2026-10-07"), ["9:00", "9:15"]);
  });
});

describe("Google Agenda", () => {
  it("un rendez-vous perso bloque ce qu'il chevauche ; un créneau peut commencer dès sa fin", () => {
    const p = personne({ occupe: [{ debut: heure(LUNDI, 9, 30), fin: heure(LUNDI, 10) }] });
    assert.deepEqual(heures(p, LUNDI), ["10:00", "10:15", "10:30", "10:45", "11:00", "11:15"]);
  });

  it("un créneau doit laisser la pause libre avant l'occupé qui suit (tampon après, comme Calendly)", () => {
    const p = personne({ occupe: [{ debut: heure(LUNDI, 10), fin: heure(LUNDI, 12) }] });
    assert.deepEqual(heures(p, LUNDI), ["9:00"]);
    const q = personne({ occupe: [{ debut: heure(LUNDI, 9, 45), fin: heure(LUNDI, 12) }] });
    assert.deepEqual(heures(q, LUNDI), []);
  });
});

describe("le préavis", () => {
  it("rien ne commence dans moins de deux heures", () => {
    const lundi830 = heure(LUNDI, 8, 30);
    const r = calculerCreneaux([personne()], regles, lundi830);
    assert.equal(r.etat, "ouvert");
    assert.equal(r.creneaux[0].debut, iso(heure(LUNDI, 10, 30)));
  });
});

describe("la fenêtre", () => {
  it("les paliers : 4, 6, 8… jusqu'à 21", () => {
    assert.deepEqual(paliers(regles), [4, 6, 8, 10, 12, 14, 16, 18, 20, 21]);
    assert.deepEqual(paliers({ fenetreJours: 4, fenetrePasJours: 2, fenetreMaxJours: 4 }), [4]);
  });

  it("4 jours : un dimanche, jusqu'au jeudi compris, pas le vendredi", () => {
    const p = personne({ plages: [1, 4, 5].map((jour) => ({ jour, debut: "09:00", fin: "10:00" })) });
    const r = calculerCreneaux([p], regles, maintenant);
    assert.equal(r.etat, "ouvert");
    assert.equal(r.jours, 4);
    const jours = parJour(r.creneaux, P).map((j) => j.jour);
    assert.deepEqual(jours, ["2026-10-05", "2026-10-08"]);
  });

  it("le premier créneau libre est en tête", () => {
    const p = personne({ plages: [1, 2].map((jour) => ({ jour, debut: "09:00", fin: "12:00" })) });
    const r = calculerCreneaux([p], regles, maintenant);
    assert.equal(r.creneaux[0].debut, iso(heure(LUNDI, 9)));
    const debuts = r.creneaux.map((c) => Date.parse(c.debut));
    assert.deepEqual(debuts, [...debuts].sort((a, b) => a - b));
  });

  it("4 jours pleins : la fenêtre passe à 6", () => {
    // Seul le vendredi 9 (jour +5) a de la place.
    const p = personne({ plages: [{ jour: 5, debut: "09:00", fin: "10:00" }] });
    const r = calculerCreneaux([p], regles, maintenant);
    assert.equal(r.etat, "ouvert");
    assert.equal(r.jours, 6);
    assert.equal(r.creneaux[0].debut, iso(heure("2026-10-09", 9)));
  });

  it("la fenêtre s'arrête au premier palier qui a de la place", () => {
    // Libre au jour +5 et au jour +7 : on montre jusqu'à +6 seulement.
    const p = personne({
      plages: [{ jour: 5, debut: "09:00", fin: "10:00" }, { jour: 7, debut: "09:00", fin: "10:00" }],
      absences: [{ du: DIMANCHE, au: DIMANCHE }],
    });
    const r = calculerCreneaux([p], regles, maintenant);
    assert.equal(r.jours, 6);
    assert.ok(r.creneaux.every((c) => c.debut.startsWith("2026-10-09")));
  });

  it("le jour +21 est encore dans la fenêtre, le +22 non : complet", () => {
    const tout = [1, 2, 3, 4, 5, 6, 7].map((jour) => ({ jour, debut: "09:00", fin: "10:00" }));
    const jusquAu24 = { du: DIMANCHE, au: "2026-10-24" };
    const r21 = calculerCreneaux([personne({ plages: tout, absences: [jusquAu24] })], regles, maintenant);
    assert.equal(r21.etat, "ouvert");
    assert.equal(r21.jours, 21);
    assert.ok(r21.creneaux.every((c) => c.debut.startsWith("2026-10-25")));

    const jusquAu25 = { du: DIMANCHE, au: "2026-10-25" };
    const r22 = calculerCreneaux([personne({ plages: tout, absences: [jusquAu25] })], regles, maintenant);
    assert.equal(r22.etat, "complet");
    assert.deepEqual(r22.creneaux, []);
  });

  it("personne, ou personne de disponible : complet", () => {
    assert.equal(calculerCreneaux([], regles, maintenant).etat, "complet");
    assert.equal(calculerCreneaux([personne({ plages: [] })], regles, maintenant).etat, "complet");
  });
});

describe("plusieurs personnes", () => {
  it("un créneau dit qui est libre", () => {
    const a = personne({ id: "a" });
    const b = personne({ id: "b", plages: [{ jour: 1, debut: "11:00", fin: "13:00" }] });
    const r = calculerCreneaux([a, b], regles, maintenant);
    const a9 = r.creneaux.find((c) => c.debut === iso(heure(LUNDI, 9)));
    const a11 = r.creneaux.find((c) => c.debut === iso(heure(LUNDI, 11)));
    const a12 = r.creneaux.find((c) => c.debut === iso(heure(LUNDI, 12)));
    assert.deepEqual(a9?.personnes, ["a"]);
    assert.deepEqual(a11?.personnes, ["a", "b"]);
    assert.deepEqual(a12?.personnes, ["b"]);
  });

  it("le créneau finit 45 minutes après son début", () => {
    const r = calculerCreneaux([personne()], regles, maintenant);
    assert.equal(Date.parse(r.creneaux[0].fin) - Date.parse(r.creneaux[0].debut), 45 * M);
  });
});

describe("les fuseaux", () => {
  it("les horaires d'une closeuse à Montréal se lisent à Montréal", () => {
    const M_ = "America/Montreal";
    const p = personne({ fuseau: M_ });
    const r = calculerCreneaux([p], regles, maintenant);
    // 9h à Montréal (heure d'été, UTC-4) = 13h UTC = 15h à Paris.
    assert.equal(r.creneaux[0].debut, "2026-10-05T13:00:00.000Z");
  });

  it("le passage à l'heure d'hiver ne décale pas les horaires", () => {
    // Paris passe à l'heure d'hiver le dimanche 25/10/2026.
    const p = personne({ plages: [5, 1].map((jour) => ({ jour, debut: "09:00", fin: "09:45" })) });
    const avant = creneauxDePersonne(p, regles, heure("2026-10-23", 0), heure("2026-10-23", 23));
    const apres = creneauxDePersonne(p, regles, heure("2026-10-26", 0), heure("2026-10-26", 23));
    assert.deepEqual(avant.map(iso), ["2026-10-23T07:00:00.000Z"]);
    assert.deepEqual(apres.map(iso), ["2026-10-26T08:00:00.000Z"]);
  });

  it("les jours se rangent dans le fuseau de la cliente", () => {
    // 5h à Paris le lundi, c'est encore dimanche à Montréal.
    const p = personne({ plages: [{ jour: 1, debut: "05:00", fin: "06:00" }] });
    const r = calculerCreneaux([p], { ...regles, preavisMinutes: 0 }, maintenant);
    assert.deepEqual(parJour(r.creneaux, P).map((j) => j.jour), [LUNDI]);
    assert.deepEqual(parJour(r.creneaux, "America/Montreal").map((j) => j.jour), [DIMANCHE]);
  });

  it("la fenêtre se compte en jours du client, pas de la personne", () => {
    // Montréal, dimanche 4 : 4 h à Paris, 22 h la veille là-bas. Les 4 jours
    // vont jusqu'au jeudi 8 de Paris.
    const tard = heure(DIMANCHE, 4);
    const p = personne({ fuseau: "America/Montreal", plages: [{ jour: 4, debut: "17:00", fin: "19:00" }] });
    const r = calculerCreneaux([p], regles, tard);
    // Jeudi 17h à 17h45 à Montréal = jeudi 23h à 23h45 à Paris : dedans.
    // 18h = vendredi 0h à Paris : dehors.
    assert.equal(r.jours, 4);
    assert.deepEqual(r.creneaux.map((c) => c.debut), [
      "2026-10-08T21:00:00.000Z",
      "2026-10-08T21:15:00.000Z",
      "2026-10-08T21:30:00.000Z",
      "2026-10-08T21:45:00.000Z",
    ]);
  });
});

describe("qui est libre à un instant", () => {
  it("respecte le préavis et la fenêtre maximale, pas les paliers", () => {
    const tout = [1, 2, 3, 4, 5, 6, 7].map((jour) => ({ jour, debut: "09:00", fin: "12:00" }));
    const p = personne({ plages: tout });
    // Jour +10 : hors du palier de 4 montré, mais libre et dans les 21 jours.
    assert.deepEqual(personnesLibresA([p], regles, maintenant, heure("2026-10-14", 9)), ["a"]);
    // Jour +22 : hors de la fenêtre maximale.
    assert.deepEqual(personnesLibresA([p], regles, maintenant, heure("2026-10-26", 9)), []);
    // Dans moins de deux heures.
    const lundi8 = heure(LUNDI, 8);
    assert.deepEqual(personnesLibresA([p], regles, lundi8, heure(LUNDI, 9, 45)), []);
    assert.deepEqual(personnesLibresA([p], regles, lundi8, heure(LUNDI, 10)), ["a"]);
    // Pas au quart d'heure : ce n'est pas un créneau.
    assert.deepEqual(personnesLibresA([p], regles, maintenant, heure(LUNDI, 9, 5)), []);
  });
});
