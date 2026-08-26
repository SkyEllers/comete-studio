/**
 * Les premiers tests unitaires du dépôt.
 *
 *   npm run test
 *
 * Ils ne couvrent qu'un fichier, et c'est voulu : l'attribution est le seul
 * endroit du hub où une erreur de logique se transforme directement en euros
 * facturés à tort. Le reste se vérifie par les bancs, qui parlent à la vraie
 * base ; ici, on veut pouvoir dérouler douze cas en une seconde.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attribuer,
  canalDeclare,
  CANAUX_PAR_DEFAUT,
  precedent,
  reponseDeclaree,
  type Canal,
} from "./attribution.ts";

/** Les canaux par défaut, dotés d'identifiants stables et lisibles. */
const CANAUX: Canal[] = CANAUX_PAR_DEFAUT.map((canal) => ({
  ...canal,
  id: `id-${canal.key}`,
  is_active: true,
}));

const LE_JOUR = "2026-06-15T10:00:00.000Z";

const decale = (jours: number, depuis = LE_JOUR) =>
  new Date(Date.parse(depuis) + jours * 86_400_000).toISOString();

const verdict = (
  utm: Record<string, string>,
  options: {
    previous?: { id?: string | null; channel_id: string | null; scheduled_start: string } | null;
    windowDays?: number;
    channels?: Canal[];
  } = {},
) =>
  attribuer({
    utm,
    scheduledStart: LE_JOUR,
    channels: options.channels ?? CANAUX,
    previous: options.previous ?? null,
    windowDays: options.windowDays ?? 90,
  });

describe("attribution par la campagne", () => {
  it("1. google/cpc va aux annonces", () => {
    assert.deepEqual(verdict({ utm_source: "google", utm_medium: "cpc" }), {
      channel_id: "id-google_ads",
      attribution: "utm",
      source: null,
    });
  });

  it("2. un gclid seul suffit", () => {
    assert.deepEqual(verdict({ gclid: "Cj0KCQ" }), {
      channel_id: "id-google_ads",
      attribution: "utm",
      source: null,
    });
  });

  it("3. instagram va chez Meta", () => {
    assert.deepEqual(verdict({ utm_source: "Instagram", utm_medium: "cpc" }), {
      channel_id: "id-meta",
      attribution: "utm",
      source: null,
    });
  });

  it("4. un fbclid seul suffit aussi", () => {
    assert.deepEqual(verdict({ fbclid: "IwAR" }), {
      channel_id: "id-meta",
      attribution: "utm",
      source: null,
    });
  });

  it("5. google/organic va au SEO, pas aux annonces", () => {
    // Le cas qui condamne la lecture naïve du brief : Google Ads déclare la
    // source « google » et passe en premier. Sans le veto du medium, on
    // facturerait une commission sur du référencement naturel.
    assert.deepEqual(verdict({ utm_source: "google", utm_medium: "organic" }), {
      channel_id: "id-seo",
      attribution: "utm",
      source: null,
    });
  });

  it("6. un medium email va à la newsletter, quelle que soit la source", () => {
    assert.deepEqual(verdict({ utm_source: "brevo", utm_medium: "email" }), {
      channel_id: "id-newsletter",
      attribution: "utm",
      source: null,
    });
  });

  it("7. une campagne qu'aucun canal ne reconnaît va dans Autre", () => {
    assert.deepEqual(verdict({ utm_source: "tiktok", utm_medium: "cpc" }), {
      channel_id: "id-autre",
      attribution: "utm",
      source: null,
    });
  });

  it("8. la casse et les accents ne changent rien", () => {
    assert.deepEqual(verdict({ utm_source: "GOOGLE", utm_medium: "CPC" }), {
      channel_id: "id-google_ads",
      attribution: "utm",
      source: null,
    });
  });

  it("9. un canal désactivé n'est jamais retenu", () => {
    const sansAnnonces = CANAUX.map((canal) =>
      canal.key === "google_ads" ? { ...canal, is_active: false } : canal,
    );
    assert.deepEqual(
      verdict({ utm_source: "google", utm_medium: "cpc" }, { channels: sansAnnonces }),
      { channel_id: "id-autre", attribution: "utm", source: null },
    );
  });

  it("10. un paramètre utm vide ne fait pas une campagne", () => {
    assert.deepEqual(verdict({ utm_source: "" }), {
      channel_id: "id-direct",
      attribution: "direct",
      source: null,
    });
  });
});

