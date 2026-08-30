/**
 * `public/sonde.js`, éprouvé hors du navigateur.
 *
 *   npm run test
 *
 * Ce script tourne chez le client, sur une page qu'on ne voit pas. On ne le
 * verra jamais échouer : s'il compte deux fois, le taux de clic est faux et
 * personne ne s'en aperçoit ; s'il lève, c'est une ligne rouge dans la console
 * d'un thérapeute qui n'a rien demandé.
 *
 * Comme pour `radar.js`, on le charge dans un environnement minimal — un faux
 * `window`, un faux `document` — et on regarde ce qu'il envoie.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createContext, runInNewContext } from "node:vm";
import { brotliCompressSync, gzipSync } from "node:zlib";

const CHEMIN = new URL("../../../public/sonde.js", import.meta.url);
const SOURCE = readFileSync(CHEMIN, "utf8");
const RADAR = readFileSync(new URL("../../../public/radar.js", import.meta.url), "utf8");

type Envoi = { url: string; corps: Record<string, unknown>; par: "beacon" | "fetch" };

type Element = {
  closest: (selecteur: string) => Element | null;
  getAttribute: (nom: string) => string | null;
};

type Faussette = {
  envois: Envoi[];
  clic: (element: Element) => void;
  popup: (url: string) => void;
  retourArriere: () => void;
  calendly: Record<string, unknown>;
};

/** Un lien, réduit à ce que le script lui demande. */
function lien(href: string): Element {
  const element: Element = {
    getAttribute: (nom) => (nom === "href" ? href : null),
    closest: (selecteur) => (selecteur === "a[href]" ? element : null),
  };
  return element;
}

/** Un bouton marqué à la main, qui n'est pas un lien. */
function repere(): Element {
  const element: Element = {
    getAttribute: () => null,
    closest: (selecteur) => (selecteur === '[data-sonde="cta"]' ? element : null),
  };
  return element;
}

function charger({
  jeton = "abc123",
  recherche = "",
  chemin = "/tarifs",
  referrer = "",
  beacon = "ok",
  avecRadar = null,
}: {
  jeton?: string | null;
  recherche?: string;
  chemin?: string;
  referrer?: string;
  /** `ok` accepte, `plein` rend false, `casse` lève, `absent` n'existe pas. */
  beacon?: "ok" | "plein" | "casse" | "absent";
  /** `avant` ou `apres` : l'ordre de chargement de radar.js sur la page. */
  avecRadar?: "avant" | "apres" | null;
} = {}): Faussette {
  const envois: Envoi[] = [];
  let auClic: ((evenement: { target: Element }) => void) | null = null;
  let auPageshow: ((evenement: { persisted: boolean }) => void) | null = null;

  const balise = {
    src: "https://cometestudio.fr/sonde.js",
    getAttribute: (nom: string) => (nom === "data-site" ? jeton : null),
  };

  const document = {
    currentScript: jeton === null ? null : balise,
    referrer,
    addEventListener: (type: string, ecouteur: unknown) => {
      if (type === "click") auClic = ecouteur as typeof auClic;
    },
    querySelectorAll: () => [] as unknown[],
    documentElement: {},
  };

  const calendly: Record<string, unknown> = {
    initPopupWidget: (options: { url: string }) => {
      calendly.__ouvert = options.url;
    },
    initInlineWidget: (options: { url: string }) => {
      calendly.__embarque = options.url;
    },
  };

  const noter = (par: Envoi["par"]) => (url: string, corps: string) => {
    envois.push({ url, corps: JSON.parse(corps), par });
  };

  const window = {
    location: { search: recherche, pathname: chemin, href: `https://praticienne.fr${chemin}${recherche}` },
    navigator:
      beacon === "absent"
        ? {}
        : {
            sendBeacon: (url: string, corps: string) => {
              if (beacon === "casse") throw new Error("beacon refusé");
              if (beacon === "plein") return false;
              noter("beacon")(url, corps);
              return true;
            },
          },
    fetch: (url: string, options: { body: string }) => {
      noter("fetch")(url, options.body);
      return { catch: () => undefined };
    },
    addEventListener: (type: string, ecouteur: unknown) => {
      if (type === "pageshow") auPageshow = ecouteur as typeof auPageshow;
    },
    // La page de test ne monte rien après coup ; l'observateur n'a rien à voir.
    MutationObserver: undefined,
    Calendly: calendly,
    // `sessionStorage` pour radar.js, quand les deux scripts cohabitent.
    sessionStorage: {
      getItem: () => null,
      setItem: () => undefined,
    },
  };

  const contexte = createContext({ window, document, URL, URLSearchParams, JSON, console });
  (contexte as { globalThis?: unknown }).globalThis = contexte;

  if (avecRadar === "avant") runInNewContext(RADAR, contexte);
  runInNewContext(SOURCE, contexte);
  if (avecRadar === "apres") runInNewContext(RADAR, contexte);

  return {
    envois,
    calendly,
    clic: (element) => auClic?.({ target: element }),
    popup: (url) => (calendly.initPopupWidget as (o: { url: string }) => void)({ url }),
    retourArriere: () => auPageshow?.({ persisted: true }),
  };
}

