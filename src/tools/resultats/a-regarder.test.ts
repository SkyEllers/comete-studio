import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aRegarder } from "./a-regarder.ts";

const MAINTENANT = Date.parse("2026-10-09T12:00:00Z");
const ilYA = (jours: number) => new Date(MAINTENANT - jours * 86_400_000).toISOString();

const rdv = (id: string, o: Partial<{ jours: number; closeuse: string | null; vente: boolean; status: string }> = {}) => ({
  id,
  status: o.status ?? "confirme",
  scheduled_start: ilYA(o.jours ?? 1),
  has_sale: o.vente ?? false,
  closeuse_id: o.closeuse ?? null,
});

const ids = (lignes: { id: string }[]) => lignes.map((l) => l.id);

describe("la liste « À vérifier » (Louis, 08/10/2026)", () => {
  it("seulement ses rendez-vous : ceux d'une closeuse n'y sont pas", () => {
    const lignes = [rdv("sien"), rdv("closeuse", { closeuse: "u-1" })];
    assert.deepEqual(ids(aRegarder(lignes, new Set(), true, MAINTENANT)), ["sien"]);
    assert.deepEqual(ids(aRegarder(lignes, new Set(), false, MAINTENANT)), ["sien"]);
  });

  it("une vente notée la fait sortir", () => {
    const lignes = [rdv("vendue", { vente: true }), rdv("ouverte")];
    assert.deepEqual(ids(aRegarder(lignes, new Set(), true, MAINTENANT)), ["ouverte"]);
  });

  it("« pas de vente », avec ou sans raison, et « en attente » la font sortir (sale.declined)", () => {
    const lignes = [rdv("refusee"), rdv("ouverte", { jours: 2 })];
    assert.deepEqual(ids(aRegarder(lignes, new Set(["refusee"]), true, MAINTENANT)), ["ouverte"]);
  });

  it("une séance sans réponse reste trente jours en mode ventes, sept sinon", () => {
    const lignes = [rdv("recente", { jours: 3 }), rdv("ancienne", { jours: 20 }), rdv("trop", { jours: 40 })];
    assert.deepEqual(ids(aRegarder(lignes, new Set(), true, MAINTENANT)), ["recente", "ancienne"]);
    assert.deepEqual(ids(aRegarder(lignes, new Set(), false, MAINTENANT)), ["recente"]);
  });

  it("une non-venue ou une annulée n'y est pas, une séance pas encore commencée non plus", () => {
    const lignes = [
      rdv("absente", { status: "no_show" }),
      rdv("annulee", { status: "annule" }),
      { ...rdv("demain"), scheduled_start: new Date(MAINTENANT + 86_400_000).toISOString() },
    ];
    assert.deepEqual(aRegarder(lignes, new Set(), true, MAINTENANT), []);
  });

  it("la plus récente d'abord, chacune une fois", () => {
    const lignes = [rdv("a", { jours: 5 }), rdv("b", { jours: 1 }), rdv("c", { jours: 12 })];
    assert.deepEqual(ids(aRegarder(lignes, new Set(), true, MAINTENANT)), ["b", "a", "c"]);
  });
});
