/**
 * `public/radar.js`, éprouvé hors du navigateur.
 *
 * Ce script décide de l'attribution de chaque visiteur d'une landing : c'est
 * lui qui fait la différence entre une réservation comptée « Google Ads » et
 * une réservation comptée « Direct ». Il tourne chez le client, on ne le voit
 * pas échouer, et une erreur ici se traduit en euros manquants sur un relevé.
 *
 * On le charge dans un environnement minimal — un faux `window`, un faux
 * `document` — et on regarde ce qu'il fait des liens.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createContext, runInNewContext } from "node:vm";

const SOURCE = readFileSync(
  new URL("../../../public/radar.js", import.meta.url),
  "utf8",
);

type Lien = {
  getAttribute: (nom: string) => string | null;
  setAttribute: (nom: string, valeur: string) => void;
  closest: (selecteur: string) => Lien | null;
  href: string;
};

type Faussette = {
  clic: (href: string) => string;
  popup: (url: string) => string;
  stockage: Record<string, string>;
};

/** Un lien cliquable, réduit à ce que le script en demande. */
function lien(href: string): Lien {
  const element: Lien = {
    href,
    getAttribute: (nom) => (nom === "href" ? element.href : null),
    setAttribute: (nom, valeur) => {
      if (nom === "href") element.href = valeur;
    },
    closest: () => element,
  };
  return element;
}

function charger({
  recherche = "",
  stockage = {},
  stockageCasse = false,
}: {
  recherche?: string;
  stockage?: Record<string, string>;
  stockageCasse?: boolean;
} = {}): Faussette {
  const memoire: Record<string, string> = { ...stockage };
  let auClic: ((evenement: { target: Lien }) => void) | null = null;

  const document = {
    addEventListener: (type: string, ecouteur: unknown) => {
      if (type === "click") auClic = ecouteur as typeof auClic;
    },
    // Cette landing de test n'embarque pas de widget : les liens suffisent.
    querySelectorAll: () => [],
    documentElement: {},
  };

  const calendly: Record<string, unknown> = {
    initPopupWidget: (options: { url: string }) => {
      calendly.__derniereUrl = options.url;
    },
  };

  const window = {
    location: {
      search: recherche,
      href: `https://praticienne.fr/${recherche}`,
    },
    sessionStorage: {
      getItem: (cle: string) => {
        if (stockageCasse) throw new Error("stockage refusé");
        return memoire[cle] ?? null;
      },
      setItem: (cle: string, valeur: string) => {
        if (stockageCasse) throw new Error("stockage refusé");
        memoire[cle] = valeur;
      },
    },
    addEventListener: () => {},
    Calendly: calendly,
    // Volontairement absent : la landing de test ne monte rien après coup.
    MutationObserver: undefined,
  };

  const contexte = createContext({ window, document, URL, URLSearchParams, console });
  (contexte as { globalThis?: unknown }).globalThis = contexte;
  runInNewContext(SOURCE, contexte);

  return {
    stockage: memoire,
    clic: (href) => {
      const cible = lien(href);
      if (auClic) auClic({ target: cible });
      return cible.href;
    },
    popup: (url) => {
      (calendly.initPopupWidget as (o: { url: string }) => void)({ url });
      return String(calendly.__derniereUrl);
    },
  };
}

const CALENDLY = "https://calendly.com/praticienne/seance";