const CALENDLY = "https://calendly.com/praticienne/seance";

describe("sonde.js — la page vue", () => {
  it("1. une page vue part au chargement, et une seule", () => {
    const page = charger();
    assert.equal(page.envois.length, 1);
    assert.equal(page.envois[0].corps.e, "pageview");
  });

  it("2. sans jeton, le script ne fait rien du tout", () => {
    const page = charger({ jeton: null });
    assert.equal(page.envois.length, 0);
    // Et il ne s'accroche à rien : un clic ne réveille personne.
    page.clic(lien(CALENDLY));
    assert.equal(page.envois.length, 0);
  });

  it("3. un jeton vide vaut pas de jeton", () => {
    assert.equal(charger({ jeton: "" }).envois.length, 0);
  });

  it("4. l'envoi part au point de collecte du site", () => {
    const page = charger({ jeton: "jeton-du-site" });
    assert.equal(
      page.envois[0].url,
      "https://cometestudio.fr/api/sonde/jeton-du-site",
    );
  });
});

describe("sonde.js — ce qu'il envoie, et ce qu'il tait", () => {
  it("5. le chemin part, la query string ne part pas", () => {
    const page = charger({
      chemin: "/merci",
      recherche: "?email=louis@exemple.fr&utm_source=google",
    });
    assert.equal(page.envois[0].corps.p, "/merci");
    assert.equal(JSON.stringify(page.envois[0].corps).includes("louis@exemple.fr"), false);
  });

  it("6. seuls les paramètres de campagne sont retenus", () => {
    const page = charger({
      recherche: "?utm_source=google&utm_medium=cpc&gclid=abc&ref=infolettre&vide=",
    });
    assert.deepEqual(page.envois[0].corps.u, {
      utm_source: "google",
      utm_medium: "cpc",
      gclid: "abc",
    });
  });

  it("7. un paramètre nommé comme une propriété héritée ne passe pas", () => {
    // Sans `hasOwnProperty`, `constructor` serait pris pour une régie.
    const page = charger({ recherche: "?constructor=1&toString=2" });
    assert.deepEqual(page.envois[0].corps.u, {});
  });

  it("8. le référent est réduit à son hôte", () => {
    const page = charger({ referrer: "https://www.google.fr/search?q=therapeute+lyon" });
    assert.equal(page.envois[0].corps.r, "www.google.fr");
    assert.equal(JSON.stringify(page.envois[0].corps).includes("therapeute"), false);
  });

  it("9. sans référent, le champ est nul plutôt qu'inventé", () => {
    assert.equal(charger().envois[0].corps.r, null);
  });

  it("10. l'enveloppe ne porte que les quatre champs attendus", () => {
    const page = charger({ recherche: "?utm_source=google", referrer: "https://x.com/" });
    assert.deepEqual(Object.keys(page.envois[0].corps).sort(), ["e", "p", "r", "u"]);
  });
});

