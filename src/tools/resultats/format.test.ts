/**
 * Un montant tapé à la main devient une facture. Ces cas-là valent d'être
 * déroulés en une seconde plutôt que découverts sur un relevé contesté.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attributionADire,
  centimesSaisis,
  dateDeVente,
  moisDeLaVente,
  montant,
  nomComplet,
  origineLisible,
  venteEncoreImpossible,
} from "./format.ts";

describe("centimesSaisis — les formes qu'on accepte", () => {
  it("1. un entier", () => {
    assert.equal(centimesSaisis("1200"), 120000);
  });

  it("2. une virgule décimale, comme on écrit en français", () => {
    assert.equal(centimesSaisis("1200,50"), 120050);
    assert.equal(centimesSaisis("0,05"), 5);
  });

  it("3. un point décimal, comme le tape un clavier de téléphone", () => {
    assert.equal(centimesSaisis("1200.50"), 120050);
  });

  it("4. des espaces de milliers, y compris insécables et fines", () => {
    assert.equal(centimesSaisis("1 200"), 120000);
    assert.equal(centimesSaisis("1 200,50"), 120050);
    assert.equal(centimesSaisis("1 200"), 120000);
  });

  it("5. quand les deux séparateurs sont là, la virgule décide", () => {
    assert.equal(centimesSaisis("1.200,50"), 120050);
    assert.equal(centimesSaisis("1.200.000,10"), 120000010);
  });

  it("6. le symbole recopié avec le montant", () => {
    assert.equal(centimesSaisis("1 200 €"), 120000);
  });

  it("7. un centime ne se perd pas en virgule flottante", () => {
    // 12,29 × 100 vaut 1228.9999999999998 sans arrondi.
    assert.equal(centimesSaisis("12,29"), 1229);
    assert.equal(centimesSaisis("1,15"), 115);
    assert.equal(centimesSaisis("8,45"), 845);
  });
});

describe("centimesSaisis — ce qu'on refuse", () => {
  it("8. rien, ou des espaces", () => {
    assert.equal(centimesSaisis(""), null);
    assert.equal(centimesSaisis("   "), null);
    assert.equal(centimesSaisis(null), null);
    assert.equal(centimesSaisis(undefined), null);
  });

  it("9. ce qui n'est pas un nombre", () => {
    assert.equal(centimesSaisis("mille deux cents"), null);
    assert.equal(centimesSaisis("1200x"), null);
    assert.equal(centimesSaisis("--12"), null);
  });

  it("10. un montant négatif : une vente ne retire pas d'argent", () => {
    assert.equal(centimesSaisis("-1200"), null);
  });

  it("11. plus de deux décimales : personne ne facture des millièmes", () => {
    assert.equal(centimesSaisis("12,345"), null);
  });
});

describe("les dates d'une vente", () => {
  it("12. « 2026-09-03 » se lit « 3 septembre »", () => {
    assert.equal(dateDeVente("2026-09-03"), "3 septembre");
  });

  it("13. le premier du mois ne recule pas la veille", () => {
    // Le piège du fuseau : lu à Paris, « 2026-09-01T00:00Z » est déjà le 1er,
    // mais un décalage négatif le ramènerait au 31 août.
    assert.equal(dateDeVente("2026-09-01"), "1 septembre");
    assert.equal(moisDeLaVente("2026-09-01"), "2026-09-01");
  });

  it("14. le mois d'une vente est celui de sa date", () => {
    assert.equal(moisDeLaVente("2026-09-30"), "2026-09-01");
    assert.equal(moisDeLaVente("2026-12-31"), "2026-12-01");
  });
});

describe("montant — le cache ne décide pas des centimes", () => {
  /*
   * Le défaut qu'ils fixent : le formateur était mis en cache sur la seule
   * devise, alors que ses options dépendent du montant. Le premier appel d'une
   * instance décidait donc du format de tous les suivants — « 90 € » d'abord,
   * et une vente de 2 450,50 € s'affichait « 2 451 € ».
   *
   * L'ordre des appels fait tout : ces deux tests seraient verts, séparément,
   * avec le code fautif.
   */
  /*
   * Les espaces d'`Intl` sont insécables et invisibles à la relecture : fine
   * (U+202F) entre les milliers, normale (U+00A0) devant le symbole. Écrites
   * en échappement, elles ne se perdent pas dans un copier-coller.
   */
  const MILLIERS = " ";
  const AVANT_SYMBOLE = " ";
  const eur = (texte: string) => `${texte}${AVANT_SYMBOLE}€`;

  it("17. un montant rond n'affiche pas de centimes, un autre si", () => {
    assert.equal(montant(9000), eur("90"));
    assert.equal(montant(245050), eur(`2${MILLIERS}450,50`));
  });

  it("18. … et l'inverse, après un montant à centimes", () => {
    assert.equal(montant(245050), eur(`2${MILLIERS}450,50`));
    assert.equal(montant(9000), eur("90"));
    assert.equal(montant(120000), eur(`1${MILLIERS}200`));
  });

  it("19. aucun centime ne disparaît d'un écran de commission", () => {
    assert.equal(montant(1), eur("0,01"));
    assert.equal(montant(99), eur("0,99"));
    assert.equal(montant(0), eur("0"));
  });
});

