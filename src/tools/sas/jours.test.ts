/**
 * Le temps et la recherche, déroulés hors du navigateur.
 *
 *   npm run test
 *
 * Deux endroits où une erreur ne se voit pas à l'écran : le fuseau, qui ne se
 * trahit qu'entre 22 h et minuit, et l'échappement du `ilike`, qui ne se
 * trahit que le jour où quelqu'un cherche « 50 % ». Ce sont exactement les cas
 * qu'une recette manuelle ne rencontre jamais.
 *
 * Tous les instants sont écrits en UTC et attendus en heure de Paris : c'est
 * la conversion elle-même qu'on met à l'épreuve.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cleJour,
  grouperParJour,
  heure,
  libelle,
  motifRecherche,
} from "./jours.ts";

describe("cleJour et heure — l'heure de Paris fait foi", () => {
  it("1. une idée notée à 00 h 30 à Paris appartient à ce jour-là", () => {
    // 31 juillet 22 h 30 UTC = 1er août 00 h 30 à Paris (UTC+2 en été).
    assert.equal(cleJour("2026-07-31T22:30:00Z"), "2026-08-01");
    assert.equal(heure("2026-07-31T22:30:00Z"), "00:30");
  });

  it("2. et en hiver, le décalage n'est plus le même", () => {
    // 31 décembre 23 h 30 UTC = 1er janvier 00 h 30 à Paris (UTC+1).
    assert.equal(cleJour("2026-12-31T23:30:00Z"), "2027-01-01");
    assert.equal(heure("2026-12-31T23:30:00Z"), "00:30");
  });

  it("3. une idée de milieu de journée ne bouge pas", () => {
    assert.equal(cleJour("2026-08-30T12:00:00Z"), "2026-08-30");
    assert.equal(heure("2026-08-30T12:00:00Z"), "14:00");
  });
});

describe("libelle — aujourd'hui, hier, et le reste", () => {
  const maintenant = new Date("2026-08-30T12:00:00Z");

  it("4. le jour même", () => {
    assert.equal(libelle("2026-08-30T08:00:00Z", maintenant), "Aujourd'hui");
  });

  it("5. la veille", () => {
    assert.equal(libelle("2026-08-29T20:00:00Z", maintenant), "Hier");
  });

  it("6. plus loin dans l'année : la date, avec une majuscule", () => {
    assert.equal(libelle("2026-08-12T09:00:00Z", maintenant), "Mercredi 12 août");
  });

  it("7. une autre année : l'année apparaît", () => {
    assert.equal(
      libelle("2025-11-03T09:00:00Z", maintenant),
      "Lundi 3 novembre 2025",
    );
  });

  it("8. « hier » se calcule sur le jour de Paris, pas sur 24 heures", () => {
    // 29 août 22 h 30 UTC = 30 août 00 h 30 à Paris : c'est aujourd'hui.
    assert.equal(libelle("2026-08-29T22:30:00Z", maintenant), "Aujourd'hui");
  });
});

describe("grouperParJour", () => {
  const note = (captured_at: string, id: string) => ({ captured_at, id });
  const maintenant = new Date("2026-08-30T12:00:00Z");

  it("9. les idées d'un même jour tiennent dans un seul groupe", () => {
    const jours = grouperParJour(
      [
        note("2026-08-30T10:00:00Z", "a"),
        note("2026-08-30T08:00:00Z", "b"),
        note("2026-08-29T18:00:00Z", "c"),
      ],
      maintenant,
    );

    assert.equal(jours.length, 2);
    assert.deepEqual(
      jours[0].notes.map((n) => n.id),
      ["a", "b"],
    );
    assert.equal(jours[0].libelle, "Aujourd'hui");
    assert.equal(jours[1].libelle, "Hier");
  });

  it("10. l'ordre d'entrée est conservé : c'est la requête qui trie", () => {
    const jours = grouperParJour(
      [note("2026-08-30T08:00:00Z", "b"), note("2026-08-30T10:00:00Z", "a")],
      maintenant,
    );
    assert.deepEqual(
      jours[0].notes.map((n) => n.id),
      ["b", "a"],
    );
  });

  it("11. une liste vide ne rend aucun groupe", () => {
    assert.deepEqual(grouperParJour([], maintenant), []);
  });

  it("12. deux passages sur le même jour ne le rouvrent pas", () => {
    // Les notes arrivent triées ; si elles ne l'étaient pas, un jour pourrait
    // apparaître deux fois. On constate le comportement plutôt que de le nier.
    const jours = grouperParJour(
      [
        note("2026-08-30T10:00:00Z", "a"),
        note("2026-08-29T10:00:00Z", "b"),
        note("2026-08-30T09:00:00Z", "c"),
      ],
      maintenant,
    );
    assert.equal(jours.length, 3);
  });
});

describe("motifRecherche — désarmer les jokers", () => {
  it("13. un mot ordinaire est encadré de pourcents", () => {
    assert.equal(motifRecherche("jonathan"), "%jonathan%");
    assert.equal(motifRecherche("  seo  "), "%seo%");
  });

  it("14. un pourcent tapé par l'utilisateur est échappé", () => {
    assert.equal(motifRecherche("50 %"), "%50 \\%%");
  });

  it("15. un souligné aussi : sans ça, « a_b » ramènerait « aab »", () => {
    assert.equal(motifRecherche("a_b"), "%a\\_b%");
  });

  it("16. l'étoile disparaît : PostgREST la traduirait en joker", () => {
    assert.equal(motifRecherche("*"), "%%");
    assert.equal(motifRecherche("se*o"), "%seo%");
  });

  it("17. une barre oblique inverse est doublée avant tout le reste", () => {
    assert.equal(motifRecherche("a\\b"), "%a\\\\b%");
  });

  it("18. une recherche vide rend un motif vide, que l'appelant écarte", () => {
    assert.equal(motifRecherche("   "), "%%");
  });

  it("19. une recherche démesurée est coupée", () => {
    const motif = motifRecherche("x".repeat(500));
    assert.equal(motif.length, 102);
  });
});
