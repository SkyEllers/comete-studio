/**
 * Le mois du studio et sa porte de sortie, déroulés hors du navigateur.
 *
 *   npm run test
 *
 * Deux endroits où l'on se tromperait sans le voir : le partage facturable /
 * non facturable, qui se lit sur le client et non sur le type de tâche — une
 * réunion pour Peggy se vend, la même pour Comète non — et le CSV, dont on ne
 * s'aperçoit qu'il est cassé qu'une fois ouvert dans un tableur en français.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ecart, ecartPourcentage, vueComete } from "./comete.ts";
import { nomDuFichier, versCsv } from "./csv.ts";
import type { Entree, FicheClient } from "./types.ts";

const client = (
  id: string,
  extra: Partial<FicheClient> = {},
): FicheClient => ({
  id,
  name: id,
  is_internal: false,
  statut: "pilotage",
  profil: null,
  modele: "recurrent",
  montant_cents: 0,
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
    id: `${clientId}-${minutes}-${extra.task ?? "site"}`,
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

const COMETE = client("comete", { is_internal: true, modele: "historique" });

describe("le mois du studio", () => {
  it("1. le facturable se lit sur le client, pas sur le type de tâche", () => {
    // Deux réunions : l'une pour un client, l'autre en interne.
    const vue = vueComete(
      [COMETE, client("peggy", { profil: "p1", montant_cents: 55000 })],
      [
        heure("peggy", 120, { task: "reunion" }),
        heure("comete", 60, { task: "reunion" }),
      ],
      "2026-09-01",
    );

    assert.equal(vue.minutesFacturables, 120);
    assert.equal(vue.minutesNonFacturables, 60);
  });

  it("2. la part de non facturable est un pourcentage du temps compté", () => {
    const vue = vueComete(
      [COMETE, client("peggy")],
      [heure("peggy", 720), heure("comete", 280)],
      "2026-09-01",
    );

    // 280 sur 1000 minutes.
    assert.equal(vue.partNonFacturable, 28);
  });

  it("3. un mois vide ne divise pas par zéro", () => {
    const vue = vueComete([COMETE], [], "2026-09-01");

    assert.equal(vue.partNonFacturable, 0);
    assert.equal(vue.tauxMoyenCents, null);
    assert.equal(vue.encaisseCents, 0);
  });

  it("4. le taux moyen rapporte l'encaissé aux seules heures facturables", () => {
    const vue = vueComete(
      [COMETE, client("peggy", { montant_cents: 55000 })],
      [heure("peggy", 540), heure("comete", 600)],
      "2026-09-01",
    );

    // 550 € pour 9 h facturables : les 10 h internes ne diluent pas le taux.
    assert.equal(vue.encaisseCents, 55000);
    assert.equal(vue.tauxMoyenCents, 6111);
  });

  it("5. le client interne ne rapporte rien, même avec un montant en fiche", () => {
    const vue = vueComete(
      [client("comete", { is_internal: true, montant_cents: 999999 })],
      [heure("comete", 300)],
      "2026-09-01",
    );

    assert.equal(vue.encaisseCents, 0);
  });

  it("6. les cinq seaux de profil sont toujours là, même vides", () => {
    const vue = vueComete(
      [COMETE, client("peggy", { profil: "p1" }), client("sans", {})],
      [heure("peggy", 120), heure("sans", 60), heure("comete", 30)],
      "2026-09-01",
    );

    assert.deepEqual(vue.parProfil, [
      { profil: "p1", minutes: 120 },
      { profil: "p2", minutes: 0 },
      { profil: "p3", minutes: 0 },
      { profil: "hors_cible", minutes: 0 },
      { profil: null, minutes: 60 },
    ]);
  });

  it("7. les heures internes ne comptent dans aucun profil", () => {
    const vue = vueComete([COMETE], [heure("comete", 300)], "2026-09-01");

    assert.equal(
      vue.parProfil.reduce((somme, part) => somme + part.minutes, 0),
      0,
    );
  });

  it("8. la prospection se compte tous clients confondus", () => {
    const vue = vueComete(
      [COMETE, client("peggy")],
      [
        heure("comete", 120, { task: "prospection" }),
        heure("peggy", 60, { task: "prospection" }),
        heure("peggy", 300, { task: "site" }),
      ],
      "2026-09-01",
    );

    assert.equal(vue.minutesProspection, 180);
  });

  it("9. le chronomètre en marche ne compte nulle part", () => {
    const vue = vueComete(
      [COMETE, client("peggy")],
      [heure("peggy", 60), heure("peggy", null as unknown as number)],
      "2026-09-01",
    );

    assert.equal(vue.minutesFacturables, 60);
  });
});

describe("la comparaison avec le mois d'avant", () => {
  it("10. dit le sens en toutes lettres", () => {
    assert.equal(ecart(600, 480, "août"), "2 h de plus qu'en août");
    assert.equal(ecart(480, 600, "août"), "2 h de moins qu'en août");
  });

  it("11. deux mois identiques le disent aussi", () => {
    assert.equal(ecart(600, 600, "août"), "autant qu'en août");
  });

  it("12. deux mois vides n'ont rien à comparer", () => {
    assert.equal(ecart(0, 0, "août"), null);
  });

  it("13. un mois précédent vide se dit sans fraction impossible", () => {
    assert.equal(ecart(600, 0, "août"), "rien en août");
  });

  it("14. les pourcentages se comparent en points", () => {
    assert.equal(ecartPourcentage(28, 20, "août"), "8 points de plus qu'en août");
    assert.equal(ecartPourcentage(20, 21, "août"), "1 point de moins qu'en août");
    assert.equal(ecartPourcentage(28, 28, "août"), null);
  });
});

describe("le CSV", () => {
  const lignes = [
    {
      jour: "2026-09-12",
      client: "Peggy",
      entree: {
        task: "emails" as const,
        phase: "pilotage" as const,
        duration_minutes: 15,
        note: null,
      },
    },
  ];

  it("15. l'en-tête porte les six colonnes du brief", () => {
    const entete = versCsv(lignes).split("\r\n")[0];

    assert.equal(entete, "Date;Client;Type;Phase;Durée (h);Note");
  });

  it("16. un quart d'heure vaut 0,25 — virgule décimale, pour le tableur", () => {
    const ligne = versCsv(lignes).split("\r\n")[1];

    assert.equal(ligne, "2026-09-12;Peggy;Emails;Pilotage;0,25;");
  });

  it("17. les lignes sont séparées par des retours Windows", () => {
    assert.equal(versCsv(lignes).includes("\r\n"), true);
  });

  it("18. une note qui contient un point-virgule ne casse pas les colonnes", () => {
    const sortie = versCsv([
      {
        ...lignes[0],
        entree: { ...lignes[0].entree, note: "appel ; puis relance" },
      },
    ]);

    assert.equal(sortie.split("\r\n")[1].endsWith('"appel ; puis relance"'), true);
  });

  it("19. et une note qui contient un guillemet le double", () => {
    const sortie = versCsv([
      {
        ...lignes[0],
        entree: { ...lignes[0].entree, note: 'il a dit "oui"' },
      },
    ]);

    assert.equal(sortie.split("\r\n")[1].endsWith('"il a dit ""oui"""'), true);
  });

  it("20. un export vide garde son en-tête — un fichier sans colonne ne se lit pas", () => {
    assert.equal(versCsv([]), "Date;Client;Type;Phase;Durée (h);Note");
  });

  it("21. le fichier porte sa période dans son nom", () => {
    assert.equal(
      nomDuFichier("2026-01-01", "2026-03-31"),
      "pulsar-2026-01-01-au-2026-03-31",
    );
  });
});
