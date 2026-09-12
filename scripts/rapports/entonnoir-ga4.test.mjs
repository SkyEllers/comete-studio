import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculer,
  DEBUT_MESURE,
  EVENEMENTS,
  lignes,
  lireOptions,
  palier,
  parSource,
  rediger,
  requetes,
  tableau,
  taux,
} from "./entonnoir-ga4-calcul.mjs";

/** Une réponse `runReport` telle que l'API la rend : des chaînes partout. */
function reponse(dimensions, metriques, rangees) {
  return {
    dimensionHeaders: dimensions.map((name) => ({ name })),
    metricHeaders: metriques.map((name) => ({ name, type: "TYPE_INTEGER" })),
    rows: rangees.map((rangee) => ({
      dimensionValues: rangee.slice(0, dimensions.length).map((value) => ({ value })),
      metricValues: rangee.slice(dimensions.length).map((value) => ({ value: String(value) })),
    })),
    rowCount: rangees.length,
  };
}

const DEFAUTS = { du: "2026-09-05", au: "2026-09-12", propriete: "536224481" };

// Une semaine inventée, cohérente d'une requête à l'autre.
const evenements = lignes(
  reponse(["eventName"], ["eventCount", "totalUsers"], [
    ["lp_view", 100, 80],
    ["video_start", 30, 25],
    ["video_progress", 60, 20],
    ["lp_cta_click", 12, 10],
    ["calendly_event_type_viewed", 10, 9],
    ["calendly_date_and_time_selected", 4, 4],
    ["calendly_event_scheduled", 2, 2],
  ]),
);

const parSourceEvenements = lignes(
  reponse(["eventName", "sessionSource", "sessionMedium"], ["eventCount"], [
    ["lp_view", "google", "cpc", 70],
    ["lp_view", "(direct)", "(none)", 25],
    ["lp_view", "google", "organic", 5],
    ["video_start", "google", "cpc", 20],
    ["lp_cta_click", "google", "cpc", 10],
    ["calendly_event_type_viewed", "google", "cpc", 8],
    ["calendly_date_and_time_selected", "google", "cpc", 3],
    ["calendly_event_scheduled", "google", "cpc", 2],
  ]),
);

const paliers = lignes(
  reponse(["customEvent:video_percent"], ["eventCount", "totalUsers"], [
    ["25", 20, 18],
    ["50", 15, 14],
    ["75", 10, 9],
    ["95", 5, 5],
    ["(not set)", 10, 4],
  ]),
);

const parSourcePaliers = lignes(
  reponse(["customEvent:video_percent", "sessionSource", "sessionMedium"], ["eventCount"], [
    ["25", "google", "cpc", 14],
    ["50", "google", "cpc", 10],
    ["75", "google", "cpc", 6],
    ["95", "google", "cpc", 3],
    ["25", "(direct)", "(none)", 6],
  ]),
);

describe("requetes", () => {
  const r = requetes(DEFAUTS);

  it("interroge les sept événements de l'entonnoir, sur la période demandée", () => {
    assert.equal(EVENEMENTS.length, 7);
    for (const requete of r.evenements) {
      assert.deepEqual(requete.dimensionFilter.filter.inListFilter.values, EVENEMENTS);
      assert.deepEqual(requete.dateRanges, [{ startDate: "2026-09-05", endDate: "2026-09-12" }]);
    }
  });

  it("lit les paliers dans video_percent, sur video_progress seulement", () => {
    for (const requete of r.paliers) {
      assert.equal(requete.dimensions[0].name, "customEvent:video_percent");
      assert.equal(requete.dimensionFilter.filter.stringFilter.value, "video_progress");
    }
  });

  it("ne demande les personnes que sans découpage par source", () => {
    const [total, parSourceRequete] = r.evenements;
    assert.ok(total.metrics.some((m) => m.name === "totalUsers"));
    assert.ok(!parSourceRequete.metrics.some((m) => m.name === "totalUsers"));
  });
});

describe("lignes", () => {
  it("nomme les colonnes et rend des nombres", () => {
    assert.deepEqual(evenements[0], { eventName: "lp_view", eventCount: 100, totalUsers: 80 });
  });

  it("une réponse sans lignes rend une liste vide", () => {
    assert.deepEqual(lignes({ dimensionHeaders: [], metricHeaders: [] }), []);
    assert.deepEqual(lignes(undefined), []);
  });
});

describe("palier", () => {
  it("ramène les nombres à leur écriture simple et laisse le reste", () => {
    assert.equal(palier("25"), "25");
    assert.equal(palier(25), "25");
    assert.equal(palier("25.0"), "25");
    assert.equal(palier("(not set)"), "(not set)");
  });
});

describe("taux", () => {
  it("arrondit au dixième, à la française, et se tait sans base", () => {
    assert.equal(taux(1, 3), "33,3 %");
    assert.equal(taux(2, 100), "2 %");
    assert.equal(taux(5, 0), "—");
  });
});

