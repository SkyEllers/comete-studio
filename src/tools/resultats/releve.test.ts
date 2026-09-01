/**
 * Le relevé décide de ce qui est facturé. Ces cas-là valent d'être déroulés en
 * une seconde plutôt que vérifiés à l'écran, un mois sur deux.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  construireLignes,
  estRevolu,
  peutCloturer,
  peutMarquerPaye,
  raisonExclusion,
  totaux,
  versCsv,
  type CanalDuReleve,
  type SeanceDuMois,
} from "./releve.ts";

const CANAUX: CanalDuReleve[] = [
  { id: "c-ads", label: "Google Ads", is_comete: true },
  { id: "c-direct", label: "Direct", is_comete: false },
];

const seance = (attributs: Partial<SeanceDuMois> = {}): SeanceDuMois => ({
  id: "rdv-1",
  scheduled_start: "2026-07-15T08:00:00.000Z",
  event_type_name: "Séance de suivi",
  channel_id: "c-ads",
  effective_status: "honore",
  counts_for_commission: true,
  amount_cents: 9000,
  currency: "EUR",
  payment_ok: true,
  ...attributs,
});

describe("pourquoi une séance ne compte pas", () => {
  it("1. celle qui compte n'a pas de raison", () => {
    assert.equal(raisonExclusion(seance(), CANAUX[0]), null);
  });

  it("2. l'annulation prime sur tout le reste", () => {
    // Annulée, gratuite et hors Comète à la fois : on répond ce qui s'est
    // passé, pas ce que le calcul a rencontré en premier.
    const annulee = seance({
      counts_for_commission: false,
      effective_status: "annule",
      amount_cents: 0,
      payment_ok: false,
      channel_id: "c-direct",
    });
    assert.equal(raisonExclusion(annulee, CANAUX[1]), "Séance annulée");
  });

  it("3. le non-venu se dit en français", () => {
    assert.equal(
      raisonExclusion(
        seance({ counts_for_commission: false, effective_status: "no_show" }),
        CANAUX[0],
      ),
      "Personne n'est venue",
    );
  });

  it("4. le canal hors Comète nomme le canal", () => {
    assert.equal(
      raisonExclusion(
        seance({ counts_for_commission: false, channel_id: "c-direct" }),
        CANAUX[1],
      ),
      "Canal hors Comète : Direct",
    );
  });

  it("5. la séance gratuite est suivie mais ne compte pas", () => {
    assert.equal(
      raisonExclusion(
        seance({ counts_for_commission: false, amount_cents: 0 }),
        CANAUX[0],
      ),
      "Séance gratuite",
    );
  });

  it("6. le paiement manquant se distingue de la gratuité", () => {
    assert.equal(
      raisonExclusion(
        seance({ counts_for_commission: false, payment_ok: false }),
        CANAUX[0],
      ),
      "Paiement non enregistré",
    );
  });

  it("7. sans canal du tout, on le dit sans nommer", () => {
    assert.equal(
      raisonExclusion(
        seance({ counts_for_commission: false, channel_id: null }),
        null,
      ),
      "Canal hors Comète",
    );
  });
});

describe("l'instantané du relevé", () => {
  it("8. il porte toutes les séances, comptées ou non", () => {
    const lignes = construireLignes(
      [
        seance({ id: "a" }),
        seance({ id: "b", counts_for_commission: false, effective_status: "annule" }),
      ],
      CANAUX,
    );
    assert.equal(lignes.length, 2);
    assert.deepEqual(
      lignes.map((l) => l.comptee),
      [true, false],
    );
  });

  it("9. il recopie le libellé du canal, il ne le référence pas", () => {
    // Renommer « Google Ads » l'an prochain ne doit pas réécrire un relevé
    // déjà validé.
    const [ligne] = construireLignes([seance()], CANAUX);
    assert.equal(ligne.canal, "Google Ads");
    assert.equal(ligne.canal_comete, true);
  });

  it("10. il ne contient aucune clé d'invité", () => {
    const lignes = construireLignes([seance()], CANAUX);
    assert.equal(JSON.stringify(lignes).includes("invitee"), false);
  });

  it("11. il est trié du plus ancien au plus récent", () => {
    const lignes = construireLignes(
      [
        seance({ id: "tard", scheduled_start: "2026-07-28T08:00:00.000Z" }),
        seance({ id: "tot", scheduled_start: "2026-07-02T08:00:00.000Z" }),
      ],
      CANAUX,
    );
    assert.deepEqual(
      lignes.map((l) => l.id),
      ["tot", "tard"],
    );
  });
});

describe("la base et la commission", () => {
  it("12. seules les lignes comptées entrent dans la base", () => {
    const lignes = construireLignes(
      [
        seance({ id: "a" }),
        seance({ id: "b" }),
        seance({ id: "c", counts_for_commission: false, effective_status: "annule" }),
      ],
      CANAUX,
    );
    assert.deepEqual(totaux(lignes, 20), { base_cents: 18000, commission_cents: 3600 });
  });

  it("13. l'arrondi se fait une fois, sur le total", () => {
    // 3 × 33,33 € à 20 % : ligne à ligne on obtiendrait 3 × 667 = 2001, ce qui
    // ne serait pas la commission annoncée tout le mois.
    const lignes = construireLignes(
      [
        seance({ id: "a", amount_cents: 3333 }),
        seance({ id: "b", amount_cents: 3333 }),
        seance({ id: "c", amount_cents: 3333 }),
      ],
      CANAUX,
    );
    assert.deepEqual(totaux(lignes, 20), { base_cents: 9999, commission_cents: 2000 });
  });

  it("14. un mois sans rien facture zéro", () => {
    assert.deepEqual(totaux([], 20), { base_cents: 0, commission_cents: 0 });
  });
});

describe("ce qui se clôture", () => {
  it("15. le mois en cours ne se clôture pas", () => {
    assert.equal(estRevolu("2026-08-01", "2026-08-01"), false);
  });

  it("16. le mois révolu, oui", () => {
    assert.equal(estRevolu("2026-07-01", "2026-08-01"), true);
  });

  it("17. un mois à venir non plus", () => {
    assert.equal(estRevolu("2026-09-01", "2026-08-01"), false);
  });
});

describe("l'export", () => {
  it("18. les colonnes sont séparées par des points-virgules", () => {
    // Avec des virgules, un Excel français range tout dans une seule colonne
    // et le client croit le fichier cassé.
    const csv = versCsv(construireLignes([seance()], CANAUX));
    assert.equal(csv.split("\r\n")[0], "Date;Séance;Canal;Statut;Montant;Comptée;Raison");
    assert.equal(csv.includes("2026-07-15;Séance de suivi;Google Ads;honore;90,00;oui;"), true);
  });

  it("19. un libellé qui contient un point-virgule est protégé", () => {
    const lignes = construireLignes(
      [seance({ event_type_name: 'Séance "longue"; suivi' })],
      CANAUX,
    );
    assert.equal(versCsv(lignes).includes('"Séance ""longue""; suivi"'), true);
  });

  /*
   * La décision 1 de la phase 7, posée là où elle se casserait.
   *
   * Depuis cette phase, le rendez-vous porte un nom. Le relevé, lui, est
   * conservé sans limite et survit à la purge de l'identité : un nom qui y
   * entrerait ne s'effacerait jamais. Aucun champ de `LigneReleve` ne peut en
   * porter un aujourd'hui — c'est une garantie de type — et ce test est là
   * pour que l'ajout d'un champ demain se remarque ici plutôt qu'en
   * production.
   */
  it("20. une ligne de relevé ne porte que ces champs-là, et aucun nom", () => {
    const [ligne] = construireLignes([seance()], CANAUX);

    assert.deepEqual(Object.keys(ligne!).sort(), [
      "canal",
      "canal_comete",
      "comptee",
      "date",
      "devise",
      "id",
      "montant_cents",
      "raison",
      "seance",
      "statut",
    ]);
  });
});

