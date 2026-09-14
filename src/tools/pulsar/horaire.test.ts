/**
 * Corriger une entrée, déroulé hors du navigateur.
 *
 *   npm run test
 *
 * Deux choses se jouent ici, et aucune ne se voit à l'écran quand elle rate :
 * les trois champs liés — un début qui bouge et une durée qui ne suit pas
 * comptent faux en silence — et ce qui s'écrit en base, où une correction
 * trop zélée réécrirait l'instant exact d'une entrée qu'on n'a fait
 * qu'annoter.
 *
 * Les instants sont écrits en UTC ; les heures attendues, à Paris. Septembre,
 * donc UTC+2 : 12:07Z, c'est 14 h 07.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  avecDebut,
  avecDuree,
  avecFin,
  avecFinTapee,
  cran,
  ecrireHeure,
  horaireDe,
  lireHeure,
  plafondDeCourse,
  resoudreCorrection,
  type Plage,
} from "./horaire.ts";

const h = (heures: number, minutes = 0) => heures * 60 + minutes;
const a = (iso: string) => Date.parse(iso);

describe("les heures, en minutes depuis minuit", () => {
  it("1. se lisent et s'écrivent", () => {
    assert.equal(lireHeure("14:07"), 847);
    assert.equal(lireHeure("00:00"), 0);
    assert.equal(ecrireHeure(847), "14:07");
    assert.equal(ecrireHeure(0), "00:00");
  });

  it("2. le lendemain s'écrit à l'heure de l'horloge", () => {
    assert.equal(ecrireHeure(h(24, 15)), "00:15");
  });

  it("3. ce qui n'est pas une heure ne se lit pas", () => {
    for (const texte of ["", "24:00", "14:60", "7:05", "14h07"]) {
      assert.equal(lireHeure(texte), null, texte);
    }
  });
});

describe("l'horaire d'une entrée, lu à Paris", () => {
  it("4. un chronomètre en marche n'a pas de fin", () => {
    assert.deepEqual(horaireDe({ started_at: "2026-09-14T12:07:32Z", ended_at: null }), {
      jour: "2026-09-14",
      debut: h(14, 7),
      fin: null,
    });
  });

  it("5. une séance finie après minuit dépasse la journée", () => {
    // 23 h 30 → 00 h 45 le lendemain, à Paris.
    assert.deepEqual(
      horaireDe({ started_at: "2026-09-14T21:30:00Z", ended_at: "2026-09-14T22:45:00Z" }),
      { jour: "2026-09-14", debut: h(23, 30), fin: h(24, 45) },
    );
  });
});

describe("le quart d'heure voisin", () => {
  it("6. une heure réelle se ramène d'abord sur la grille", () => {
    assert.equal(cran(h(14, 7), 1), h(14, 15));
    assert.equal(cran(h(14, 7), -1), h(14, 0));
  });

  it("7. puis la parcourt par quinze minutes", () => {
    assert.equal(cran(h(14, 15), 1), h(14, 30));
    assert.equal(cran(h(14, 0), -1), h(13, 45));
  });
});

describe("les trois champs liés", () => {
  const plage: Plage = { debut: h(14, 7), fin: h(14, 22), minutes: 15 };

  it("8. « en vrai, j'ai commencé à 14 h » : la fin reste, la durée se recompte", () => {
    assert.deepEqual(avecDebut(plage, h(14, 0)), {
      debut: h(14, 0),
      fin: h(14, 22),
      minutes: 30,
    });
  });

  it("9. un début qui passe la fin fait glisser toute la séance", () => {
    assert.deepEqual(avecDebut(plage, h(15, 0)), {
      debut: h(15, 0),
      fin: h(15, 15),
      minutes: 15,
    });
  });

  it("10. la fin bouge, le début reste, la durée s'arrondit comme au chronomètre", () => {
    assert.deepEqual(avecFin(plage, h(14, 45)), {
      debut: h(14, 7),
      fin: h(14, 45),
      minutes: 45,
    });
  });

  it("11. « coupe à 45 min » : la fin suit la durée", () => {
    assert.deepEqual(avecDuree(plage, 45), { debut: h(14, 7), fin: h(14, 52), minutes: 45 });
  });

  it("12. une fin tapée avant le début est celle du lendemain", () => {
    const tard: Plage = { debut: h(23, 0), fin: h(23, 30), minutes: 30 };
    assert.deepEqual(avecFinTapee(tard, h(0, 30)), {
      debut: h(23, 0),
      fin: h(24, 30),
      minutes: 90,
    });
  });

  it("13. une fin tapée après le début reste le même jour", () => {
    assert.equal(avecFinTapee(plage, h(16, 0)).fin, h(16, 0));
  });

  it("14. quoi qu'on touche, la durée reste un quart d'heure plein", () => {
    for (let debut = h(13, 0); debut <= h(15, 0); debut += 1) {
      for (const p of [avecDebut(plage, debut), avecFin(plage, debut + 1)]) {
        assert.equal(p.minutes % 15, 0);
        assert.ok(p.minutes >= 15);
        assert.ok(p.minutes >= p.fin - p.debut, JSON.stringify(p));
      }
    }
  });
});

// ------------------------------ Ce qui s'écrit --------------------------------

const MAINTENANT = a("2026-09-14T15:00:00Z"); // 17 h à Paris

/** Un chronomètre de Peggy, de 14 h 07 min 32 s à 14 h 14 min 10 s : 15 min. */
const finie = {
  started_at: "2026-09-14T12:07:32.000Z",
  ended_at: "2026-09-14T12:14:10.000Z",
  duration_minutes: 15,
  is_manual: false,
};

