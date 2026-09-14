import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bilanAppel, derniereReponse, reponsesParRendezVous } from "./appel-veille.ts";

describe("derniereReponse", () => {
  it("rend null sans réponse notée", () => {
    assert.equal(derniereReponse([]), null);
    assert.equal(
      derniereReponse([{ type: "sale.declined", created_at: "2026-09-14T10:00:00Z" }]),
      null,
    );
  });

  it("la dernière réponse fait foi, quel que soit l'ordre des activités", () => {
    const activites = [
      { type: "call.confirmed", created_at: "2026-09-15T18:00:00Z" },
      { type: "call.no_answer", created_at: "2026-09-15T17:00:00Z" },
      { type: "status.changed", created_at: "2026-09-16T12:00:00Z" },
    ];
    assert.equal(derniereReponse(activites), "confirme");
    assert.equal(derniereReponse([...activites].reverse()), "confirme");
  });
});

describe("reponsesParRendezVous", () => {
  it("sépare les rendez-vous et ignore les autres activités", () => {
    const reponses = reponsesParRendezVous([
      { booking_id: "a", type: "call.no_answer", created_at: "2026-09-15T17:00:00Z" },
      { booking_id: "b", type: "call.confirmed", created_at: "2026-09-15T17:05:00Z" },
      { booking_id: "b", type: "call.no_answer", created_at: "2026-09-15T17:10:00Z" },
      { booking_id: "c", type: "sale.recorded", created_at: "2026-09-15T17:10:00Z" },
    ]);
    assert.deepEqual(reponses, { a: "sans_reponse", b: "sans_reponse" });
  });
});

describe("bilanAppel", () => {
  it("compte les issues de chaque réponse, et laisse de côté les rendez-vous sans réponse notée", () => {
    const bilan = bilanAppel(
      { a: "sans_reponse", b: "sans_reponse", c: "sans_reponse", d: "confirme", e: "sans_reponse" },
      [
        { id: "a", effective_status: "honore" },
        { id: "b", effective_status: "no_show" },
        { id: "c", effective_status: "annule" },
        { id: "d", effective_status: "honore" },
        { id: "e", effective_status: "confirme" },
        { id: "f", effective_status: "honore" },
      ],
    );
    assert.deepEqual(bilan.sans_reponse, { total: 4, venues: 1, nonVenues: 1, annulees: 1, aVenir: 1 });
    assert.deepEqual(bilan.confirme, { total: 1, venues: 1, nonVenues: 0, annulees: 0, aVenir: 0 });
  });
});
