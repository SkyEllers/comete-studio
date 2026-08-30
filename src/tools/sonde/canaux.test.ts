/**
 * D'où vient une visite, et ce que la route refuse d'écrire.
 *
 *   npm run test
 *
 * Deux fichiers en un, parce que ce sont les deux moitiés d'une même
 * question : ce qui entre, et sous quelle étiquette. La résolution de canal
 * doit rendre exactement ce que rend Radar sur les mêmes entrées — sinon
 * l'entonnoir du chantier 5 comparera quarante clics d'un canal à neuf
 * réservations d'un autre. Les défenses, elles, décident de ce qui n'entre
 * pas ; les éprouver à travers la route demanderait un serveur et une base,
 * alors qu'elles se déroulent ici en une seconde.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CANAUX_PAR_DEFAUT, type Canal } from "../resultats/attribution.ts";
import { estMoteurDeRecherche, reseauSocial, resoudreCanal } from "./canaux.ts";
import {
  chemin,
  cleVisiteur,
  corpsSchema,
  creerLimiteur,
  estRobot,
  hote,
  hoteAutorise,
  utmRetenus,
} from "./collecte.ts";

/** Les canaux d'un client, dotés d'identifiants lisibles. */
const CANAUX: Canal[] = CANAUX_PAR_DEFAUT.map((canal) => ({
  ...canal,
  id: `id-${canal.key}`,
  is_active: true,
}));

const resoudre = (
  utm: Record<string, string>,
  referrerHost: string | null = null,
  canaux: Canal[] = CANAUX,
) => resoudreCanal({ utm, referrerHost, canaux });

describe("resoudreCanal — la campagne d'abord", () => {
  it("1. google/cpc va dans Google Ads, pas dans SEO", () => {
    assert.deepEqual(resoudre({ utm_source: "google", utm_medium: "cpc" }), {
      channel_id: "id-google_ads",
      channel_bucket: "canal",
    });
  });

  it("2. google/organic va dans SEO, malgré l'ordre des canaux", () => {
    assert.deepEqual(resoudre({ utm_source: "google", utm_medium: "organic" }), {
      channel_id: "id-seo",
      channel_bucket: "canal",
    });
  });

  it("3. un gclid seul suffit", () => {
    assert.equal(resoudre({ gclid: "abc" }).channel_id, "id-google_ads");
  });

  it("4. instagram va dans Meta", () => {
    assert.equal(resoudre({ utm_source: "instagram" }).channel_id, "id-meta");
  });

  it("5. une campagne qu'aucun canal ne reconnaît tombe dans « Autre »", () => {
    assert.deepEqual(resoudre({ utm_source: "salon-du-bien-etre" }), {
      channel_id: "id-autre",
      channel_bucket: "canal",
    });
  });

  it("6. la campagne l'emporte sur le référent", () => {
    // Quelqu'un clique une annonce depuis une recherche Google : c'est
    // l'annonce qui a été payée, pas le référencement.
    assert.equal(
      resoudre({ utm_source: "google", utm_medium: "cpc" }, "www.google.fr").channel_id,
      "id-google_ads",
    );
  });
});

describe("resoudreCanal — le référent, à défaut", () => {
  it("7. une recherche Google va dans SEO", () => {
    assert.deepEqual(resoudre({}, "www.google.fr"), {
      channel_id: "id-seo",
      channel_bucket: "canal",
    });
  });

  it("8. Bing et DuckDuckGo aussi : c'est le canal « organic » qui les prend", () => {
    assert.equal(resoudre({}, "www.bing.com").channel_id, "id-seo");
    assert.equal(resoudre({}, "duckduckgo.com").channel_id, "id-seo");
    assert.equal(resoudre({}, "search.brave.com").channel_id, "id-seo");
  });

  it("9. Instagram et Facebook vont dans Meta", () => {
    assert.equal(resoudre({}, "l.instagram.com").channel_id, "id-meta");
    assert.equal(resoudre({}, "m.facebook.com").channel_id, "id-meta");
  });

  it("10. un réseau qu'aucun canal ne nomme reste un référent", () => {
    // LinkedIn n'est dans les sources d'aucun canal par défaut.
    assert.deepEqual(resoudre({}, "www.linkedin.com"), {
      channel_id: null,
      channel_bucket: "referent",
    });
  });

  it("11. un site quelconque reste un référent, avec son hôte à afficher", () => {
    assert.deepEqual(resoudre({}, "annuaire-therapeutes.fr"), {
      channel_id: null,
      channel_bucket: "referent",
    });
  });

  it("12. sans campagne ni référent, c'est Direct", () => {
    assert.deepEqual(resoudre({}), {
      channel_id: "id-direct",
      channel_bucket: "direct",
    });
  });

  it("13. un client sans canal « organic » range les moteurs en référent", () => {
    const sansSeo = CANAUX.filter((canal) => canal.key !== "seo");
    assert.deepEqual(resoudre({}, "www.google.fr", sansSeo), {
      channel_id: null,
      channel_bucket: "referent",
    });
  });

  it("14. un canal désactivé n'attrape plus rien", () => {
    const seoEteint = CANAUX.map((canal) =>
      canal.key === "seo" ? { ...canal, is_active: false } : canal,
    );
    assert.equal(resoudre({}, "www.google.fr", seoEteint).channel_bucket, "referent");
  });
});

