/**
 * Le découpage du temps du hub, déroulé hors du navigateur.
 *
 *   npm run test
 *
 * Ces fonctions sont partagées : Radar y borne ses exports, Pulsar y trouve
 * ses semaines. Une erreur de fuseau ne s'y verrait que deux dimanches par an,
 * et une erreur de semaine qu'un lundi — deux jours où personne ne relit.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ajouterJours,
  dimancheDeLaSemaine,
  ecartJours,
  instantParis,
  jourParis,
  lundiDeLaSemaine,
  midiParis,
  minutesParis,
} from "./dates.ts";

describe("le jour parisien", () => {
  it("1. 22 h 30 UTC en été, c'est déjà le lendemain à Paris", () => {
    assert.equal(jourParis("2026-07-31T22:30:00Z"), "2026-08-01");
  });

  it("2. 22 h 30 UTC en hiver, c'est encore le même jour", () => {
    assert.equal(jourParis("2026-01-31T22:30:00Z"), "2026-01-31");
  });
});

describe("l'arithmétique de calendrier", () => {
  it("3. un jour ajouté reste un jour, même la nuit du changement d'heure", () => {
    // Dernier dimanche de mars 2026 : la journée ne fait que 23 heures.
    assert.equal(ajouterJours("2026-03-28", 1), "2026-03-29");
    assert.equal(ajouterJours("2026-03-29", 1), "2026-03-30");
    // Et la nuit d'octobre, qui en fait 25.
    assert.equal(ajouterJours("2026-10-25", 1), "2026-10-26");
  });

  it("4. les mois et les années se franchissent dans les deux sens", () => {
    assert.equal(ajouterJours("2026-12-31", 1), "2027-01-01");
    assert.equal(ajouterJours("2027-01-01", -1), "2026-12-31");
    assert.equal(ajouterJours("2028-03-01", -1), "2028-02-29");
  });
});

describe("la semaine, du lundi au dimanche", () => {
  it("5. le lundi est son propre lundi", () => {
    assert.equal(lundiDeLaSemaine("2026-09-07"), "2026-09-07");
  });

  it("6. le dimanche referme la semaine qui l'a précédé, pas celle qui suit", () => {
    assert.equal(lundiDeLaSemaine("2026-09-13"), "2026-09-07");
    assert.equal(dimancheDeLaSemaine("2026-09-13"), "2026-09-13");
  });

  it("7. un mercredi tombe entre les deux", () => {
    assert.equal(lundiDeLaSemaine("2026-09-09"), "2026-09-07");
    assert.equal(dimancheDeLaSemaine("2026-09-09"), "2026-09-13");
  });

  it("8. une semaine à cheval sur deux mois reste entière", () => {
    assert.equal(lundiDeLaSemaine("2026-10-01"), "2026-09-28");
    assert.equal(dimancheDeLaSemaine("2026-09-28"), "2026-10-04");
  });

  it("9. toute semaine fait sept jours, toute l'année durant", () => {
    let jour = "2026-01-01";
    while (jour <= "2026-12-31") {
      const lundi = lundiDeLaSemaine(jour);
      assert.equal(dimancheDeLaSemaine(jour), ajouterJours(lundi, 6), jour);
      assert.ok(lundi <= jour && jour <= ajouterJours(lundi, 6), jour);
      jour = ajouterJours(jour, 1);
    }
  });
});

describe("midi à Paris", () => {
  it("10. en hiver, Paris est à une heure de Greenwich", () => {
    assert.equal(midiParis("2026-01-15"), "2026-01-15T12:00:00.000+01:00");
  });

  it("11. en été, à deux", () => {
    assert.equal(midiParis("2026-07-15"), "2026-07-15T12:00:00.000+02:00");
  });

  it("12. et l'instant obtenu retombe bien sur le jour demandé", () => {
    for (const jour of ["2026-03-29", "2026-10-25", "2026-01-01", "2026-12-31"]) {
      assert.equal(jourParis(midiParis(jour)), jour);
    }
  });
});

describe("une heure tapée, à Paris", () => {
  it("13. 14 h en été, c'est midi à Greenwich ; en hiver, 13 h", () => {
    assert.equal(instantParis("2026-09-14", 14 * 60), "2026-09-14T12:00:00.000Z");
    assert.equal(instantParis("2026-01-14", 14 * 60), "2026-01-14T13:00:00.000Z");
  });

  it("14. au-delà de minuit, c'est le lendemain", () => {
    // 1 455 minutes : 00 h 15 le 15 septembre, soit 22 h 15 UTC le 14.
    assert.equal(instantParis("2026-09-14", 1455), "2026-09-14T22:15:00.000Z");
    assert.equal(jourParis(instantParis("2026-09-14", 1455)), "2026-09-15");
  });

  it("15. la nuit du passage à l'heure d'été, 1 h 30 et 3 h 30 tombent juste", () => {
    // 29 mars 2026 : on passe de 2 h à 3 h, à 1 h UTC.
    assert.equal(instantParis("2026-03-29", 90), "2026-03-29T00:30:00.000Z");
    assert.equal(instantParis("2026-03-29", 210), "2026-03-29T01:30:00.000Z");
  });

  it("16. la nuit du retour à l'heure d'hiver, 1 h 30 est encore en été", () => {
    // 25 octobre 2026 : on repasse de 3 h à 2 h, à 1 h UTC.
    assert.equal(instantParis("2026-10-25", 90), "2026-10-24T23:30:00.000Z");
    assert.equal(instantParis("2026-10-25", 240), "2026-10-25T03:00:00.000Z");
  });

  it("17. l'aller et le retour se retrouvent, heure par heure, toute l'année", () => {
    let jour = "2026-01-01";
    while (jour <= "2026-12-31") {
      for (const minutes of [0, 7 * 60 + 45, 12 * 60, 14 * 60 + 7, 23 * 60 + 59]) {
        const instant = instantParis(jour, minutes);
        assert.equal(jourParis(instant), jour, `${jour} ${minutes}`);
        assert.equal(minutesParis(instant), minutes, `${jour} ${minutes}`);
      }
      jour = ajouterJours(jour, 1);
    }
  });

  it("18. minuit se lit zéro, pas vingt-quatre heures", () => {
    assert.equal(minutesParis("2026-09-13T22:00:00Z"), 0);
    assert.equal(minutesParis("2026-09-14T12:07:40Z"), 14 * 60 + 7);
  });

  it("19. l'écart entre deux jours traverse les mois et les changements d'heure", () => {
    assert.equal(ecartJours("2026-09-14", "2026-09-15"), 1);
    assert.equal(ecartJours("2026-03-28", "2026-03-30"), 2);
    assert.equal(ecartJours("2026-10-01", "2026-09-30"), -1);
  });
});