describe("nomComplet", () => {
  it("15. les deux morceaux, ou celui qui existe", () => {
    assert.equal(nomComplet("Camille", "Dupont"), "Camille Dupont");
    assert.equal(nomComplet("Camille", ""), "Camille");
    assert.equal(nomComplet("", "Dupont"), "Dupont");
  });

  it("16. rien du tout rend null : c'est à l'écran de nommer l'absence", () => {
    assert.equal(nomComplet("", ""), null);
    assert.equal(nomComplet(null, undefined), null);
    assert.equal(nomComplet("  ", " "), null);
  });
});

describe("l'attribution écrite à côté du canal", () => {
  it("20. elle se tait quand elle répète le badge", () => {
    // « Direct · direct » : le même mot deux fois, en deux graphies.
    assert.equal(attributionADire("direct", "Direct"), null);
  });

  it("21. la casse et les accents ne font pas deux informations", () => {
    assert.equal(attributionADire("recurrence", "Récurrence"), null);
    assert.equal(attributionADire("direct", "DIRECT"), null);
    assert.equal(attributionADire("direct", "  direct  "), null);
  });

  it("22. elle parle quand elle ajoute quelque chose", () => {
    assert.equal(attributionADire("utm", "Google Ads"), "campagne");
    assert.equal(attributionADire("recurrence", "Google Ads"), "récurrence");
    assert.equal(attributionADire("manuel", "Direct"), "corrigé par Louis");
  });

  it("23. sans canal, elle parle : il n'y a rien qu'elle puisse répéter", () => {
    assert.equal(attributionADire("direct", null), "direct");
    assert.equal(attributionADire("direct", undefined), "direct");
  });
});

describe("quand une vente peut être déclarée", () => {
  const jourParis = (decalageJours: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
      new Date(Date.now() + decalageJours * 86_400_000),
    );

  it("24. pas avant le jour de la séance", () => {
    assert.equal(venteEncoreImpossible(`${jourParis(1)}T10:00:00+02:00`), true);
    assert.equal(venteEncoreImpossible(`${jourParis(30)}T10:00:00+02:00`), true);
  });

  it("25. le jour même, oui : la base l'autorise déjà", () => {
    // La borne est le jour, pas l'heure : une séance de cet après-midi se vend.
    assert.equal(venteEncoreImpossible(`${jourParis(0)}T23:30:00+02:00`), false);
  });

  it("26. et après, évidemment", () => {
    assert.equal(venteEncoreImpossible(`${jourParis(-1)}T10:00:00+02:00`), false);
    assert.equal(venteEncoreImpossible("2026-01-05T10:00:00+01:00"), false);
  });
});

