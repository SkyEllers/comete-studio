/**
 * Ce que le temps rapporte, déroulé hors du navigateur.
 *
 *   npm run test
 *
 * C'est le fichier le plus important de Pulsar. Un encaissé compté un mois de
 * trop ne lève aucune erreur : il affiche un taux horaire flatteur, et on y
 * croit. Les quatre exemples du brief sont ici, et les bords que l'œil ne
 * rattrape pas avec eux — le mois du début, celui de la fin, et les modèles
 * qui ne rapportent rien.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alerteHeures,
  alerteTaux,
  baseDuTaux,
  bilanDuClient,
  bilansDuMois,
  encaisseCumule,
  encaisseDuMois,
  euros,
  moisDuJour,
  nombreDeMois,
  parPhase,
  parTache,
  tauxHoraire,
  tauxLisible,
  type FicheRevenu,
} from "./revenus.ts";
import type { Entree, FicheClient } from "./types.ts";

/*
 * `Intl` sépare le nombre du symbole par une espace insécable (U+00A0),
 * invisible à la relecture et différente de la barre d'espace. Écrite en
 * échappement, elle ne se perd pas dans un copier-coller — et une assertion
 * qui échoue sur « 550 € !== 550 € » coûte un quart d'heure à comprendre.
 */
const INSECABLE = String.fromCharCode(0xa0);
const eur = (texte: string) => `${texte}${INSECABLE}€`;

const fiche = (extra: Partial<FicheRevenu> = {}): FicheRevenu => ({
  modele: "recurrent",
  montant_cents: 55000,
  date_debut: "2026-01-01",
  fin_engagement: null,
  is_internal: false,
  ...extra,
});

describe("l'arithmétique des mois", () => {
  it("1. un jour se ramène au premier de son mois", () => {
    assert.equal(moisDuJour("2026-09-17"), "2026-09-01");
    assert.equal(moisDuJour("2026-01-31"), "2026-01-01");
  });

  it("2. du 1er au 1er fait un mois, bornes comprises", () => {
    assert.equal(nombreDeMois("2026-01-01", "2026-01-01"), 1);
    assert.equal(nombreDeMois("2026-01-01", "2026-03-01"), 3);
  });

  it("3. et les années se franchissent", () => {
    assert.equal(nombreDeMois("2026-11-01", "2027-02-01"), 4);
    assert.equal(nombreDeMois("2026-01-01", "2027-01-01"), 13);
  });

  it("4. une fin avant le début ne compte aucun mois", () => {
    assert.equal(nombreDeMois("2026-06-01", "2026-01-01"), 0);
  });
});

describe("le récurrent", () => {
  it("5. compte son montant chaque mois de l'engagement", () => {
    const client = fiche({ date_debut: "2026-01-15" });

    assert.equal(encaisseDuMois(client, "2026-01-01"), 55000);
    assert.equal(encaisseDuMois(client, "2026-06-01"), 55000);
  });

  it("6. ne compte rien avant le mois du début", () => {
    const client = fiche({ date_debut: "2026-03-10" });

    assert.equal(encaisseDuMois(client, "2026-02-01"), 0);
    assert.equal(encaisseDuMois(client, "2026-03-01"), 55000);
  });

  it("7. compte le mois de la fin, puis plus rien", () => {
    const client = fiche({ date_debut: "2026-01-01", fin_engagement: "2026-04-20" });

    assert.equal(encaisseDuMois(client, "2026-04-01"), 55000);
    assert.equal(encaisseDuMois(client, "2026-05-01"), 0);
  });

  it("8. son cumulé additionne les mois écoulés, celui affiché compris", () => {
    const client = fiche({ date_debut: "2026-01-01" });

    assert.equal(encaisseCumule(client, "2026-01-01"), 55000);
    assert.equal(encaisseCumule(client, "2026-03-01"), 165000);
  });

  it("9. et son cumulé s'arrête à la fin de l'engagement", () => {
    const client = fiche({ date_debut: "2026-01-01", fin_engagement: "2026-03-31" });

    assert.equal(encaisseCumule(client, "2026-03-01"), 165000);
    assert.equal(encaisseCumule(client, "2026-12-01"), 165000);
  });

  it("10. sans date de début, il ne compte rien plutôt que de deviner", () => {
    assert.equal(encaisseDuMois(fiche({ date_debut: null }), "2026-06-01"), 0);
    assert.equal(encaisseCumule(fiche({ date_debut: null }), "2026-06-01"), 0);
  });
});

describe("le one-shot", () => {
  const unique = fiche({ modele: "one_shot", montant_cents: 120000, date_debut: "2026-03-05" });

  it("11. compte une fois, sur le mois de son début", () => {
    assert.equal(encaisseDuMois(unique, "2026-03-01"), 120000);
    assert.equal(encaisseDuMois(unique, "2026-04-01"), 0);
    assert.equal(encaisseDuMois(unique, "2026-02-01"), 0);
  });

  it("12. son cumulé reste le même une fois le mois passé", () => {
    assert.equal(encaisseCumule(unique, "2026-02-01"), 0);
    assert.equal(encaisseCumule(unique, "2026-03-01"), 120000);
    assert.equal(encaisseCumule(unique, "2026-09-01"), 120000);
  });

  it("13. et son taux ne se lit qu'en cumulé", () => {
    assert.equal(baseDuTaux({ modele: "one_shot" }), "cumule");
    assert.equal(baseDuTaux({ modele: "recurrent" }), "mois");
    assert.equal(baseDuTaux({ modele: "historique" }), "mois");
  });
});

