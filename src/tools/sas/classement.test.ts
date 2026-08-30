/**
 * Ce qu'on fait dire à l'IA, et ce qu'on refuse d'en croire.
 *
 *   npm run test
 *
 * `reconcilier` est la frontière entre une réponse de modèle et l'écran que
 * Louis valide. Elle ne doit jamais lever, jamais inventer une boîte, jamais
 * laisser passer une note perso rangée quelque part — et savoir rendre `null`,
 * qui est le signal du repli en manuel. Ces cas-là se déroulent en une seconde
 * ici ; les faire à la main dans le navigateur prendrait un après-midi.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleNom, reconcilier, trouverBoite } from "./classement.ts";
import { decouper, ideesManuelles } from "./decoupage.ts";
import type { Boite } from "./types.ts";

const BOITES: Boite[] = [
  { id: "id-jonathan", name: "Jonathan" },
  { id: "id-comete", name: "Comète" },
];

/** Une réponse de modèle bien formée, à laquelle on change ce qu'on teste. */
const reponse = (idees: unknown[]) => ({ idees });

const idee = (extra: Record<string, unknown>) => ({
  texte: "une idée",
  univers: "pro",
  certitude: "haute",
  ...extra,
});

describe("cleNom et trouverBoite", () => {
  it("1. la casse et les accents ne comptent pas", () => {
    assert.equal(cleNom("Comète"), cleNom("comete"));
    assert.equal(cleNom("  Flora "), "flora");
  });

  it("2. une boîte se retrouve malgré l'accent manquant", () => {
    assert.equal(trouverBoite("comete", BOITES)?.id, "id-comete");
    assert.equal(trouverBoite("JONATHAN", BOITES)?.id, "id-jonathan");
  });

  it("3. une boîte inconnue ne se trouve pas", () => {
    assert.equal(trouverBoite("Flora", BOITES), null);
  });
});

describe("reconcilier — le scénario du brief", () => {
  const source =
    "finir le SEO de Jonathan\nanalyser résultats campagne Flora\nracheter des lentilles";

  const brut = reponse([
    {
      texte: "finir le SEO de Jonathan",
      univers: "pro",
      boite: "Jonathan",
      certitude: "haute",
    },
    {
      texte: "analyser résultats campagne Flora",
      univers: "pro",
      nouvelle_boite: "Flora",
      certitude: "haute",
    },
    { texte: "racheter des lentilles", univers: "perso", certitude: "haute" },
  ]);

  const idees = reconcilier(brut, BOITES, source);

  it("4. les trois idées ressortent", () => {
    assert.equal(idees?.length, 3);
  });

  it("5. Jonathan existe : l'idée va dans sa boîte", () => {
    assert.deepEqual(idees?.[0].destination, {
      type: "boite",
      boiteId: "id-jonathan",
    });
    assert.equal(idees?.[0].incertain, false);
  });

  it("6. Flora est inconnue : c'est une question, pas une décision", () => {
    assert.deepEqual(idees?.[1].destination, { type: "nouvelle", nom: "Flora" });
    assert.equal(idees?.[1].incertain, true);
  });

  it("7. les lentilles sont perso, sans boîte", () => {
    assert.deepEqual(idees?.[2].destination, { type: "perso" });
  });

  it("8. le texte est recopié tel quel", () => {
    assert.equal(idees?.[0].texte, "finir le SEO de Jonathan");
  });
});