describe("estMoteurDeRecherche et reseauSocial", () => {
  it("15. les moteurs se reconnaissent, sous-domaines et TLD compris", () => {
    for (const h of ["google.com", "www.google.fr", "google.co.uk", "fr.search.yahoo.com"]) {
      assert.equal(estMoteurDeRecherche(h), true, h);
    }
  });

  it("16. et un domaine qui leur ressemble ne passe pas", () => {
    for (const h of ["google.com.attaquant.test", "notgoogle.fr", "monsite.fr"]) {
      assert.equal(estMoteurDeRecherche(h), false, h);
    }
  });

  it("17. les réseaux rendent la source qu'ils désignent", () => {
    assert.equal(reseauSocial("t.co"), "twitter");
    assert.equal(reseauSocial("www.threads.net"), "instagram");
    assert.equal(reseauSocial("youtu.be"), "youtube");
    assert.equal(reseauSocial("annuaire.fr"), null);
  });
});

describe("estRobot", () => {
  it("18. un user-agent absent n'est pas quelqu'un", () => {
    assert.equal(estRobot(null), true);
    assert.equal(estRobot(""), true);
  });

  it("19. les signatures connues sont écartées", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "Mozilla/5.0 AhrefsBot",
      "HeadlessChrome/120",
      "Chrome-Lighthouse",
      "Pingdom.com_bot",
      "facebookexternalhit preview",
    ]) {
      assert.equal(estRobot(ua), true, ua);
    }
  });

  it("20. un vrai navigateur passe", () => {
    assert.equal(
      estRobot(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      ),
      false,
    );
  });
});

describe("hote et hoteAutorise", () => {
  it("21. l'hôte se lit avec ou sans protocole, sans port, en minuscules", () => {
    assert.equal(hote("https://WWW.Exemple.FR/page?a=1"), "www.exemple.fr");
    assert.equal(hote("exemple.fr"), "exemple.fr");
    assert.equal(hote("https://exemple.fr:8443/"), "exemple.fr");
    assert.equal(hote(""), null);
    assert.equal(hote(null), null);
  });

  it("22. un sous-domaine du domaine déclaré est admis", () => {
    assert.equal(hoteAutorise("www.jonathan.com", ["jonathan.com"]), true);
    assert.equal(hoteAutorise("rdv.jonathan.com", ["jonathan.com"]), true);
    assert.equal(hoteAutorise("jonathan.com", ["jonathan.com"]), true);
  });

  it("23. un domaine qui se contente de finir pareil ne l'est pas", () => {
    assert.equal(hoteAutorise("jonathan.com.attaquant.test", ["jonathan.com"]), false);
    assert.equal(hoteAutorise("pasjonathan.com", ["jonathan.com"]), false);
    assert.equal(hoteAutorise("jonathan.com", []), false);
    assert.equal(hoteAutorise(null, ["jonathan.com"]), false);
  });
});

describe("corpsSchema — l'enveloppe est stricte", () => {
  it("24. le corps attendu passe", () => {
    const resultat = corpsSchema.safeParse({
      e: "pageview",
      p: "/tarifs",
      r: "google.fr",
      u: { utm_source: "google" },
    });
    assert.equal(resultat.success, true);
  });

  it("25. un champ en trop fait tout rejeter", () => {
    assert.equal(
      corpsSchema.safeParse({ e: "pageview", visiteur: "Louis" }).success,
      false,
    );
  });

  it("26. un événement inconnu aussi", () => {
    assert.equal(corpsSchema.safeParse({ e: "scroll" }).success, false);
    assert.equal(corpsSchema.safeParse({}).success, false);
  });

  it("27. mais le contenu de `u` reste filtré, pas rejeté", () => {
    assert.deepEqual(
      utmRetenus({ utm_source: "google", gclid: "abc", ref: "newsletter", n: 3 }),
      { utm_source: "google", gclid: "abc" },
    );
    assert.deepEqual(utmRetenus(undefined), {});
    assert.deepEqual(utmRetenus("pas un objet"), {});
  });
});