describe("ce qui ne rapporte rien", () => {
  it("14. la commission rend zéro en v1 — une mesure qui manque", () => {
    const client = fiche({ modele: "commission", montant_cents: 300000 });

    assert.equal(encaisseDuMois(client, "2026-06-01"), 0);
    assert.equal(encaisseCumule(client, "2026-06-01"), 0);
  });

  it("15. l'historique rend zéro — des heures grises, assumées", () => {
    const client = fiche({ modele: "historique", montant_cents: 200000 });

    assert.equal(encaisseDuMois(client, "2026-06-01"), 0);
  });

  it("16. le client interne ne rapporte jamais rien, quel que soit son modèle", () => {
    const comete = fiche({ is_internal: true, montant_cents: 999999 });

    assert.equal(encaisseDuMois(comete, "2026-06-01"), 0);
    assert.equal(encaisseCumule(comete, "2026-06-01"), 0);
  });
});

describe("le taux horaire réel", () => {
  it("17. 550 € sur 9 h font 61 €/h — l'exemple du brief", () => {
    const taux = tauxHoraire(55000, 9 * 60);

    assert.equal(taux, 6111);
    assert.equal(tauxLisible(taux), `${eur("61")}/h`);
  });

  it("18. sans heures, il n'y a pas de taux — un tiret, pas un zéro", () => {
    assert.equal(tauxHoraire(55000, 0), null);
    assert.equal(tauxLisible(null), "—");
  });

  it("19. un historique affiche 0 €/h sans casser le calcul", () => {
    const taux = tauxHoraire(encaisseDuMois(fiche({ modele: "historique" }), "2026-06-01"), 300);

    assert.equal(taux, 0);
    assert.equal(tauxLisible(taux), `${eur("0")}/h`);
  });

  it("20. les montants s'écrivent sans centimes", () => {
    assert.equal(euros(55000), eur("550"));
    assert.equal(euros(6111), eur("61"));
    assert.equal(euros(0), eur("0"));
  });
});

describe("les deux alertes", () => {
  const seuil = 4000;

  it("21. un taux sous le seuil passe la ligne en orange", () => {
    assert.equal(alerteTaux(fiche(), 3900, seuil), true);
    assert.equal(alerteTaux(fiche(), 4000, seuil), false);
    assert.equal(alerteTaux(fiche(), 6111, seuil), false);
  });

  it("22. sans heures, pas d'alerte : il n'y a rien à juger", () => {
    assert.equal(alerteTaux(fiche(), null, seuil), false);
  });

  it("23. ni le client interne, ni l'historique, ni la commission ne s'allument", () => {
    // Ils seraient orange tous les mois, et une alerte toujours allumée ne
    // s'allume plus.
    assert.equal(alerteTaux(fiche({ is_internal: true }), 0, seuil), false);
    assert.equal(alerteTaux(fiche({ modele: "historique" }), 0, seuil), false);
    assert.equal(alerteTaux(fiche({ modele: "commission" }), 0, seuil), false);
  });

  it("24. un client en pilotage au-delà du plafond passe en orange", () => {
    const client = { statut: "pilotage" as const, is_internal: false };

    assert.equal(alerteHeures(client, 11 * 60, 10), true);
    assert.equal(alerteHeures(client, 10 * 60, 10), false);
  });

  it("25. mais pas un client encore en setup — le plafond est celui du pilotage", () => {
    assert.equal(
      alerteHeures({ statut: "setup", is_internal: false }, 40 * 60, 10),
      false,
    );
  });

  it("26. ni « Comète », qui n'est le pilotage de personne", () => {
    assert.equal(
      alerteHeures({ statut: "pilotage", is_internal: true }, 40 * 60, 10),
      false,
    );
  });
});

// ------------------------------ Les répartitions -----------------------------

const entree = (phase: Entree["phase"], task: Entree["task"], minutes: number | null) =>
  ({ phase, task, duration_minutes: minutes }) as Entree;

describe("les répartitions", () => {
  it("27. la phase figée décide, pas le statut d'aujourd'hui", () => {
    // Un client passé en pilotage le 12 : ses heures d'avant restent en setup.
    const mois = [
      entree("setup", "site", 120),
      entree("setup", "seo", 60),
      entree("pilotage", "ads", 90),
    ];

    assert.deepEqual(parPhase(mois), { setup: 180, pilotage: 90, interne: 0 });
  });

  it("28. le chronomètre en marche ne compte nulle part", () => {
    const mois = [entree("setup", "site", 60), entree("setup", "site", null)];

    assert.deepEqual(parPhase(mois), { setup: 60, pilotage: 0, interne: 0 });
    assert.deepEqual(parTache(mois), [{ task: "site", minutes: 60 }]);
  });

  it("29. les tâches sortent de la plus lourde à la plus légère", () => {
    const mois = [
      entree("setup", "emails", 30),
      entree("setup", "site", 180),
      entree("pilotage", "ads", 90),
      entree("setup", "site", 60),
    ];

    assert.deepEqual(parTache(mois), [
      { task: "site", minutes: 240 },
      { task: "ads", minutes: 90 },
      { task: "emails", minutes: 30 },
    ]);
  });

  it("30. un mois vide ne rend pas de barres", () => {
    assert.deepEqual(parTache([]), []);
    assert.deepEqual(parPhase([]), { setup: 0, pilotage: 0, interne: 0 });
  });
});