describe("ce que radar.js retient de l'arrivée", () => {
  it("1. les utm d'une campagne sont rajoutés au lien Calendly", () => {
    const page = charger({ recherche: "?utm_source=google&utm_medium=cpc" });
    const href = page.clic(CALENDLY);
    assert.match(href, /utm_source=google/);
    assert.match(href, /utm_medium=cpc/);
  });

  it("2. un gclid seul devient une campagne Google Ads", () => {
    // Calendly ne relaie que les utm_* : sans cette traduction, un clic
    // d'annonce arriverait dans Radar comme une visite directe.
    const page = charger({ recherche: "?gclid=Cj0KCQiA" });
    const href = page.clic(CALENDLY);
    assert.match(href, /gclid=Cj0KCQiA/);
    assert.match(href, /utm_source=google/);
    assert.match(href, /utm_medium=cpc/);
  });

  it("3. un fbclid seul devient une campagne Meta", () => {
    const page = charger({ recherche: "?fbclid=IwAR123" });
    const href = page.clic(CALENDLY);
    assert.match(href, /utm_source=facebook/);
    assert.match(href, /utm_medium=paid/);
  });

  it("4. une campagne taguée n'est jamais écrasée par un identifiant de clic", () => {
    const page = charger({ recherche: "?gclid=Cj0K&utm_source=newsletter&utm_medium=email" });
    const href = page.clic(CALENDLY);
    assert.match(href, /utm_source=newsletter/);
    assert.match(href, /utm_medium=email/);
    assert.doesNotMatch(href, /utm_source=google/);
  });

  it("5. le premier contact de la visite l'emporte", () => {
    // Arrivée par Instagram, puis retour par une adresse Google dans le même
    // onglet : c'est Instagram qui a amené la personne.
    const page = charger({
      recherche: "?utm_source=google&utm_medium=cpc",
      stockage: {
        "comete:radar:utm": JSON.stringify({ utm_source: "instagram", utm_medium: "paid" }),
      },
    });
    const href = page.clic(CALENDLY);
    assert.match(href, /utm_source=instagram/);
    assert.doesNotMatch(href, /utm_source=google/);
  });

  it("6. sans campagne, rien n'est ajouté nulle part", () => {
    const page = charger({ recherche: "" });
    assert.equal(page.clic(CALENDLY), CALENDLY);
  });

  it("7. un paramètre vide ne fait pas une campagne", () => {
    const page = charger({ recherche: "?utm_source=" });
    assert.equal(page.clic(CALENDLY), CALENDLY);
  });
});

describe("ce qu'il touche, et ce qu'il ne touche pas", () => {
  it("8. un lien qui ne va pas chez Calendly est laissé tel quel", () => {
    const page = charger({ recherche: "?utm_source=google&utm_medium=cpc" });
    assert.equal(page.clic("https://praticienne.fr/tarifs"), "https://praticienne.fr/tarifs");
    assert.equal(page.clic("mailto:bonjour@praticienne.fr"), "mailto:bonjour@praticienne.fr");
  });

  it("9. un faux domaine qui contient « calendly.com » n'est pas du Calendly", () => {
    const page = charger({ recherche: "?utm_source=google&utm_medium=cpc" });
    const piege = "https://calendly.com.exemple.net/prendre-rdv";
    assert.equal(page.clic(piege), piege);
  });

  it("10. un sous-domaine de calendly.com, si", () => {
    const page = charger({ recherche: "?utm_source=google&utm_medium=cpc" });
    assert.match(page.clic("https://eu.calendly.com/praticienne"), /utm_source=google/);
  });

  it("11. un paramètre déjà présent dans le lien n'est pas remplacé", () => {
    // Le client a tagué son lien à la main : c'est lui qui sait.
    const page = charger({ recherche: "?utm_source=google&utm_medium=cpc" });
    const href = page.clic(`${CALENDLY}?utm_source=partenaire`);
    assert.match(href, /utm_source=partenaire/);
    assert.doesNotMatch(href, /utm_source=google/);
    assert.match(href, /utm_medium=cpc/);
  });

  it("12. la fenêtre Calendly reçoit l'adresse enrichie", () => {
    const page = charger({ recherche: "?utm_source=instagram&utm_medium=paid" });
    assert.match(page.popup(CALENDLY), /utm_source=instagram/);
  });

  it("13. un stockage refusé ne casse pas la page", () => {
    // Navigation privée, réglages restrictifs : la visite perd son attribution,
    // elle ne perd pas son bouton de réservation.
    const page = charger({ recherche: "?utm_source=google", stockageCasse: true });
    assert.doesNotThrow(() => page.clic(CALENDLY));
  });
});
