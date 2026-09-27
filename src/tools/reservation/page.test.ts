import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { creneauxPublics, demandeSchema, jetonPresente } from "./page.ts";

const J = "a".repeat(64);

describe("jetonPresente", () => {
  it("lit un jeton porteur de 64 caractères hexadécimaux", () => {
    assert.equal(jetonPresente(new Headers({ authorization: `Bearer ${J}` })), J);
    assert.equal(jetonPresente(new Headers({ authorization: `bearer  ${J} ` })), J);
  });
  it("refuse tout le reste", () => {
    assert.equal(jetonPresente(new Headers()), null);
    assert.equal(jetonPresente(new Headers({ authorization: `Basic ${J}` })), null);
    assert.equal(jetonPresente(new Headers({ authorization: `Bearer ${J} en-trop` })), null);
    assert.equal(jetonPresente(new Headers({ authorization: `Bearer ${"A".repeat(64)}` })), null);
  });
});

describe("creneauxPublics", () => {
  it("ne dit jamais qui tient le créneau", () => {
    const r = creneauxPublics(
      {
        etat: "ouvert",
        jours: 4,
        creneaux: [{ debut: "2026-10-01T08:00:00.000Z", fin: "2026-10-01T08:45:00.000Z", personnes: ["p1"] }],
        ecartees: [{ personneId: "p2", raison: "sans_agenda" }],
      },
      "Europe/Paris",
    );
    assert.deepEqual(r, {
      etat: "ouvert",
      fuseau: "Europe/Paris",
      creneaux: [{ debut: "2026-10-01T08:00:00.000Z", fin: "2026-10-01T08:45:00.000Z" }],
    });
    assert.ok(!JSON.stringify(r).includes("p1"));
  });
  it("rend fermé et complet tels quels", () => {
    assert.deepEqual(creneauxPublics({ etat: "ferme" }, "Europe/Paris"), { etat: "ferme" });
    assert.deepEqual(creneauxPublics({ etat: "complet", jours: 21, creneaux: [], ecartees: [] }, "Europe/Paris"), {
      etat: "complet",
    });
  });
});

describe("demandeSchema", () => {
  const bonne = {
    debut: "2026-10-01T08:00:00.000Z",
    prenom: "Camille",
    nom: "Test",
    email: "camille@example.com",
    telephone: "+33612345678",
    fuseau: "Europe/Paris",
    reponses: [{ question: "Quel est ton numéro de téléphone ?", reponse: "+33612345678" }],
    utm: { utm_source: "facebook" },
  };
  it("accepte une demande du site", () => {
    assert.ok(demandeSchema.safeParse(bonne).success);
  });
  it("refuse un champ inconnu, un numéro local, une heure sans Z", () => {
    assert.ok(!demandeSchema.safeParse({ ...bonne, organization_id: "x" }).success);
    assert.ok(!demandeSchema.safeParse({ ...bonne, telephone: "0612345678" }).success);
    assert.ok(!demandeSchema.safeParse({ ...bonne, debut: "2026-10-01T10:00:00+02:00" }).success);
    assert.ok(!demandeSchema.safeParse({ ...bonne, utm: { "utm-source": "x" } }).success);
  });
});