// ---------------------------------- Le bilan ---------------------------------

const SEUILS = { taux_alerte_cents: 4000, heures_pilotage_alerte: 10 };

const client = (extra: Partial<FicheClient> = {}): FicheClient => ({
  id: "peggy",
  name: "Peggy",
  is_internal: false,
  statut: "pilotage",
  profil: "p1",
  modele: "recurrent",
  montant_cents: 55000,
  date_debut: "2026-01-01",
  fin_engagement: null,
  ...extra,
});

const heure = (
  clientId: string,
  minutes: number,
  extra: Partial<Entree> = {},
): Entree =>
  ({
    id: `${clientId}-${minutes}-${extra.phase ?? "pilotage"}`,
    client_id: clientId,
    task: "site",
    phase: "pilotage",
    started_at: "2026-09-10T08:00:00Z",
    ended_at: "2026-09-10T09:00:00Z",
    duration_minutes: minutes,
    note: null,
    is_manual: false,
    ...extra,
  }) as Entree;

describe("le bilan d'un client", () => {
  it("31. un récurrent à 550 € et 9 h affiche 61 €/h — l'exemple du brief", () => {
    const bilan = bilanDuClient(client(), [heure("peggy", 540)], 540, "2026-09-01", SEUILS);

    assert.equal(bilan.minutesDuMois, 540);
    assert.equal(bilan.encaisseCents, 55000);
    assert.equal(bilan.base, "mois");
    assert.equal(tauxLisible(bilan.tauxCents), `${eur("61")}/h`);
    assert.equal(bilan.alerteTaux, false);
  });

  it("32. le même passé en pilotage le 12 garde ses heures d'avant en setup", () => {
    const bilan = bilanDuClient(
      client(),
      [
        heure("peggy", 180, { phase: "setup" }),
        heure("peggy", 120, { phase: "pilotage" }),
      ],
      300,
      "2026-09-01",
      SEUILS,
    );

    assert.deepEqual(bilan.phases, { setup: 180, pilotage: 120, interne: 0 });
  });

  it("33. un one-shot lit son taux sur le cumul, pas sur le mois", () => {
    const unique = client({
      id: "jonathan",
      name: "Jonathan",
      modele: "one_shot",
      montant_cents: 120000,
      date_debut: "2026-03-05",
    });

    // 2 h ce mois-ci, 40 h depuis le début : c'est 40 h qui comptent.
    const bilan = bilanDuClient(unique, [heure("jonathan", 120)], 2400, "2026-09-01", SEUILS);

    assert.equal(bilan.base, "cumule");
    assert.equal(bilan.encaisseCents, 120000);
    assert.equal(tauxLisible(bilan.tauxCents), `${eur("30")}/h`);
    assert.equal(bilan.alerteTaux, true);
  });

  it("34. un historique affiche 0 € sans casser les moyennes", () => {
    const ancien = client({ id: "vieux", name: "Ancien", modele: "historique" });
    const bilan = bilanDuClient(ancien, [heure("vieux", 600)], 600, "2026-09-01", SEUILS);

    assert.equal(bilan.encaisseCents, 0);
    assert.equal(tauxLisible(bilan.tauxCents), `${eur("0")}/h`);
    assert.equal(bilan.alerteTaux, false);
  });

  it("35. un client en pilotage au-delà de son plafond passe en orange", () => {
    const bilan = bilanDuClient(client(), [heure("peggy", 12 * 60)], 720, "2026-09-01", SEUILS);

    assert.equal(bilan.alerteHeures, true);
  });

  it("36. les heures d'un autre client ne comptent pas dans les siennes", () => {
    const bilan = bilanDuClient(
      client(),
      [heure("peggy", 120), heure("jonathan", 300)],
      120,
      "2026-09-01",
      SEUILS,
    );

    assert.equal(bilan.minutesDuMois, 120);
  });

  it("37. les archivés descendent en bas, les plus lourds du mois en haut", () => {
    const clients = [
      client({ id: "leger", name: "Léger" }),
      client({ id: "archive", name: "Archivé", statut: "termine" }),
      client({ id: "lourd", name: "Lourd" }),
    ];

    const bilans = bilansDuMois(
      clients,
      [heure("leger", 60), heure("lourd", 600), heure("archive", 900)],
      new Map(),
      "2026-09-01",
      SEUILS,
    );

    assert.deepEqual(
      bilans.map((b) => b.client.id),
      ["lourd", "leger", "archive"],
    );
  });
});
