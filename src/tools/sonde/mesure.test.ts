/**
 * Le comptage de Sonde, déroulé hors de la base.
 *
 *   npm run test
 *
 * Trois choses s'y jouent, qu'on ne verrait pas à l'écran.
 *
 * La couture entre l'agrégat des nuits passées et les événements du jour :
 * si elle laisse un trou, un client voit sa journée à zéro ; si elle recouvre,
 * il voit ses visiteurs comptés deux fois. Ni l'un ni l'autre ne se remarque
 * quand on regarde un chiffre isolé.
 *
 * Le découpage des jours en heure de Paris, qui décide de quel côté d'une
 * colonne tombe une visite de 23 h 50.
 *
 * Et les périodes, qui ne doivent jamais montrer de jours à venir.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agregerBruts,
  depuisQuandRelire,
  joursDe,
  jourSuivant,
  mesurer,
  periodeDemandee,
  periodesAOffrir,
  taux,
  type EvenementBrut,
  type LigneJour,
} from "./mesure.ts";

const ligne = (
  day: string,
  extra: Partial<LigneJour> = {},
): LigneJour => ({
  day,
  channel_id: null,
  channel_bucket: "direct",
  pageviews: 1,
  visitors: 1,
  cta_clicks: 0,
  ...extra,
});

describe("les jours", () => {
  it("1. le lendemain se calcule en calendrier, pas en 24 heures", () => {
    assert.equal(jourSuivant("2026-08-30"), "2026-08-31");
    assert.equal(jourSuivant("2026-08-31"), "2026-09-01");
    assert.equal(jourSuivant("2026-12-31"), "2027-01-01");
    assert.equal(jourSuivant("2028-02-28"), "2028-02-29");
  });

  it("2. et il traverse le changement d'heure sans sauter un jour", () => {
    // Dernier dimanche d'octobre 2026 : la nuit fait 25 heures.
    assert.equal(jourSuivant("2026-10-24"), "2026-10-25");
    assert.equal(jourSuivant("2026-10-25"), "2026-10-26");
    // Dernier dimanche de mars : elle en fait 23.
    assert.equal(jourSuivant("2026-03-28"), "2026-03-29");
    assert.equal(jourSuivant("2026-03-29"), "2026-03-30");
  });

  it("3. une série de jours est complète, bornes comprises", () => {
    assert.deepEqual(joursDe("2026-08-29", "2026-09-01"), [
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
    assert.deepEqual(joursDe("2026-08-30", "2026-08-30"), ["2026-08-30"]);
    assert.deepEqual(joursDe("2026-08-31", "2026-08-30"), []);
  });
});

describe("les périodes", () => {
  const AUJOURD_HUI = "2026-08-30";

  it("4. par défaut, le mois en cours, borné à aujourd'hui", () => {
    const periode = periodeDemandee(undefined, AUJOURD_HUI);
    assert.equal(periode.cle, "2026-08-01");
    assert.equal(periode.debut, "2026-08-01");
    assert.equal(periode.fin, AUJOURD_HUI, "le mois ne doit pas déborder dans l'avenir");
  });

  it("5. un mois passé va jusqu'à son dernier jour", () => {
    const periode = periodeDemandee("2026-07-01", AUJOURD_HUI);
    assert.equal(periode.fin, "2026-07-31");
    assert.equal(periode.libelle, "juillet 2026");
  });

  it("6. février d'une année bissextile compte vingt-neuf jours", () => {
    assert.equal(periodeDemandee("2024-02-01", AUJOURD_HUI).fin, "2024-02-29");
  });

  it("6 bis. un mois à venir retombe sur le mois en cours", () => {
    // Sans ce garde-fou, la période commencerait après sa fin.
    const periode = periodeDemandee("2030-01-01", AUJOURD_HUI);
    assert.equal(periode.cle, "2026-08-01");
    assert.ok(periode.debut <= periode.fin);
  });

  it("7. les sept derniers jours en font bien sept", () => {
    const periode = periodeDemandee("7j", AUJOURD_HUI);
    assert.equal(periode.debut, "2026-08-24");
    assert.equal(periode.fin, "2026-08-30");
    assert.equal(joursDe(periode.debut, periode.fin).length, 7);
  });

  it("8. ce qui vient de l'URL ne se croit pas", () => {
    for (const bidon of ["hier", "2026-08-15", "../../etc", ""]) {
      assert.equal(periodeDemandee(bidon, AUJOURD_HUI).cle, "2026-08-01", bidon);
    }
  });

  it("9. le mois en cours est toujours proposé, même sans une seule visite", () => {
    const choix = periodesAOffrir([], AUJOURD_HUI);
    assert.deepEqual(choix.map((c) => c.cle), ["7j", "2026-08-01"]);
  });

  it("10. et les mois connus le sont aussi, du plus récent au plus ancien", () => {
    const choix = periodesAOffrir(
      ["2026-06-04", "2026-08-02", "2026-07-30", "2026-06-28"],
      AUJOURD_HUI,
    );
    assert.deepEqual(choix.map((c) => c.cle), [
      "7j",
      "2026-08-01",
      "2026-07-01",
      "2026-06-01",
    ]);
  });
});

describe("la couture entre l'agrégat et le direct", () => {
  const AUJOURD_HUI = "2026-08-30";

  it("11. sans agrégat, on relit tout depuis le début de la période", () => {
    assert.equal(depuisQuandRelire([], "2026-08-01", AUJOURD_HUI), "2026-08-01");
  });

  it("12. l'agrégat s'arrêtant hier, on relit le jour courant", () => {
    const lignes = [ligne("2026-08-28"), ligne("2026-08-29")];
    assert.equal(depuisQuandRelire(lignes, "2026-08-01", AUJOURD_HUI), "2026-08-30");
  });

  it("13. une nuit ratée se rattrape sans qu'on la déclare", () => {
    // L'agrégation n'a pas tourné depuis le 27 : on relit à partir du 28.
    const lignes = [ligne("2026-08-26"), ligne("2026-08-27")];
    assert.equal(depuisQuandRelire(lignes, "2026-08-01", AUJOURD_HUI), "2026-08-28");
  });

  it("14. une ligne portant le jour courant ne fige pas la journée", () => {
    // Un recalcul manuel a écrit une ligne pour aujourd'hui : elle est ignorée,
    // sans quoi la journée cesserait de bouger jusqu'à minuit.
    const lignes = [ligne("2026-08-29"), ligne(AUJOURD_HUI)];
    assert.equal(depuisQuandRelire(lignes, "2026-08-01", AUJOURD_HUI), "2026-08-30");
  });

  it("15. l'agrégat plus vieux que la période ne fait pas remonter le curseur", () => {
    const lignes = [ligne("2026-06-15")];
    assert.equal(depuisQuandRelire(lignes, "2026-08-01", AUJOURD_HUI), "2026-08-01");
  });
});

describe("agregerBruts — compter comme la base compte", () => {
  const brut = (extra: Partial<EvenementBrut> = {}): EvenementBrut => ({
    occurred_at: "2026-08-30T10:00:00Z",
    kind: "pageview",
    channel_id: null,
    channel_bucket: "direct",
    visitor_key: "cle-1",
    ...extra,
  });

  it("16. les visiteurs sont distincts, les pages vues non", () => {
    const [ligneCalculee] = agregerBruts([
      brut({ visitor_key: "a" }),
      brut({ visitor_key: "a" }),
      brut({ visitor_key: "b" }),
      brut({ visitor_key: "b", kind: "cta" }),
    ]);

    assert.equal(ligneCalculee.pageviews, 3);
    assert.equal(ligneCalculee.visitors, 2);
    assert.equal(ligneCalculee.cta_clicks, 1);
  });

  it("17. chaque canal a sa ligne", () => {
    const lignes = agregerBruts([
      brut({ channel_bucket: "canal", channel_id: "google" }),
      brut({ channel_bucket: "canal", channel_id: "meta", visitor_key: "b" }),
      brut({ channel_bucket: "referent", visitor_key: "c" }),
    ]);
    assert.equal(lignes.length, 3);
  });

  it("18. une visite de 23 h 50 à Paris reste dans sa journée", () => {
    // 2026-08-30 21:50 UTC = 23:50 à Paris. 22:10 UTC = le lendemain 00:10.
    const lignes = agregerBruts([
      brut({ occurred_at: "2026-08-30T21:50:00Z" }),
      brut({ occurred_at: "2026-08-30T22:10:00Z", visitor_key: "b" }),
    ]);
    assert.deepEqual(lignes.map((l) => l.day).sort(), ["2026-08-30", "2026-08-31"]);
  });
});

describe("mesurer", () => {
  const periode = periodeDemandee("2026-08-01", "2026-08-03");

  it("19. les totaux additionnent tous les canaux", () => {
    const mesure = mesurer(
      [
        ligne("2026-08-01", { visitors: 10, pageviews: 14, cta_clicks: 2 }),
        ligne("2026-08-01", { channel_bucket: "canal", channel_id: "g", visitors: 5, pageviews: 6, cta_clicks: 1 }),
        ligne("2026-08-03", { visitors: 3, pageviews: 3 }),
      ],
      periode,
    );

    assert.equal(mesure.visiteurs, 18);
    assert.equal(mesure.pagesVues, 23);
    assert.equal(mesure.clics, 3);
  });

  it("20. les jours creux sont présents, à zéro", () => {
    const mesure = mesurer([ligne("2026-08-01", { visitors: 4 })], periode);
    assert.deepEqual(mesure.jours.map((j) => j.jour), [
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    assert.equal(mesure.jours[1].visiteurs, 0);
  });

  it("21. ce qui déborde de la période n'est pas compté", () => {
    const mesure = mesurer(
      [ligne("2026-07-31", { visitors: 99 }), ligne("2026-08-02", { visitors: 4 })],
      periode,
    );
    assert.equal(mesure.visiteurs, 4);
  });

  it("22. la répartition par canal est ordonnée du plus visité au moins", () => {
    const mesure = mesurer(
      [
        ligne("2026-08-01", { channel_bucket: "canal", channel_id: "petit", visitors: 2 }),
        ligne("2026-08-01", { channel_bucket: "canal", channel_id: "gros", visitors: 20 }),
        ligne("2026-08-02", { channel_bucket: "canal", channel_id: "gros", visitors: 5 }),
      ],
      periode,
    );

    assert.deepEqual(mesure.parCanal.map((c) => c.cle), ["gros", "petit"]);
    assert.equal(mesure.parCanal[0].visiteurs, 25);
  });

  it("23. les seaux sans canal gardent leur nom", () => {
    const mesure = mesurer(
      [ligne("2026-08-01", { channel_bucket: "referent", visitors: 3 })],
      periode,
    );
    assert.equal(mesure.parCanal[0].cle, "referent");
    assert.equal(mesure.parCanal[0].channelId, null);
  });
});

describe("taux", () => {
  it("24. il s'écrit à la décimale près", () => {
    assert.equal(taux(41, 300), "13,7 %");
    assert.equal(taux(1, 2), "50 %");
  });

  it("25. et il ne divise jamais par rien", () => {
    assert.equal(taux(0, 0), "—");
    assert.equal(taux(5, 0), "—");
  });
});