describe("d'où vient un rendez-vous", () => {
  /*
   * C'est la ligne qui rend une commission défendable. Le défaut qu'elle
   * corrige : « via la campagne d'origine » servait pour l'attribution par
   * campagne *et* se confondait avec la récurrence, si bien qu'on ne pouvait
   * ni retrouver la campagne dans Google Ads, ni distinguer les deux raisons.
   */
  const ADS = { label: "Google Ads" };
  const SOURCES = new Map([["rdv-12-mars", "2026-03-12T09:00:00+01:00"]]);

  it("27. utm avec campagne : elle se nomme", () => {
    assert.equal(
      origineLisible(
        { attribution: "utm", utm: { utm_source: "google", utm_campaign: "test-audit" } },
        ADS,
        SOURCES,
      ),
      "Google Ads, campagne test-audit",
    );
  });

  it("28. utm sans campagne : on dit d'où vient l'information", () => {
    const sansCampagne: (Record<string, string> | null | undefined)[] = [
      { utm_source: "google" },
      {},
      undefined,
      null,
    ];

    for (const utm of sansCampagne) {
      assert.equal(
        origineLisible({ attribution: "utm", utm }, ADS, SOURCES),
        "Google Ads, via les paramètres de la visite",
        JSON.stringify(utm),
      );
    }
    // Une campagne vide ou blanche n'est pas une campagne.
    assert.equal(
      origineLisible({ attribution: "utm", utm: { utm_campaign: "   " } }, ADS, SOURCES),
      "Google Ads, via les paramètres de la visite",
    );
  });

  it("29. récurrence : elle se dit « par récurrence », et nomme sa séance", () => {
    assert.equal(
      origineLisible(
        { attribution: "recurrence", attribution_source_id: "rdv-12-mars" },
        ADS,
        SOURCES,
      ),
      "Google Ads, par récurrence : séance du 12/03/2026",
    );
  });

  it("30. récurrence sans séance retrouvée : la formule courte", () => {
    assert.equal(
      origineLisible({ attribution: "recurrence", attribution_source_id: null }, ADS, SOURCES),
      "Google Ads, par récurrence",
    );
    assert.equal(
      origineLisible(
        { attribution: "recurrence", attribution_source_id: "disparu" },
        ADS,
        SOURCES,
      ),
      "Google Ads, par récurrence",
    );
  });

  it("31. les trois cas ne se ressemblent pas", () => {
    const phrases = [
      origineLisible({ attribution: "utm", utm: { utm_campaign: "test-audit" } }, ADS, SOURCES),
      origineLisible({ attribution: "utm", utm: {} }, ADS, SOURCES),
      origineLisible(
        { attribution: "recurrence", attribution_source_id: "rdv-12-mars" },
        ADS,
        SOURCES,
      ),
    ];
    assert.equal(new Set(phrases).size, 3);
    // « la campagne d'origine » ne doit plus apparaître nulle part : c'était
    // elle qui servait pour deux raisons différentes.
    for (const phrase of phrases) {
      assert.equal(phrase.includes("via la campagne d'origine"), false);
    }
  });

  it("32. les deux autres attributions n'ont pas bougé", () => {
    assert.equal(
      origineLisible({ attribution: "manuel", attribution_note: "vu avec elle" }, ADS, SOURCES),
      "Google Ads, corrigé par Louis : vu avec elle",
    );
    assert.equal(
      origineLisible({ attribution: "manuel" }, ADS, SOURCES),
      "Google Ads, corrigé par Louis",
    );
    assert.equal(
      origineLisible({ attribution: "direct" }, ADS, SOURCES),
      "Google Ads : aucune campagne, aucune séance récente",
    );
  });

  it("33. sans canal, la phrase tient quand même", () => {
    assert.equal(
      origineLisible({ attribution: "utm", utm: { utm_campaign: "test-audit" } }, null, SOURCES),
      "Sans canal, campagne test-audit",
    );
  });
});
