/**
 * La commission de la closeuse : la grille validée par Peggy le 23/09/2026,
 * vérifiée cas par cas.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculer, echeancier, plusMois, releveDuMois, type Vente } from "./commission.ts";

const GRILLE = { taux: 15, tauxPalier: 18, palierApres: 5 };

function vente(id: string, date: string, montant: number, fois = 1, premier: number | null = null): Vente {
  return {
    bookingId: id,
    prenom: id,
    rendezVous: `${date}T10:00:00Z`,
    dateVente: date,
    montantCents: montant,
    fois,
    premierCents: premier,
  };
}

describe("echeancier", () => {
  it("en une fois : un seul paiement", () => {
    assert.deepEqual(echeancier(145000, 1, null), [145000]);
  });

  it("500 € puis 170 € par mois, comme chez Peggy", () => {
    assert.deepEqual(echeancier(152000, 7, 50000), [50000, 17000, 17000, 17000, 17000, 17000, 17000]);
  });

  it("parts égales, l'arrondi sur la dernière", () => {
    const parts = echeancier(100000, 3, null);
    assert.equal(parts.reduce((s, p) => s + p, 0), 100000);
    assert.deepEqual(parts, [33333, 33333, 33334]);
  });
});

describe("plusMois", () => {
  it("garde le jour", () => assert.equal(plusMois("2026-09-11", 1), "2026-10-11"));
  it("le 31 janvier devient le dernier jour de février", () => assert.equal(plusMois("2026-01-31", 1), "2026-02-28"));
  it("passe l'année", () => assert.equal(plusMois("2026-12-15", 2), "2027-02-15"));
});

describe("la grille", () => {
  it("15 % sur l'encaissé du mois", () => {
    const r = calculer([vente("a", "2026-09-11", 145000)], [], GRILLE, "2026-09-30");
    assert.equal(releveDuMois(r, "2026-09").totalCents, 21750);
  });

  it("18 % seulement à partir de la 6e vente du mois", () => {
    const ventes = Array.from({ length: 7 }, (_, i) => vente(`v${i}`, `2026-09-${String(i + 1).padStart(2, "0")}`, 100000));
    const r = calculer(ventes, [], GRILLE, "2026-09-30");
    const taux = r.paiements.map((p) => p.taux);
    assert.deepEqual(taux, [15, 15, 15, 15, 15, 18, 18]);
    assert.equal(releveDuMois(r, "2026-09").totalCents, 5 * 15000 + 2 * 18000);
  });

  it("le rang repart à zéro chaque mois", () => {
    const ventes = [
      ...Array.from({ length: 6 }, (_, i) => vente(`s${i}`, `2026-09-0${i + 1}`, 100000)),
      vente("o1", "2026-10-02", 100000),
    ];
    const r = calculer(ventes, [], GRILLE, "2026-10-31");
    assert.equal(r.paiements.find((p) => p.bookingId === "o1")?.taux, 15);
  });

  it("le taux d'une vente suit toutes ses mensualités", () => {
    const ventes = [
      ...Array.from({ length: 5 }, (_, i) => vente(`s${i}`, `2026-09-0${i + 1}`, 100000)),
      vente("sixieme", "2026-09-20", 152000, 7, 50000),
    ];
    const r = calculer(ventes, [], GRILLE, "2027-12-31");
    const siens = r.paiements.filter((p) => p.bookingId === "sixieme");
    assert.ok(siens.every((p) => p.taux === 18));
    assert.equal(siens.length, 7);
  });
});

describe("l'encaissement", () => {
  it("un paiement à venir est prévu, pas encore dû", () => {
    const r = calculer([vente("a", "2026-09-11", 152000, 7, 50000)], [], GRILLE, "2026-09-30");
    const sept = releveDuMois(r, "2026-09");
    assert.equal(sept.totalCents, 7500);
    const oct = releveDuMois(r, "2026-10");
    assert.equal(oct.paiements[0].etat, "prevu");
    assert.equal(oct.aVenirCents, 2550);
  });

  it("rien sur un impayé", () => {
    const r = calculer(
      [vente("a", "2026-09-11", 152000, 7, 50000)],
      [{ bookingId: "a", numero: 2, type: "impaye" }],
      GRILLE,
      "2026-12-31",
    );
    assert.equal(releveDuMois(r, "2026-10").totalCents, 0);
    assert.equal(releveDuMois(r, "2026-11").totalCents, 2550);
  });

  it("un remboursement se retire du mois suivant", () => {
    const r = calculer(
      [vente("a", "2026-09-11", 145000)],
      [{ bookingId: "a", numero: 1, type: "rembourse" }],
      GRILLE,
      "2026-10-31",
    );
    assert.equal(releveDuMois(r, "2026-09").totalCents, 21750);
    assert.equal(releveDuMois(r, "2026-10").totalCents, -21750);
  });

  it("l'exemple du guide : 6 mois, 228 € en tout", () => {
    const r = calculer([vente("a", "2026-09-11", 152000, 7, 50000)], [], GRILLE, "2027-12-31");
    assert.equal(r.paiements.reduce((s, p) => s + p.commissionCents, 0), 22800);
  });
});
