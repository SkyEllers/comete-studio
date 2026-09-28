import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACHETEURS,
  acheteurComplet,
  moisEcoule,
  numeroFacture,
  pdfFacture,
  rappelFactureDu,
  sirenValide,
  texteMandat,
  totalFacture,
} from "./factures-regles.ts";

describe("les factures des closeuses", () => {
  it("un numéro par closeuse, continu", () => {
    assert.equal(numeroFacture("Mélanie Dupont EI", "2026-10-01", 1), "AF-202610-MD-001");
    assert.equal(numeroFacture("Anne-Sophie Martin", "2026-11-01", 12), "AF-202611-ASM-012");
  });
  it("le mois écoulé", () => {
    assert.equal(moisEcoule("2026-11-01"), "2026-10-01");
    assert.equal(moisEcoule("2027-01-01"), "2026-12-01");
  });
  it("le SIREN a sa clé", () => {
    assert.equal(sirenValide("123456782"), true);
    assert.equal(sirenValide("123 456 782"), true);
    assert.equal(sirenValide("123456789"), false);
    assert.equal(sirenValide("12345678"), false);
  });
  it("pas de facture tant que l'EURL n'a ni nom ni SIREN", () => {
    assert.equal(acheteurComplet(ACHETEURS.peggy), false);
    assert.equal(acheteurComplet({ ...ACHETEURS.peggy!, nom: "PEGGY GIRAULT", siren: "123456782" }), true);
  });
  it("un rappel tous les deux jours tant qu'elle n'a pas accepté", () => {
    const creee = "2026-11-01T06:00:00Z";
    assert.equal(rappelFactureDu({ statut: "a_accepter", creee_le: creee, relance_le: null }, Date.parse("2026-11-02T06:00:00Z")), false);
    assert.equal(rappelFactureDu({ statut: "a_accepter", creee_le: creee, relance_le: null }, Date.parse("2026-11-03T06:01:00Z")), true);
    assert.equal(rappelFactureDu({ statut: "acceptee", creee_le: creee, relance_le: null }, Date.parse("2026-11-09T06:00:00Z")), false);
  });
  it("le mandat parle d'accepter chaque facture", () => {
    assert.match(JSON.stringify(texteMandat("PEGGY GIRAULT")), /J'accepte/);
  });
  it("fabrique un PDF avec les mentions", async () => {
    const lignes = {
      paiements: [
        { bookingId: "b", prenom: "Camille", rang: 1, taux: 15, numero: 1, fois: 6, date: "2026-10-03", montantCents: 65_000, etat: "encaisse" as const, commissionCents: 9_750 },
      ],
      reprises: [],
    };
    assert.equal(totalFacture(lignes), 9_750);
    const pdf = await pdfFacture(
      {
        numero: "AF-202610-MD-001",
        date: "2026-11-01",
        mois: "2026-10-01",
        vendeuse: { nomLegal: "Mélanie Dupont EI", siren: "123456782", adresse: "1 rue X, 69000 Lyon", mentionTva: "TVA non applicable, art. 293 B du CGI", email: null },
        acheteur: { ...ACHETEURS.peggy!, nom: "PEGGY GIRAULT", siren: "123456782" },
        lignes,
        totalCents: 9_750,
      },
      { le: "2026-11-02T09:00:00Z", ip: null },
    );
    assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
  });
});
