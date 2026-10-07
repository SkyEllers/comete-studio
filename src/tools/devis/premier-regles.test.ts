import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { instantLocal } from "../agent/temps.ts";

import {
  dureePremier,
  evenementPremier,
  formuleEnMots,
  mailPayePeggy,
  mailRdvPeggy,
  mailSansRdvPeggy,
  premierPaiementCents,
  rappelSansRdvDu,
  rappelVeilleDu,
  type DevisPaye,
} from "./premier-regles.ts";

const P = "Europe/Paris";
const heure = (jour: string, h: number, m = 0) => instantLocal(jour, h, m, P);
const iso = (t: number) => new Date(t).toISOString();

/** La vente du 07/10/2026 : 9 mois en plusieurs fois, 500 € puis 150 €. */
const geraldine: DevisPaye = {
  prenom: "Géraldine",
  nom: "T.",
  email: "geraldine@example.com",
  telephone: "+33600000000",
  adresse: "1 rue de la Paix\n75002 Paris",
  objet: "M'alléger du poids de mon poids",
  duree_mois: 9,
  paiement: "plusieurs",
  investigation_cents: 50_000,
  mensualite_cents: 15_000,
  total_cents: 185_000,
  paye_le: iso(heure("2026-10-07", 17, 50)),
};
const investigation: DevisPaye = { ...geraldine, duree_mois: 1, paiement: "une_fois", mensualite_cents: 0, total_cents: 50_000 };
const microbiote: DevisPaye = { ...geraldine, duree_mois: 2, investigation_cents: 0, mensualite_cents: 19_000, total_cents: 38_000 };

describe("le premier rendez-vous : la durée et la formule", () => {
  it("30 minutes, 15 pour un bilan microbiote seul (Louis, 07/10/2026)", () => {
    assert.equal(dureePremier(geraldine), 30);
    assert.equal(dureePremier(investigation), 30);
    assert.equal(dureePremier(microbiote), 15);
  });

  it("la formule en mots", () => {
    assert.equal(formuleEnMots(geraldine), "Accompagnement 9 mois, en 9 fois");
    assert.equal(formuleEnMots({ ...geraldine, paiement: "une_fois" }), "Accompagnement 9 mois, en une fois");
    assert.equal(formuleEnMots(investigation), "Investigation seule");
    assert.equal(formuleEnMots(microbiote), "Bilan microbiote seul, en 2 fois");
  });

  it("le premier paiement : l'investigation et le premier mois, ou tout", () => {
    assert.equal(premierPaiementCents(geraldine), 65_000);
    assert.equal(premierPaiementCents(investigation), 50_000);
    assert.equal(premierPaiementCents({ ...geraldine, paiement: "une_fois", total_cents: 180_000 }), 180_000);
  });
});

describe("le premier rendez-vous : l'horloge", () => {
  it("le rappel sans rendez-vous : 24 h après le paiement, une fois, pas au-delà d'une semaine", () => {
    const paye = { paye_le: geraldine.paye_le, premier_rappel_le: null };
    const t = Date.parse(geraldine.paye_le!);
    assert.equal(rappelSansRdvDu(paye, false, t + 23 * 3_600_000), false);
    assert.equal(rappelSansRdvDu(paye, false, t + 24 * 3_600_000), true);
    assert.equal(rappelSansRdvDu(paye, true, t + 24 * 3_600_000), false);
    assert.equal(rappelSansRdvDu({ ...paye, premier_rappel_le: iso(t) }, false, t + 25 * 3_600_000), false);
    assert.equal(rappelSansRdvDu(paye, false, t + 8 * 86_400_000), false);
    assert.equal(rappelSansRdvDu({ paye_le: null, premier_rappel_le: null }, false, t), false);
  });

  it("le rappel de la veille : le jour d'avant, à partir de 17 h", () => {
    const rdv = { debut: iso(heure("2026-10-09", 10)), created_at: iso(heure("2026-10-07", 18)), rappel_le: null };
    assert.equal(rappelVeilleDu(rdv, heure("2026-10-08", 16, 59)), false);
    assert.equal(rappelVeilleDu(rdv, heure("2026-10-08", 17)), true);
    assert.equal(rappelVeilleDu({ ...rdv, rappel_le: iso(heure("2026-10-08", 17)) }, heure("2026-10-08", 18)), false);
    assert.equal(rappelVeilleDu(rdv, heure("2026-10-07", 18)), false);
  });

  it("pas de rappel de la veille pour un rendez-vous pris le soir même pour le lendemain", () => {
    const rdv = { debut: iso(heure("2026-10-09", 10)), created_at: iso(heure("2026-10-08", 19)), rappel_le: null };
    assert.equal(rappelVeilleDu(rdv, heure("2026-10-08", 19, 5)), false);
  });
});

describe("le premier rendez-vous : les mails à Peggy", () => {
  it("au paiement : ce qu'elle a payé, sa formule, ce qu'elle veut, l'adresse du kit, la closeuse", () => {
    const m = mailPayePeggy(geraldine, "Peggy Auger");
    assert.equal(m.sujet, "Nouvelle cliente : Géraldine T., accompagnement 9 mois");
    assert.match(m.texte, /650 € aujourd'hui/);
    assert.match(m.texte, /\(30 min\)/);
    assert.match(m.texte, /Formule : Accompagnement 9 mois, en 9 fois \(1 850 € en tout\)/);
    assert.match(m.texte, /« M'alléger du poids de mon poids »/);
    assert.match(m.texte, /Adresse pour le kit : 1 rue de la Paix, 75002 Paris/);
    assert.match(m.texte, /Vendu par : Peggy Auger/);
  });

  it("le html échappe ce que la closeuse a écrit ; sans closeuse, pas de ligne « Vendu par »", () => {
    const m = mailPayePeggy({ ...geraldine, objet: "<b>moi</b>" }, null);
    assert.ok(!m.html.includes("<b>moi</b>"));
    assert.ok(!m.texte.includes("Vendu par"));
  });

  it("24 h sans rendez-vous", () => {
    const m = mailSansRdvPeggy(geraldine);
    assert.equal(m.sujet, "Géraldine n'a pas encore réservé son premier rendez-vous");
    assert.match(m.texte, /7 octobre 2026 à 17h50/);
    assert.match(m.texte, /Téléphone : \+33600000000/);
  });

  it("à la réservation, puis au déplacement", () => {
    const rdv = { debut: iso(heure("2026-10-09", 10)), fin: iso(heure("2026-10-09", 10, 30)), lienVisio: "https://meet.google.com/abc" };
    const nouveau = mailRdvPeggy(geraldine, rdv, "nouveau", "Peggy Auger");
    assert.equal(nouveau.sujet, "Premier rendez-vous : Géraldine, vendredi 9 octobre à 10h");
    assert.match(nouveau.texte, /\(30 min\)\. Il est dans ton agenda\./);
    assert.match(nouveau.texte, /Visio : https:\/\/meet\.google\.com\/abc/);
    const deplace = mailRdvPeggy(geraldine, rdv, "deplace", null);
    assert.match(deplace.sujet, /^Premier rendez-vous déplacé : Géraldine/);
  });

  it("l'événement dans son agenda", () => {
    const e = evenementPremier(geraldine, "Peggy Auger");
    assert.equal(e.titre, "Premier rendez-vous · Géraldine");
    assert.match(e.description, /Adresse pour le kit/);
  });
});
