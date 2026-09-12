/**
 * Ce que Pulsar compte, déroulé hors du navigateur.
 *
 *   npm run test
 *
 * Trois endroits où une erreur ne se voit pas à l'écran : l'arrondi, qui ne se
 * trahit qu'à la fin du mois quand le taux horaire semble bas sans raison ; le
 * fuseau, qui ne se trahit qu'entre 22 h et minuit ; et la semaine, qui ne se
 * trahit que le lundi et le dimanche. Ce sont exactement les cas qu'une
 * recette manuelle ne rencontre jamais.
 *
 * Les instants sont écrits en UTC et attendus en heure de Paris : c'est la
 * conversion elle-même qu'on met à l'épreuve.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ordonnerClients } from "./clients.ts";
import {
  arrondirQuartHeure,
  entreesDeLaSemaine,
  entreesDuJour,
  formatChrono,
  formatDuree,
  phaseDuClient,
  totalMinutes,
} from "./duree.ts";
import type { ClientPulsar, Entree } from "./types.ts";

const minutes = (n: number) => n * 60_000;

describe("l'arrondi au quart d'heure supérieur", () => {
  it("1. sept minutes valent quinze — le cas du brief", () => {
    assert.equal(arrondirQuartHeure(minutes(7)), 15);
  });

  it("2. seize minutes valent trente — l'autre cas du brief", () => {
    assert.equal(arrondirQuartHeure(minutes(16)), 30);
  });

  it("3. un quart d'heure juste reste un quart d'heure", () => {
    assert.equal(arrondirQuartHeure(minutes(15)), 15);
    assert.equal(arrondirQuartHeure(minutes(30)), 30);
    assert.equal(arrondirQuartHeure(minutes(45)), 45);
  });

  it("4. une seconde de plus qu'un quart d'heure fait passer au suivant", () => {
    assert.equal(arrondirQuartHeure(minutes(15) + 1_000), 30);
  });

  it("5. une tâche de trois minutes coûte quand même un quart d'heure", () => {
    assert.equal(arrondirQuartHeure(minutes(3)), 15);
    assert.equal(arrondirQuartHeure(0), 15);
  });

  it("6. une horloge qui recule ne produit pas de durée négative", () => {
    // La base refuserait la ligne, et l'écran afficherait « -15 min ».
    assert.equal(arrondirQuartHeure(-minutes(40)), 15);
  });

  it("7. une longue séance s'arrondit comme les autres", () => {
    assert.equal(arrondirQuartHeure(minutes(184)), 195);
  });

  it("8. tout arrondi est un multiple de quinze, ce que la base exige", () => {
    for (let m = 0; m <= 600; m += 1) {
      const retenu = arrondirQuartHeure(minutes(m));
      assert.equal(retenu % 15, 0, `${m} min → ${retenu}`);
      assert.ok(retenu >= 15);
      assert.ok(retenu >= m, `${m} min arrondi à ${retenu}, en dessous du réel`);
    }
  });
});

describe("les durées telles qu'on les lit", () => {
  it("9. sous l'heure, des minutes", () => {
    assert.equal(formatDuree(15), "15 min");
    assert.equal(formatDuree(45), "45 min");
  });

  it("10. l'heure ronde ne traîne pas de zéros", () => {
    assert.equal(formatDuree(60), "1 h");
    assert.equal(formatDuree(120), "2 h");
  });

  it("11. au-delà, les minutes sont sur deux chiffres", () => {
    assert.equal(formatDuree(75), "1 h 15");
    assert.equal(formatDuree(545), "9 h 05");
  });

  it("12. une journée vide vaut zéro minute, pas « rien »", () => {
    assert.equal(formatDuree(0), "0 min");
  });

  it("13. le compteur qui défile affiche les secondes", () => {
    assert.equal(formatChrono(0), "0:00:00");
    assert.equal(formatChrono(7_000), "0:00:07");
    assert.equal(formatChrono(minutes(7) + 12_000), "0:07:12");
    assert.equal(formatChrono(minutes(125)), "2:05:00");
  });
});

describe("la phase, figée à la saisie", () => {
  it("14. le client interne porte l'interne, quel que soit son statut", () => {
    assert.equal(phaseDuClient({ is_internal: true, statut: "setup" }), "interne");
    assert.equal(phaseDuClient({ is_internal: true, statut: "pilotage" }), "interne");
  });

  it("15. un client en setup porte le setup, en pilotage le pilotage", () => {
    assert.equal(phaseDuClient({ is_internal: false, statut: "setup" }), "setup");
    assert.equal(phaseDuClient({ is_internal: false, statut: "pilotage" }), "pilotage");
  });

  it("16. un client terminé a forcément fini son setup", () => {
    assert.equal(phaseDuClient({ is_internal: false, statut: "termine" }), "pilotage");
  });
});

// ------------------------------ Le découpage --------------------------------

const entree = (id: string, started_at: string, duree: number | null): Entree => ({
  id,
  client_id: `client-${id}`,
  task: "site",
  phase: "setup",
  started_at,
  ended_at: duree === null ? null : started_at,
  duration_minutes: duree,
  note: null,
  is_manual: false,
});

describe("la journée et la semaine, en heure de Paris", () => {
  it("17. une entrée de 00 h 30 à Paris appartient à ce jour-là", () => {
    // 11 septembre 22 h 30 UTC = 12 septembre 00 h 30 à Paris (UTC+2).
    const lot = [entree("a", "2026-09-11T22:30:00Z", 15)];
    assert.equal(entreesDuJour(lot, "2026-09-12").length, 1);
    assert.equal(entreesDuJour(lot, "2026-09-11").length, 0);
  });

  it("18. une entrée de 23 h 50 à Paris n'est pas du lendemain", () => {
    const lot = [entree("a", "2026-09-12T21:50:00Z", 15)];
    assert.equal(entreesDuJour(lot, "2026-09-12").length, 1);
  });

  it("19. la semaine va du lundi au dimanche, bornes comprises", () => {
    const lot = [
      entree("dimanche-avant", "2026-09-06T10:00:00Z", 15),
      entree("lundi", "2026-09-07T10:00:00Z", 30),
      entree("dimanche", "2026-09-13T10:00:00Z", 45),
      entree("lundi-apres", "2026-09-14T10:00:00Z", 60),
    ];

    const semaine = entreesDeLaSemaine(lot, "2026-09-12");
    assert.deepEqual(
      semaine.map((e) => e.id),
      ["lundi", "dimanche"],
    );
  });

  it("20. un lundi, la semaine ne remonte pas au dimanche de la veille", () => {
    const lot = [
      entree("dimanche", "2026-09-06T10:00:00Z", 15),
      entree("lundi", "2026-09-07T10:00:00Z", 30),
    ];

    assert.deepEqual(
      entreesDeLaSemaine(lot, "2026-09-07").map((e) => e.id),
      ["lundi"],
    );
  });

  it("21. un dimanche, la semaine tient encore tout entière", () => {
    const lot = [
      entree("lundi", "2026-09-07T10:00:00Z", 30),
      entree("dimanche", "2026-09-13T10:00:00Z", 45),
    ];

    assert.equal(entreesDeLaSemaine(lot, "2026-09-13").length, 2);
  });

  it("22. le total ignore le chronomètre en marche, qui n'a pas de durée", () => {
    const lot = [
      entree("finie", "2026-09-12T08:00:00Z", 45),
      entree("finie-2", "2026-09-12T09:00:00Z", 15),
      entree("en-cours", "2026-09-12T10:00:00Z", null),
    ];

    assert.equal(totalMinutes(lot), 60);
  });
});

// -------------------------------- Les puces ----------------------------------

const client = (
  id: string,
  name: string,
  extra: Partial<ClientPulsar> = {},
): ClientPulsar => ({
  id,
  name,
  is_internal: false,
  statut: "pilotage",
  ...extra,
});

describe("l'ordre des puces de client", () => {
  it("23. « Comète » passe devant, même jamais utilisé", () => {
    const clients = [
      client("peggy", "Peggy"),
      client("comete", "Comète", { is_internal: true }),
    ];

    const ordre = ordonnerClients(clients, [
      { client_id: "peggy", started_at: "2026-09-12T08:00:00Z" },
    ]);

    assert.deepEqual(
      ordre.map((c) => c.id),
      ["comete", "peggy"],
    );
  });

  it("24. puis les plus récemment chronométrés", () => {
    const clients = [
      client("a", "Alice"),
      client("b", "Bertrand"),
      client("c", "Camille"),
    ];

    const ordre = ordonnerClients(clients, [
      { client_id: "a", started_at: "2026-09-10T08:00:00Z" },
      { client_id: "c", started_at: "2026-09-12T08:00:00Z" },
      { client_id: "a", started_at: "2026-09-11T08:00:00Z" },
    ]);

    assert.deepEqual(
      ordre.map((c) => c.id),
      ["c", "a", "b"],
    );
  });

  it("25. les jamais utilisés ferment la marche, dans l'ordre alphabétique", () => {
    const clients = [
      client("z", "Zoé"),
      client("e", "Émile"),
      client("a", "Alice"),
    ];

    assert.deepEqual(
      ordonnerClients(clients, []).map((c) => c.id),
      ["a", "e", "z"],
    );
  });

  it("26. l'ordre ne dépend pas de celui d'entrée, et n'abîme pas la liste reçue", () => {
    const clients = [client("a", "Alice"), client("b", "Bertrand")];
    const copie = [...clients];

    ordonnerClients(clients, [{ client_id: "b", started_at: "2026-09-12T08:00:00Z" }]);

    assert.deepEqual(clients, copie);
  });
});