describe("corriger une entrée terminée", () => {
  it("15. ouvrir puis enregistrer ne touche à aucun instant", () => {
    const r = resoudreCorrection(
      finie,
      { jour: "2026-09-14", debut: h(14, 7), fin: h(14, 14), minutes: 15 },
      MAINTENANT,
    );
    assert.deepEqual(r, {
      ok: true,
      ecriture: {
        started_at: finie.started_at,
        ended_at: finie.ended_at,
        duration_minutes: 15,
        is_manual: false,
      },
    });
  });

  it("16. le début déplacé prend l'heure tapée, la fin gardée garde ses secondes", () => {
    const r = resoudreCorrection(
      finie,
      { jour: "2026-09-14", debut: h(14, 0), fin: h(14, 14), minutes: 15 },
      MAINTENANT,
    );
    assert.ok(r.ok);
    assert.equal(r.ecriture.started_at, "2026-09-14T12:00:00.000Z");
    assert.equal(r.ecriture.ended_at, finie.ended_at);
  });

  it("17. une entrée d'un autre jour se corrige en début, fin et durée", () => {
    const r = resoudreCorrection(
      finie,
      { jour: "2026-09-10", debut: h(9, 0), fin: h(10, 30), minutes: 90 },
      MAINTENANT,
    );
    assert.deepEqual(r, {
      ok: true,
      ecriture: {
        started_at: "2026-09-10T07:00:00.000Z",
        ended_at: "2026-09-10T08:30:00.000Z",
        duration_minutes: 90,
        is_manual: false,
      },
    });
  });

  it("18. une fin après minuit s'écrit le lendemain", () => {
    const r = resoudreCorrection(
      finie,
      { jour: "2026-09-12", debut: h(23, 0), fin: h(24, 30), minutes: 90 },
      MAINTENANT,
    );
    assert.ok(r.ok);
    assert.equal(r.ecriture.ended_at, "2026-09-12T22:30:00.000Z");
  });

  it("19. on ne corrige pas vers demain, ni vers un début à venir", () => {
    const demain = resoudreCorrection(
      finie,
      { jour: "2026-09-15", debut: h(9, 0), fin: h(10, 0), minutes: 60 },
      MAINTENANT,
    );
    assert.deepEqual(demain, {
      ok: false,
      error: "On ne compte pas des heures à l'avance.",
      champ: "jour",
    });

    const ceSoir = resoudreCorrection(
      finie,
      { jour: "2026-09-14", debut: h(18, 0), fin: h(19, 0), minutes: 60 },
      MAINTENANT,
    );
    assert.equal(ceSoir.ok, false);
  });

  it("20. une fin avant le début, ou plus de douze heures, sont refusées", () => {
    // Arrêté dans la minute où il est parti : la fin et le début se lisent
    // pareil. Intacte, c'est l'entrée telle qu'elle est, on ne la juge pas.
    const eclair = {
      ...finie,
      started_at: "2026-09-14T12:07:10.000Z",
      ended_at: "2026-09-14T12:07:50.000Z",
    };
    const intacte = resoudreCorrection(
      eclair,
      { jour: "2026-09-14", debut: h(14, 7), fin: h(14, 7), minutes: 15 },
      MAINTENANT,
    );
    assert.equal(intacte.ok, true);

    const deplacee = resoudreCorrection(
      finie,
      { jour: "2026-09-14", debut: h(14, 0), fin: h(13, 0), minutes: 15 },
      MAINTENANT,
    );
    assert.equal(deplacee.ok, false);

    const marathon = resoudreCorrection(
      finie,
      { jour: "2026-09-13", debut: h(8, 0), fin: h(21, 0), minutes: 780 },
      MAINTENANT,
    );
    assert.equal(marathon.ok, false);
  });

  it("21. un chronomètre oublié vingt heures se laisse annoter sans être jugé", () => {
    const oubli = {
      started_at: "2026-09-12T14:00:00.000Z",
      ended_at: "2026-09-13T10:00:00.000Z",
      duration_minutes: 1200,
      is_manual: false,
    };
    const avant = horaireDe(oubli);
    const r = resoudreCorrection(
      oubli,
      { jour: avant.jour, debut: avant.debut, fin: avant.fin, minutes: 1200 },
      MAINTENANT,
    );
    assert.equal(r.ok, true);
  });

  it("22. une saisie sans heure le reste tant qu'on ne lui donne pas un début", () => {
    const saisie = {
      started_at: "2026-09-11T10:00:00.000Z", // midi à Paris
      ended_at: "2026-09-11T10:45:00.000Z",
      duration_minutes: 45,
      is_manual: true,
    };

    const duree = resoudreCorrection(
      saisie,
      { jour: "2026-09-11", debut: h(12, 0), fin: h(13, 0), minutes: 60 },
      MAINTENANT,
    );
    assert.ok(duree.ok);
    assert.equal(duree.ecriture.is_manual, true);

    const debut = resoudreCorrection(
      saisie,
      { jour: "2026-09-11", debut: h(9, 30), fin: h(10, 15), minutes: 45 },
      MAINTENANT,
    );
    assert.ok(debut.ok);
    assert.equal(debut.ecriture.is_manual, false);
  });

  it("23. une entrée terminée ne se remet pas à tourner", () => {
    const r = resoudreCorrection(
      finie,
      { jour: "2026-09-14", debut: h(14, 7), fin: null, minutes: null },
      MAINTENANT,
    );
    assert.equal(r.ok, false);
  });
});