describe("sonde.js — le clic vers Calendly", () => {
  it("11. un clic sur un lien Calendly compte", () => {
    const page = charger();
    page.clic(lien(CALENDLY));
    assert.equal(page.envois.length, 2);
    assert.equal(page.envois[1].corps.e, "cta");
  });

  it("12. deux clics n'en font qu'un", () => {
    const page = charger();
    page.clic(lien(CALENDLY));
    page.clic(lien(CALENDLY));
    page.clic(lien(CALENDLY));
    assert.equal(page.envois.filter((envoi) => envoi.corps.e === "cta").length, 1);
  });

  it("13. un lien qui ne mène pas chez Calendly ne compte pas", () => {
    const page = charger();
    page.clic(lien("https://praticienne.fr/tarifs"));
    page.clic(lien("https://calendly.com.attaquant.test/piege"));
    assert.equal(page.envois.length, 1);
  });

  it("14. un sous-domaine de Calendly compte", () => {
    const page = charger();
    page.clic(lien("https://meetings.calendly.com/praticienne"));
    assert.equal(page.envois.length, 2);
  });

  it("15. un élément marqué `data-sonde=\"cta\"` compte, même sans lien", () => {
    const page = charger();
    page.clic(repere());
    assert.equal(page.envois[1]?.corps.e, "cta");
  });

  it("16. l'ouverture d'une fenêtre Calendly compte", () => {
    const page = charger();
    page.popup(CALENDLY);
    assert.equal(page.envois[1]?.corps.e, "cta");
  });

  it("17. et la fenêtre s'ouvre quand même : on enveloppe, on ne remplace pas", () => {
    const page = charger();
    page.popup(CALENDLY);
    assert.equal(page.calendly.__ouvert, CALENDLY);
  });

  it("18. un agenda embarqué qui s'initialise n'est pas un clic", () => {
    // Sans cette réserve, toute landing à agenda embarqué afficherait un taux
    // de clic de cent pour cent.
    const page = charger();
    (page.calendly.initInlineWidget as (o: { url: string }) => void)({ url: CALENDLY });
    assert.equal(page.envois.length, 1);
  });
});

describe("sonde.js — l'envoi et ses replis", () => {
  it("19. `sendBeacon` d'abord", () => {
    assert.equal(charger().envois[0].par, "beacon");
  });

  it("20. sa file pleine fait retomber sur fetch", () => {
    const page = charger({ beacon: "plein" });
    assert.equal(page.envois.length, 1);
    assert.equal(page.envois[0].par, "fetch");
  });

  it("21. un `sendBeacon` qui lève aussi", () => {
    const page = charger({ beacon: "casse" });
    assert.equal(page.envois[0].par, "fetch");
  });

  it("22. un navigateur sans `sendBeacon` aussi", () => {
    assert.equal(charger({ beacon: "absent" }).envois[0].par, "fetch");
  });
});

describe("sonde.js — le retour par le bouton précédent", () => {
  it("23. une page ressortie du cache compte une nouvelle vue", () => {
    const page = charger();
    page.retourArriere();
    assert.equal(page.envois.filter((envoi) => envoi.corps.e === "pageview").length, 2);
  });

  it("24. et le clic redevient possible", () => {
    const page = charger();
    page.clic(lien(CALENDLY));
    page.retourArriere();
    page.clic(lien(CALENDLY));
    assert.equal(page.envois.filter((envoi) => envoi.corps.e === "cta").length, 2);
  });
});

describe("sonde.js — la cohabitation avec radar.js", () => {
  for (const ordre of ["avant", "apres"] as const) {
    it(`${ordre === "avant" ? "25" : "26"}. radar.js chargé ${ordre} : les deux font leur travail`, () => {
      const page = charger({
        avecRadar: ordre,
        recherche: "?utm_source=google&utm_medium=cpc",
      });

      // Sonde compte le clic…
      page.popup(CALENDLY);
      assert.equal(page.envois[1]?.corps.e, "cta", "Sonde n'a pas compté le clic");

      // …et Radar a bien enrichi l'adresse au passage.
      assert.match(
        String(page.calendly.__ouvert),
        /utm_source=google/,
        "Radar n'a pas enrichi l'adresse",
      );
    });
  }

  it("27. chacun marque son passage sans effacer celui de l'autre", () => {
    const page = charger({ avecRadar: "avant", recherche: "?utm_source=google" });
    assert.equal(page.calendly.__sonde, true);
    assert.equal(page.calendly.__radar, true);
  });
});

describe("sonde.js — ce qu'il pèse", () => {
  it("28. moins de 3 Ko livrés", () => {
    /*
     * Le budget du brief porte sur ce qui part sur le fil, pas sur le fichier :
     * Vercel compresse les fichiers de `public/`. On mesure en gzip, le moins
     * favorable des deux — les navigateurs modernes reçoivent du brotli, plus
     * petit encore.
     *
     * Ce test est une limite de dépense autant qu'une vérification. Le
     * dépasser, c'est le moment de se demander si le commentaire qu'on vient
     * d'ajouter mérite d'être lu par chaque visiteur de chaque landing.
     */
    const brut = SOURCE.length;
    const gzip = gzipSync(SOURCE).length;
    const brotli = brotliCompressSync(SOURCE).length;

    assert.ok(
      gzip <= 3072,
      `${brut} octets bruts, ${gzip} en gzip, ${brotli} en brotli`,
    );
  });
});