describe("reconcilier — ce qu'on corrige derrière l'IA", () => {
  it("9. une boîte nommée mais absente devient une proposition", () => {
    const idees = reconcilier(
      reponse([idee({ boite: "Flora" })]),
      BOITES,
      "une idée",
    );
    assert.deepEqual(idees?.[0].destination, { type: "nouvelle", nom: "Flora" });
    assert.equal(idees?.[0].incertain, true);
  });

  it("10. une nouvelle boîte qui existe déjà pointe sur l'existante", () => {
    const idees = reconcilier(
      reponse([idee({ nouvelle_boite: "comete" })]),
      BOITES,
      "une idée",
    );
    assert.deepEqual(idees?.[0].destination, { type: "boite", boiteId: "id-comete" });
    assert.equal(idees?.[0].incertain, false);
  });

  it("11. une perso à qui l'IA colle une boîte perd la boîte", () => {
    const idees = reconcilier(
      reponse([idee({ univers: "perso", boite: "Jonathan" })]),
      BOITES,
      "une idée",
    );
    assert.deepEqual(idees?.[0].destination, { type: "perso" });
  });

  it("12. une pro sans boîte tombe dans « À ranger »", () => {
    const idees = reconcilier(reponse([idee({})]), BOITES, "une idée");
    assert.deepEqual(idees?.[0].destination, { type: "aranger" });
  });

  it("13. une certitude basse ressort en ambre", () => {
    const idees = reconcilier(
      reponse([idee({ certitude: "basse", boite: "Jonathan" })]),
      BOITES,
      "une idée",
    );
    assert.equal(idees?.[0].incertain, true);
  });

  it("14. une idée vide est jetée, les autres restent", () => {
    const idees = reconcilier(
      reponse([idee({ texte: "   " }), idee({ texte: "vraie idée" })]),
      BOITES,
      "vraie idée",
    );
    assert.equal(idees?.length, 1);
    assert.equal(idees?.[0].texte, "vraie idée");
  });
});

describe("reconcilier — ce qui renvoie au mode manuel", () => {
  const manuel = (brut: unknown, source = "une idée") =>
    assert.equal(reconcilier(brut, BOITES, source), null, JSON.stringify(brut));

  it("15. une réponse qui n'est pas un objet", () => {
    manuel(null);
    manuel("désolé, je ne peux pas");
    manuel([]);
  });

  it("16. un univers inventé", () => {
    manuel(reponse([idee({ univers: "professionnel" })]));
  });

  it("17. une certitude inventée", () => {
    manuel(reponse([idee({ certitude: "moyenne" })]));
  });

  it("18. une liste vide, ou que des idées vides", () => {
    manuel(reponse([]));
    manuel(reponse([idee({ texte: " " })]));
  });

  it("19. un texte qui n'est pas du texte", () => {
    manuel(reponse([idee({ texte: 42 })]));
  });

  it("20. une réponse qui rallonge nettement le texte d'origine", () => {
    // Le modèle a reformulé au lieu de recopier : on ne fait pas relire à
    // Louis des idées qu'il n'a pas écrites.
    manuel(
      reponse([
        idee({
          texte:
            "Il conviendrait de finaliser le référencement naturel du site de Jonathan avant la fin de la semaine prochaine, en veillant à la qualité des balises.",
        }),
      ]),
      "seo jonathan",
    );
  });

  it("21. un découpage fidèle passe, même en plusieurs morceaux", () => {
    const source = "seo jonathan\nlentilles";
    const idees = reconcilier(
      reponse([
        idee({ texte: "seo jonathan", boite: "Jonathan" }),
        idee({ texte: "lentilles", univers: "perso" }),
      ]),
      BOITES,
      source,
    );
    assert.equal(idees?.length, 2);
  });
});

describe("decouper — le filet de secours", () => {
  it("22. une idée par ligne, les vides sautent", () => {
    assert.deepEqual(decouper("un\n\n  deux  \n\n\ntrois\n"), [
      "un",
      "deux",
      "trois",
    ]);
  });

  it("23. les tirets et puces de liste disparaissent", () => {
    assert.deepEqual(decouper("- un\n• deux\n* trois\n— quatre"), [
      "un",
      "deux",
      "trois",
      "quatre",
    ]);
  });

  it("24. on ne coupe ni sur « et », ni sur « / »", () => {
    assert.deepEqual(decouper("seo jonathan / lentilles et pain"), [
      "seo jonathan / lentilles et pain",
    ]);
  });

  it("25. un texte sans rien dedans ne rend rien", () => {
    assert.deepEqual(decouper("   \n\n  "), []);
  });

  it("26. les idées manuelles arrivent sans destination", () => {
    const idees = ideesManuelles("un\ndeux");
    assert.equal(idees.length, 2);
    assert.equal(idees[0].destination, null);
    assert.equal(idees[0].incertain, false);
    assert.notEqual(idees[0].cle, idees[1].cle);
  });
});
