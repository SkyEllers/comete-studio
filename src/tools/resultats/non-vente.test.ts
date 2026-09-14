import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aRecontacter,
  derniereRaison,
  etatsParRendezVous,
  moisProposes,
  nombrePlusTard,
} from "./non-vente.ts";

describe("derniereRaison", () => {
  it("rend null sans raison notée, ou avec une raison illisible", () => {
    assert.equal(derniereRaison([]), null);
    assert.equal(
      derniereRaison([{ type: "sale.declined", payload: {}, created_at: "2026-09-14T10:00:00Z" }]),
      null,
    );
    assert.equal(
      derniereRaison([
        { type: "sale.reason", payload: { motif: "inconnu" }, created_at: "2026-09-14T10:00:00Z" },
      ]),
      null,
    );
  });

  it("la dernière raison fait foi, quel que soit l'ordre des activités", () => {
    const activites = [
      { type: "sale.reason", payload: { motif: "argent", recontacter: "2026-11-01" }, created_at: "2026-09-15T18:00:00Z" },
      { type: "sale.reason", payload: { motif: "moment", recontacter: null }, created_at: "2026-09-15T17:00:00Z" },
    ];
    const attendue = { motif: "argent", recontacter: "2026-11-01", noteeLe: "2026-09-15T18:00:00Z" };
    assert.deepEqual(derniereRaison(activites), attendue);
    assert.deepEqual(derniereRaison([...activites].reverse()), attendue);
  });

  it("un mois mal formé est lu comme « pas de date »", () => {
    assert.equal(
      derniereRaison([
        { type: "sale.reason", payload: { motif: "conjoint", recontacter: "2026-11-15" }, created_at: "2026-09-15T18:00:00Z" },
      ])?.recontacter,
      null,
    );
  });
});

describe("etatsParRendezVous et aRecontacter", () => {
  const activites = [
    // a : novembre, pas encore fait.
    { booking_id: "a", type: "sale.reason", payload: { motif: "argent", recontacter: "2026-11-01" }, created_at: "2026-07-23T12:00:00Z" },
    // b : octobre, fait après la raison.
    { booking_id: "b", type: "sale.reason", payload: { motif: "moment", recontacter: "2026-10-01" }, created_at: "2026-07-04T12:00:00Z" },
    { booking_id: "b", type: "recontact.done", payload: {}, created_at: "2026-10-02T09:00:00Z" },
    // c : fait, puis nouvelle date notée après : revient dans la liste.
    { booking_id: "c", type: "sale.reason", payload: { motif: "argent", recontacter: "2026-10-01" }, created_at: "2026-07-02T12:00:00Z" },
    { booking_id: "c", type: "recontact.done", payload: {}, created_at: "2026-10-03T09:00:00Z" },
    { booking_id: "c", type: "sale.reason", payload: { motif: "argent", recontacter: "2026-10-01" }, created_at: "2026-10-03T09:05:00Z" },
    // d : pas de date.
    { booking_id: "d", type: "sale.reason", payload: { motif: "conjoint", recontacter: null }, created_at: "2026-07-21T12:00:00Z" },
    // e : septembre, en retard.
    { booking_id: "e", type: "sale.reason", payload: { motif: "pas_convaincue", recontacter: "2026-09-01" }, created_at: "2026-09-02T12:00:00Z" },
    // f : autre activité seulement.
    { booking_id: "f", type: "sale.declined", payload: {}, created_at: "2026-07-21T12:00:00Z" },
  ];

  it("lit l'état de chaque rendez-vous et ignore ceux sans raison", () => {
    const etats = etatsParRendezVous(activites);
    assert.deepEqual(Object.keys(etats).sort(), ["a", "b", "c", "d", "e"]);
    assert.equal(etats.b?.fait, true);
    assert.equal(etats.c?.fait, false);
  });

  it("en octobre : les rappels échus et non faits, du plus ancien au plus récent", () => {
    const etats = etatsParRendezVous(activites);
    assert.deepEqual(
      aRecontacter(etats, "2026-10-01").map((ligne) => ligne.id),
      ["e", "c"],
    );
    assert.equal(nombrePlusTard(etats, "2026-10-01"), 1);
  });

  it("en novembre, a arrive ; une personne sans date n'apparaît jamais", () => {
    const etats = etatsParRendezVous(activites);
    assert.deepEqual(
      aRecontacter(etats, "2026-11-01").map((ligne) => ligne.id),
      ["e", "c", "a"],
    );
    assert.equal(nombrePlusTard(etats, "2026-11-01"), 0);
  });
});

describe("moisProposes", () => {
  it("ce mois-ci et les douze suivants, en passant l'année", () => {
    const mois = moisProposes("2026-09-01");
    assert.equal(mois.length, 13);
    assert.equal(mois[0], "2026-09-01");
    assert.equal(mois[4], "2027-01-01");
    assert.equal(mois[12], "2027-09-01");
  });
});