describe("qui peut clôturer, et quand", () => {
  it("20. un mois révolu sans relevé se clôture", () => {
    assert.deepEqual(peutCloturer(null, "2026-07-01", "2026-08-01"), { ok: true });
  });

  it("21. le mois en cours, non", () => {
    const verdict = peutCloturer(null, "2026-08-01", "2026-08-01");
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok === false ? verdict.raison : "", /pas terminé/);
  });

  it("22. un relevé contesté se re-clôture : c'est le geste attendu", () => {
    assert.deepEqual(peutCloturer("conteste", "2026-07-01", "2026-08-01"), { ok: true });
  });

  it("23. un relevé déjà clôturé attend une réponse, il ne se re-clôture pas", () => {
    const verdict = peutCloturer("cloture", "2026-07-01", "2026-08-01");
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok === false ? verdict.raison : "", /attend la réponse/);
  });

  it("24. un relevé validé ne se re-clôture jamais", () => {
    // Le client a dit oui sur des chiffres précis : les changer après coup
    // viderait sa validation de son sens.
    const verdict = peutCloturer("valide", "2026-07-01", "2026-08-01");
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok === false ? verdict.raison : "", /déjà validé/);
  });

  it("25. ni un relevé payé", () => {
    assert.equal(peutCloturer("paye", "2026-07-01", "2026-08-01").ok, false);
  });

  it("26. le mois révolu prime : un relevé contesté du mois en cours ne se clôture pas", () => {
    assert.equal(peutCloturer("conteste", "2026-08-01", "2026-08-01").ok, false);
  });
});

describe("marquer payé", () => {
  it("27. un relevé validé se marque payé d'un clic", () => {
    assert.deepEqual(peutMarquerPaye("valide"), { ok: true });
  });

  it("28. un relevé seulement clôturé exige une note", () => {
    const verdict = peutMarquerPaye("cloture");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false ? verdict.champ : "", "note");
  });

  it("29. … et une note d'espaces n'en est pas une", () => {
    assert.equal(peutMarquerPaye("cloture", "   ").ok, false);
  });

  it("30. avec la note, il passe", () => {
    assert.deepEqual(peutMarquerPaye("cloture", "Accord par téléphone le 3."), {
      ok: true,
    });
  });

  it("31. un relevé contesté se corrige avant de se payer", () => {
    const verdict = peutMarquerPaye("conteste", "on s'est arrangés");
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok === false ? verdict.raison : "", /re-clôture/);
  });

  it("32. un relevé déjà payé ne se repaie pas", () => {
    assert.equal(peutMarquerPaye("paye", "encore").ok, false);
  });
});