describe("attribution par la récurrence", () => {
  it("11. à 89 jours, la personne revient sur le même canal", () => {
    assert.deepEqual(
      verdict(
        {},
        { previous: { channel_id: "id-google_ads", scheduled_start: decale(-89) } },
      ),
      { channel_id: "id-google_ads", attribution: "recurrence", source: null },
    );
  });

  it("12. à 91 jours, la fenêtre est passée : Direct", () => {
    assert.deepEqual(
      verdict(
        {},
        { previous: { channel_id: "id-google_ads", scheduled_start: decale(-91) } },
      ),
      { channel_id: "id-direct", attribution: "direct", source: null },
    );
  });

  it("13. une campagne présente l'emporte toujours sur la récurrence", () => {
    assert.deepEqual(
      verdict(
        { utm_source: "instagram" },
        { previous: { channel_id: "id-google_ads", scheduled_start: decale(-2) } },
      ),
      { channel_id: "id-meta", attribution: "utm", source: null },
    );
  });

  it("14. une fenêtre à zéro désactive la récurrence", () => {
    assert.deepEqual(
      verdict(
        {},
        {
          windowDays: 0,
          previous: { channel_id: "id-google_ads", scheduled_start: decale(-2) },
        },
      ),
      { channel_id: "id-direct", attribution: "direct", source: null },
    );
  });

  it("15b. la récurrence dit de quelle séance elle vient", () => {
    // Sans cette référence, la fiche ne pourrait qu'affirmer « par récurrence »,
    // ce qui demande au client de croire sur parole.
    const trouve = precedent(
      [
        {
          id: "rdv-de-mars",
          channel_id: "id-google_ads",
          scheduled_start: decale(-30),
          status: "honore",
        },
      ],
      LE_JOUR,
    );
    assert.deepEqual(verdict({}, { previous: trouve }), {
      channel_id: "id-google_ads",
      attribution: "recurrence",
      source: "rdv-de-mars",
    });
  });

  it("15. un précédent sans canal ne propage rien", () => {
    assert.deepEqual(
      verdict({}, { previous: { channel_id: null, scheduled_start: decale(-2) } }),
      { channel_id: "id-direct", attribution: "direct", source: null },
    );
  });
});

describe("le rendez-vous précédent", () => {
  it("16. une séance annulée ne porte pas la récurrence", () => {
    const historique = [
      { channel_id: "id-google_ads", scheduled_start: decale(-10), status: "annule" },
      { channel_id: "id-meta", scheduled_start: decale(-40), status: "honore" },
    ];
    assert.deepEqual(precedent(historique, LE_JOUR), {
      id: null,
      channel_id: "id-meta",
      scheduled_start: decale(-40),
    });
  });

  it("17. tout annulé : aucun précédent, donc Direct", () => {
    const historique = [
      { channel_id: "id-google_ads", scheduled_start: decale(-10), status: "annule" },
    ];
    const trouve = precedent(historique, LE_JOUR);
    assert.equal(trouve, null);
    assert.deepEqual(verdict({}, { previous: trouve }), {
      channel_id: "id-direct",
      attribution: "direct",
      source: null,
    });
  });

  it("18. c'est le plus récent qui compte, pas le premier de la liste", () => {
    const historique = [
      { channel_id: "id-meta", scheduled_start: decale(-40), status: "honore" },
      { channel_id: "id-google_ads", scheduled_start: decale(-5), status: "honore" },
    ];
    assert.equal(precedent(historique, LE_JOUR)?.channel_id, "id-google_ads");
  });

  it("19. une séance postérieure n'est pas un précédent", () => {
    const historique = [
      { channel_id: "id-meta", scheduled_start: decale(+3), status: "confirme" },
    ];
    assert.equal(precedent(historique, LE_JOUR), null);
  });
});

describe("la source déclarée", () => {
  it("20. la réponse est lue, et ne change pas l'attribution", () => {
    const questions = [
      { question: "Motif de la consultation", answer: "Suivi" },
      { question: "Comment m'avez-vous connu ?", answer: "Bouche à oreille" },
    ];
    const declaree = reponseDeclaree(questions);
    assert.equal(declaree, "Bouche à oreille");
    assert.equal(canalDeclare(declaree, CANAUX)?.key, "bouche_a_oreille");

    // Attribué aux annonces, déclaré au bouche à oreille : c'est exactement la
    // divergence que l'écran doit signaler, sans qu'elle change le calcul.
    assert.deepEqual(verdict({ utm_source: "google", utm_medium: "cpc" }), {
      channel_id: "id-google_ads",
      attribution: "utm",
      source: null,
    });
  });

  it("21. sans question « connu », rien n'est déclaré", () => {
    assert.equal(reponseDeclaree([{ question: "Votre âge", answer: "34" }]), null);
    assert.equal(canalDeclare(null, CANAUX), null);
  });

  it("22. une réponse hors catalogue ne désigne aucun canal", () => {
    assert.equal(canalDeclare("Un flyer dans ma boîte", CANAUX), null);
  });

  it("23. une réponse trop longue est tronquée", () => {
    const declaree = reponseDeclaree([
      { question: "Comment m'avez-vous connu ?", answer: "x".repeat(500) },
    ]);
    assert.equal(declaree?.length, 120);
  });
});