describe("chemin", () => {
  it("28. la query string et le fragment ne rentrent pas", () => {
    assert.equal(chemin("/merci?email=louis@exemple.fr"), "/merci");
    assert.equal(chemin("/page#section"), "/page");
    assert.equal(chemin("/page?a=1#b"), "/page");
  });

  it("29. un chemin vide ou relatif devient la racine ou s'y rattache", () => {
    assert.equal(chemin(""), "/");
    assert.equal(chemin(null), "/");
    assert.equal(chemin("tarifs"), "/tarifs");
  });

  it("30. et il est borné", () => {
    assert.equal(chemin(`/${"a".repeat(2000)}`).length, 512);
  });
});

describe("creerLimiteur", () => {
  it("31. il laisse passer jusqu'à la limite, puis refuse", () => {
    const instant = 0;
    const autorise = creerLimiteur({ maximum: 3, fenetreMs: 1000, horloge: () => instant });

    assert.equal(autorise("ip"), true);
    assert.equal(autorise("ip"), true);
    assert.equal(autorise("ip"), true);
    assert.equal(autorise("ip"), false);
  });

  it("32. la fenêtre glisse : une minute plus tard, on repart", () => {
    let instant = 0;
    const autorise = creerLimiteur({ maximum: 2, fenetreMs: 1000, horloge: () => instant });

    autorise("ip");
    autorise("ip");
    assert.equal(autorise("ip"), false);

    instant = 1001;
    assert.equal(autorise("ip"), true);
  });

  it("33. deux adresses ne se gênent pas", () => {
    const instant = 0;
    const autorise = creerLimiteur({ maximum: 1, fenetreMs: 1000, horloge: () => instant });

    assert.equal(autorise("a"), true);
    assert.equal(autorise("b"), true);
    assert.equal(autorise("a"), false);
  });

  it("34. la table se vide plutôt que d'enfler sans fin", () => {
    const instant = 0;
    const autorise = creerLimiteur({ maximum: 1, fenetreMs: 1000, cles: 2, horloge: () => instant });

    autorise("a");
    autorise("b");
    autorise("c");
    // Le seuil est franchi : la table repart de zéro, et « a » repasse.
    assert.equal(autorise("a"), true);
  });
});

describe("cleVisiteur — la promesse centrale de Sonde", () => {
  const SEL_HIER = "a".repeat(64);
  const SEL_AUJOURD_HUI = "b".repeat(64);
  const SITE = "site-1";
  const IP = "82.64.10.7";
  const UA = "Mozilla/5.0 (iPhone) Safari/604.1";

  it("35. le même navigateur, le même jour, donne la même clé", () => {
    assert.equal(
      cleVisiteur(SEL_AUJOURD_HUI, SITE, IP, UA),
      cleVisiteur(SEL_AUJOURD_HUI, SITE, IP, UA),
    );
  });

  it("36. et à deux jours de sel différents, deux clés distinctes", () => {
    // C'est ce qui rend deux visites irréconciliables : le sel de la veille
    // est détruit, la clé d'hier ne se recalcule plus.
    assert.notEqual(
      cleVisiteur(SEL_HIER, SITE, IP, UA),
      cleVisiteur(SEL_AUJOURD_HUI, SITE, IP, UA),
    );
  });

  it("37. deux visiteurs du même jour ne se confondent pas", () => {
    assert.notEqual(
      cleVisiteur(SEL_AUJOURD_HUI, SITE, IP, UA),
      cleVisiteur(SEL_AUJOURD_HUI, SITE, "90.1.2.3", UA),
    );
    assert.notEqual(
      cleVisiteur(SEL_AUJOURD_HUI, SITE, IP, UA),
      cleVisiteur(SEL_AUJOURD_HUI, SITE, IP, "Mozilla/5.0 (Windows) Firefox/130"),
    );
  });

  it("38. et le même navigateur sur deux sites non plus", () => {
    assert.notEqual(
      cleVisiteur(SEL_AUJOURD_HUI, SITE, IP, UA),
      cleVisiteur(SEL_AUJOURD_HUI, "site-2", IP, UA),
    );
  });

  it("39. la clé ne laisse rien transparaître de ce qui l'a produite", () => {
    const cle = cleVisiteur(SEL_AUJOURD_HUI, SITE, IP, UA);
    assert.match(cle, /^[0-9a-f]{64}$/);
    for (const secret of [IP, UA, SITE, SEL_AUJOURD_HUI]) {
      assert.equal(cle.includes(secret), false, secret);
    }
  });
});
