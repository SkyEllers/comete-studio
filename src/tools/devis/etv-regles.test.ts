import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { accesEtv, ajouterMois, comptePret, demandeEtv, packEtv, type DevisPourEtv } from "./etv-regles.ts";

/** Géraldine, 07/10/2026 : 9 mois en plusieurs fois, signé à 17h49. */
const accompagnement: DevisPourEtv = {
  prenom: " Géraldine ",
  nom: "T.",
  email: "Geraldine@Example.com",
  telephone: "+33600000000",
  adresse: "1 rue de la Paix, 75002 Paris",
  duree_mois: 9,
  investigation_cents: 50_000,
  mensualite_cents: 15_000,
  signe_le: "2026-10-07T15:49:00.000Z",
  paye_le: "2026-10-07T15:50:36.000Z",
};
const investigation: DevisPourEtv = { ...accompagnement, duree_mois: 1, mensualite_cents: 0 };
const microbiote: DevisPourEtv = { ...accompagnement, duree_mois: 2, investigation_cents: 0, mensualite_cents: 19_000 };

describe("le compte dans l'app ETV (08/10/2026)", () => {
  it("pack microbiote pour un bilan microbiote seul, complet sinon", () => {
    assert.equal(packEtv(microbiote), "microbiote");
    assert.equal(packEtv(accompagnement), "complet");
    assert.equal(packEtv(investigation), "complet");
  });

  it("accès depuis la signature : la durée du devis, 3 mois pour les formules courtes", () => {
    assert.deepEqual(accesEtv(accompagnement), { debut: "2026-10-07T15:49:00.000Z", fin: "2027-07-07T15:49:00.000Z" });
    assert.equal(accesEtv(investigation).fin, "2027-01-07T15:49:00.000Z");
    assert.equal(accesEtv(microbiote).fin, "2027-01-07T15:49:00.000Z");
  });

  it("le 31 + 1 mois tombe en fin de mois, pas au début du suivant", () => {
    assert.equal(ajouterMois("2026-01-31T10:00:00.000Z", 1), "2026-02-28T10:00:00.000Z");
  });

  it("sans signature notée, le jour du paiement", () => {
    assert.equal(accesEtv({ ...accompagnement, signe_le: null }).debut, "2026-10-07T15:50:36.000Z");
  });

  it("la demande : adresse en minuscules, prénom propre, date du rendez-vous", () => {
    const q = demandeEtv(accompagnement, "2026-10-09T08:00:00.000Z", new Date("2026-10-08T09:00:00Z"));
    assert.equal(q.email, "geraldine@example.com");
    assert.equal(q.prenom, "Géraldine");
    assert.equal(q.pack, "complet");
    assert.equal(q.premier_rdv_le, "2026-10-09T08:00:00.000Z");
    assert.match(q.note, /08\/10\/2026/);
  });

  it("prêt : créé, mis à jour ou converti ; pas une cliente déjà là", () => {
    assert.equal(comptePret("cree"), true);
    assert.equal(comptePret("converti"), true);
    assert.equal(comptePret("deja_cliente"), false);
    assert.equal(comptePret(null), false);
  });
});