describe("calculer", () => {
  const complet = calculer({ evenements, parSourceEvenements, paliers, parSourcePaliers });

  it("sépare google / cpc du reste et rapporte chaque étape aux vues de la landing", () => {
    assert.deepEqual(complet.entonnoir[0], {
      libelle: "Vue de la landing",
      total: 100,
      googleCpc: 70,
      autres: 30,
      personnes: 80,
      taux: "100 %",
      tauxCpc: "100 %",
    });
    assert.deepEqual(complet.entonnoir.at(-1), {
      libelle: "Rendez-vous réservé",
      total: 2,
      googleCpc: 2,
      autres: 0,
      personnes: 2,
      taux: "2 %",
      tauxCpc: "2,9 %",
    });
  });

  it("mesure la rétention de la VSL sur les lancements", () => {
    assert.deepEqual(
      complet.vsl.map((r) => r.libelle),
      ["VSL lancée", "VSL 25 %", "VSL 50 %", "VSL 75 %", "VSL 95 %"],
    );
    assert.deepEqual(complet.vsl[1], {
      libelle: "VSL 25 %",
      total: 20,
      googleCpc: 14,
      autres: 6,
      personnes: 18,
      taux: "66,7 %",
      tauxCpc: "70 %",
    });
  });

  it("compte à part les video_progress sans palier", () => {
    assert.equal(complet.sansPalier, 10);
    assert.equal(complet.totalProgression, 60);
  });

  it("sans la dimension video_percent, les paliers manquent mais l'entonnoir tient", () => {
    const partiel = calculer({ evenements, parSourceEvenements });
    assert.equal(partiel.vsl, null);
    assert.equal(partiel.entonnoir.length, 6);
    assert.equal(partiel.totalProgression, 60);
  });

  it("une période vide rend des zéros, pas des erreurs", () => {
    const vide = calculer({ evenements: [], parSourceEvenements: [], paliers: [], parSourcePaliers: [] });
    assert.ok(vide.entonnoir.every((r) => r.total === 0 && r.taux === "—"));
    assert.equal(vide.sansPalier, 0);
  });
});

describe("parSource", () => {
  it("range les sources par vues de la landing", () => {
    assert.deepEqual(
      parSource(parSourceEvenements).map((s) => s.cle),
      ["google / cpc", "(direct) / (none)", "google / organic"],
    );
    assert.equal(parSource(parSourceEvenements, 2).length, 2);
    assert.equal(parSource(parSourceEvenements)[0].comptes.calendly_event_scheduled, 2);
  });
});

describe("tableau", () => {
  it("aligne toutes les lignes sur la même largeur", () => {
    const texte = tableau(["Étape", "Total"], [["Vue de la landing", 100], ["Clic", null]]);
    const lignesTexte = texte.split("\n");
    assert.equal(new Set(lignesTexte.map((l) => l.length)).size, 1);
    assert.match(lignesTexte[1], /^[- ]+$/);
    assert.match(lignesTexte[3], /—$/);
  });
});

describe("lireOptions", () => {
  it("prend les valeurs par défaut sans argument", () => {
    assert.deepEqual(lireOptions([], DEFAUTS), DEFAUTS);
  });

  it("accepte une autre semaine et une autre propriété", () => {
    assert.deepEqual(lireOptions(["--du=2026-09-12", "--au=2026-09-18", "--propriete=42"], DEFAUTS), {
      du: "2026-09-12",
      au: "2026-09-18",
      propriete: "42",
    });
  });

  it("refuse une date qui n'existe pas, une période à l'envers et une option inconnue", () => {
    assert.throws(() => lireOptions(["--du=2026-02-30"], DEFAUTS), /Date invalide/);
    assert.throws(() => lireOptions(["--du=2026-09-20", "--au=2026-09-12"], DEFAUTS), /à l'envers/);
    assert.throws(() => lireOptions(["--semaine=37"], DEFAUTS), /Option inconnue/);
    assert.throws(() => lireOptions(["--propriete=abc"], DEFAUTS), /propriété invalide/);
  });
});

describe("rediger", () => {
  it("rend les trois tableaux et signale ce qui manque", () => {
    const calcul = calculer({ evenements, parSourceEvenements, paliers, parSourcePaliers });
    const texte = rediger({ ...DEFAUTS, ...calcul, sources: parSource(parSourceEvenements) });

    assert.match(texte, /du 05\/09\/2026 au 12\/09\/2026/);
    assert.match(texte, /ENTONNOIR/);
    assert.match(texte, /RÉTENTION VSL/);
    assert.match(texte, /PAR SOURCE/);
    assert.match(texte, /GTM n'envoyait pas/);
    assert.match(texte, /10 video_progress sans palier/);
  });

  it("sans paliers, le dit ; après le début de la mesure, ne parle plus des jours vides", () => {
    const calcul = calculer({ evenements, parSourceEvenements });
    const texte = rediger({
      ...DEFAUTS,
      du: DEBUT_MESURE,
      ...calcul,
      sources: parSource(parSourceEvenements),
    });

    assert.doesNotMatch(texte, /RÉTENTION VSL/);
    assert.match(texte, /Seul le total de video_progress est lisible : 60/);
    assert.doesNotMatch(texte, /GTM n'envoyait pas/);
  });
});