describe("corriger un chronomètre en marche", () => {
  // Parti à 14 h 07 min 32 s, il est 17 h : il tourne depuis 2 h 52.
  const course = {
    started_at: "2026-09-14T12:07:32.000Z",
    ended_at: null,
    duration_minutes: null,
    is_manual: false,
  };

  it("24. « en vrai, j'ai commencé à 14 h » : il continue de tourner", () => {
    const r = resoudreCorrection(
      course,
      { jour: "2026-09-14", debut: h(14, 0), fin: null, minutes: null },
      MAINTENANT,
    );
    assert.deepEqual(r, {
      ok: true,
      ecriture: { started_at: "2026-09-14T12:00:00.000Z", is_manual: false },
    });
  });

  it("25. oublié sur pause : il s'arrête à la durée choisie, sans rien supprimer", () => {
    const r = resoudreCorrection(
      course,
      { jour: "2026-09-14", debut: h(14, 7), fin: h(14, 52), minutes: 45 },
      MAINTENANT,
    );
    assert.deepEqual(r, {
      ok: true,
      ecriture: {
        started_at: course.started_at,
        ended_at: "2026-09-14T12:52:32.000Z",
        duration_minutes: 45,
        is_manual: false,
      },
    });
  });

  it("26. les deux à la fois : un début avancé, puis l'arrêt", () => {
    const r = resoudreCorrection(
      course,
      { jour: "2026-09-14", debut: h(13, 30), fin: h(15, 0), minutes: 90 },
      MAINTENANT,
    );
    assert.ok(r.ok);
    assert.equal(r.ecriture.started_at, "2026-09-14T11:30:00.000Z");
    assert.equal(r.ecriture.ended_at, "2026-09-14T13:00:00.000Z");
  });

  it("27. il ne compte pas plus qu'il n'a tourné, arrondi", () => {
    // 2 h 52 de course : 3 h au plus.
    assert.equal(plafondDeCourse(course, "2026-09-14", h(14, 7), MAINTENANT), 180);

    const pile = resoudreCorrection(
      course,
      { jour: "2026-09-14", debut: h(14, 7), fin: h(17, 7), minutes: 180 },
      MAINTENANT,
    );
    assert.ok(pile.ok);
    // La fin ne passe jamais maintenant, même quand l'arrondi la pousse après.
    assert.equal(pile.ecriture.ended_at, new Date(MAINTENANT).toISOString());

    const trop = resoudreCorrection(
      course,
      { jour: "2026-09-14", debut: h(14, 7), fin: h(17, 22), minutes: 195 },
      MAINTENANT,
    );
    assert.equal(trop.ok, false);
    assert.ok(!trop.ok && trop.champ === "minutes");
  });

  it("28. un début avancé repousse d'autant ce qu'il peut compter", () => {
    assert.equal(plafondDeCourse(course, "2026-09-14", h(13, 0), MAINTENANT), 240);
  });

  it("29. un début dans le futur est refusé", () => {
    const r = resoudreCorrection(
      course,
      { jour: "2026-09-14", debut: h(17, 30), fin: null, minutes: null },
      MAINTENANT,
    );
    assert.deepEqual(r, { ok: false, error: "Ce début tombe dans le futur.", champ: "debut" });
  });
});
