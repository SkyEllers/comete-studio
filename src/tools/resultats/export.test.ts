/**
 * Ce flux sort de chez nous vers un tiers. Les endroits où l'on se tromperait
 * en silence — une plage mal bornée, un curseur forgé, un champ de trop — se
 * déroulent ici en quelques microsecondes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bornesParis,
  COLONNES_EXPORT,
  decoderCurseur,
  encoderCurseur,
  joursEntre,
  ligneExport,
  meta,
  plageSchema,
} from "./export.ts";

describe("la plage de dates", () => {
  const valide = (depuis: string, jusqua: string) =>
    plageSchema.safeParse({ depuis, jusqua }).success;

  it("1. une plage ordinaire passe", () => {
    assert.equal(valide("2026-09-01", "2026-09-30"), true);
  });

  it("2. un seul jour passe : les bornes sont comprises", () => {
    assert.equal(valide("2026-09-01", "2026-09-01"), true);
    assert.equal(joursEntre("2026-09-01", "2026-09-01"), 1);
  });

  it("3. la forme est exigée avant le sens", () => {
    assert.equal(valide("01/09/2026", "2026-09-30"), false);
    assert.equal(valide("2026-9-1", "2026-09-30"), false);
    assert.equal(valide("", ""), false);
  });

  it("4. une date qui n'existe pas est refusée", () => {
    assert.equal(valide("2026-02-30", "2026-03-01"), false);
    assert.equal(valide("2026-13-01", "2026-13-02"), false);
  });

  it("5. l'ordre compte", () => {
    assert.equal(valide("2026-09-30", "2026-09-01"), false);
  });

  it("6. 366 jours passent, 367 non", () => {
    assert.equal(joursEntre("2026-01-01", "2027-01-01"), 366);
    assert.equal(valide("2026-01-01", "2027-01-01"), true);
    assert.equal(valide("2026-01-01", "2027-01-02"), false);
  });
});

describe("les bornes en heure de Paris", () => {
  it("7. l'hiver, la journée va de minuit +01:00 à 23 h 59 +01:00", () => {
    const { debut, fin } = bornesParis("2026-01-15", "2026-01-20");
    assert.equal(debut, "2026-01-15T00:00:00.000+01:00");
    assert.equal(fin, "2026-01-20T23:59:59.999+01:00");
  });

  it("8. l'été, le décalage suit", () => {
    const { debut, fin } = bornesParis("2026-07-01", "2026-07-31");
    assert.equal(debut, "2026-07-01T00:00:00.000+02:00");
    assert.equal(fin, "2026-07-31T23:59:59.999+02:00");
  });

  it("9. une plage à cheval sur le changement d'heure prend les deux", () => {
    // Dernier dimanche de mars 2026 : le 29.
    const { debut, fin } = bornesParis("2026-03-01", "2026-03-31");
    assert.equal(debut, "2026-03-01T00:00:00.000+01:00");
    assert.equal(fin, "2026-03-31T23:59:59.999+02:00");
  });

  it("10. le jour du basculement lui-même est entier", () => {
    const { debut, fin } = bornesParis("2026-03-29", "2026-03-29");
    // Le décalage est sondé à midi : après le basculement, donc +02:00.
    assert.equal(debut, "2026-03-29T00:00:00.000+02:00");
    assert.equal(fin, "2026-03-29T23:59:59.999+02:00");
    // Ce qui compte : minuit +02:00 précède bien le vrai minuit local
    // (+01:00), donc aucune séance de ce jour-là n'est perdue.
    assert.equal(
      Date.parse(debut) <= Date.parse("2026-03-29T00:00:00.000+01:00"),
      true,
    );
  });
});

describe("le curseur", () => {
  const curseur = { s: "2026-09-01T08:30:00+00:00", i: "9a2115f5-bab3-496e-9a46-aa27eda52db1" };

  it("11. il fait l'aller-retour", () => {
    assert.deepEqual(decoderCurseur(encoderCurseur(curseur)), curseur);
  });

  it("12. rien, ou du bruit, rend null", () => {
    assert.equal(decoderCurseur(null), null);
    assert.equal(decoderCurseur(undefined), null);
    assert.equal(decoderCurseur(""), null);
    assert.equal(decoderCurseur("pas du base64 !"), null);
    assert.equal(decoderCurseur(Buffer.from("[]").toString("base64url")), null);
  });

  it("13. un curseur forgé ne rentre pas dans la chaîne de filtre", () => {
    // Le guillemet et la virgule sont de la grammaire PostgREST : sans ces
    // contrôles, ce curseur réécrirait la condition de pagination.
    const forge = encoderCurseur({
      s: '2026-09-01T08:30:00+00:00",id.gt."0',
      i: "9a2115f5-bab3-496e-9a46-aa27eda52db1",
    });
    assert.equal(decoderCurseur(forge), null);

    const forgeId = encoderCurseur({ s: curseur.s, i: 'x",organization_id.neq."y' });
    assert.equal(decoderCurseur(forgeId), null);
  });

  it("14. un curseur démesuré est refusé sans être décodé", () => {
    assert.equal(decoderCurseur("A".repeat(5000)), null);
  });
});

describe("la liste blanche", () => {
  /*
   * Le contrat du chantier, écrit là où il se casserait. Ces deux tests
   * échouent si quelqu'un ajoute un champ à l'export sans y penser à deux
   * fois — c'est exactement leur raison d'être.
   */
  const SERVIS = [
    "attribution",
    "canceled_at",
    "channel",
    "channel_label",
    "currency",
    "effective_status",
    "event_type_name",
    "event_uri",
    "id",
    "invitee_uri",
    "rescheduled_from",
    "sale_amount_cents",
    "sale_date",
    "sale_recorded_at",
    "scheduled_end",
    "scheduled_start",
    "status",
    "updated_at",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
  ];

  const BRUTE = {
    id: "9a2115f5-bab3-496e-9a46-aa27eda52db1",
    channel_id: "c-ads",
    event_uri: "https://api.calendly.com/scheduled_events/E",
    invitee_uri: "https://api.calendly.com/scheduled_events/E/invitees/I",
    scheduled_start: "2026-09-01T08:30:00+00:00",
    scheduled_end: "2026-09-01T09:15:00+00:00",
    canceled_at: null,
    event_type_name: "Diagnostic offert",
    attribution: "utm",
    rescheduled_from: "2f0c9c1e-3f4a-4d0b-9a71-6c1f2b8d5e33",
    status: "confirme",
    effective_status: "honore",
    sale_amount_cents: 120000,
    sale_date: "2026-09-03",
    sale_recorded_at: "2026-09-03T10:00:00+00:00",
    currency: "EUR",
    updated_at: "2026-09-03T10:00:00+00:00",
    // Quatre champs sortent de cet objet, les deux autres restent dedans.
    utm: {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "diagnostic-septembre",
      utm_content: "annonce-b",
      utm_term: "therapeute lyon",
      gclid: "Cj0KCQ-terme-de-clic",
    },
    // Ce que la vue porte et que l'export ne doit jamais servir.
    invitee_first_name: "Camille",
    invitee_last_name: "Dupont",
    invitee_display: "Camille D.",
    invitee_key: "b9f1c0a2e4d6",
    sale_note: "pack 5 séances",
    organization_id: "org-1",
  };

  it("15. une ligne servie porte exactement les champs convenus", () => {
    const ligne = ligneExport(BRUTE, { key: "google_ads", label: "Google Ads" });
    assert.deepEqual(Object.keys(ligne).sort(), SERVIS);
  });

  it("16. ni nom, ni clé d'invité, ni note de vente n'en sortent", () => {
    const corps = JSON.stringify(ligneExport(BRUTE, { key: "google_ads", label: "Google Ads" }));

    for (const interdit of ["Camille", "Dupont", "b9f1c0a2e4d6", "pack 5 séances"]) {
      assert.equal(corps.includes(interdit), false, `${interdit} a fui`);
    }
  });

  it("17. les quatre `utm_*` sortent à plat, et l'objet reste dedans", () => {
    const ligne = ligneExport(BRUTE, { key: "google_ads", label: "Google Ads" });

    assert.equal(ligne.utm_source, "google");
    assert.equal(ligne.utm_medium, "cpc");
    assert.equal(ligne.utm_campaign, "diagnostic-septembre");
    assert.equal(ligne.utm_content, "annonce-b");

    // Ni le reste de l'objet, ni l'objet lui-même.
    const corps = JSON.stringify(ligne);
    for (const interdit of ["utm_term", "therapeute lyon", "gclid", "Cj0KCQ-terme-de-clic"]) {
      assert.equal(corps.includes(interdit), false, `${interdit} a fui`);
    }
  });

  it("18. sans taguage, les quatre valent null — et ne se devinent pas", () => {
    const nu = { ...BRUTE, utm: {} };
    const ligne = ligneExport(nu, { key: "google_ads", label: "Google Ads" });

    assert.equal(ligne.utm_source, null);
    assert.equal(ligne.utm_medium, null);
    assert.equal(ligne.utm_campaign, null);
    assert.equal(ligne.utm_content, null);

    // Les champs restent là : un rapport qui lit `null` sait que la campagne
    // n'était pas taguée, là où un champ absent lui laisserait croire à une
    // panne de l'export.
    assert.deepEqual(Object.keys(ligne).sort(), SERVIS);
  });

  it("19. le canal sort par sa clé lisible, pas par son UUID", () => {
    const ligne = ligneExport(BRUTE, { key: "google_ads", label: "Google Ads" });
    assert.equal(ligne.channel, "google_ads");
    assert.equal(ligne.channel_label, "Google Ads");
    assert.equal(JSON.stringify(ligne).includes("c-ads"), false);
  });

  it("20. un rendez-vous sans canal ne fabrique pas de clé", () => {
    const ligne = ligneExport({ ...BRUTE, channel_id: null }, null);
    assert.equal(ligne.channel, null);
    assert.equal(ligne.channel_label, null);
  });

  it("21. `id` est lu et servi, `channel_id` lu et gardé", () => {
    // `id` fait le curseur et ouvre la ligne : c'est la clé du flux.
    // `channel_id` ne sert qu'à retrouver le canal, qui sort par sa clé.
    assert.equal(COLONNES_EXPORT.includes("id"), true);
    assert.equal(COLONNES_EXPORT.includes("channel_id"), true);
    assert.equal(SERVIS.includes("id"), true);
    assert.equal(SERVIS.includes("channel_id"), false);

    const ligne = ligneExport(BRUTE, { key: "google_ads", label: "Google Ads" });
    assert.equal(ligne.id, "9a2115f5-bab3-496e-9a46-aa27eda52db1");
    assert.equal(Object.keys(ligne)[0], "id");
  });

  it("22. le report pointe son origine, et vaut null quand il n'y en a pas", () => {
    const deplacee = ligneExport(BRUTE, { key: "google_ads", label: "Google Ads" });
    assert.equal(deplacee.rescheduled_from, "2f0c9c1e-3f4a-4d0b-9a71-6c1f2b8d5e33");

    // Une séance qui n'en remplace aucune porte le champ à `null` plutôt que
    // de l'omettre : c'est la même règle que pour les `utm_*`, et pour la
    // même raison — un champ absent se lit comme une panne de l'export.
    const premiere = ligneExport({ ...BRUTE, rescheduled_from: null }, null);
    assert.equal(premiere.rescheduled_from, null);
    assert.deepEqual(Object.keys(premiere).sort(), SERVIS);

    // Et le pointeur se joint : c'est un `id` de ligne, du même genre que
    // celui que l'export sert en tête. Servir l'un sans l'autre ferait de ce
    // champ un drapeau muet.
    const origine = ligneExport({ ...BRUTE, id: deplacee.rescheduled_from }, null);
    assert.equal(origine.id, deplacee.rescheduled_from);
  });

  it("23. aucune colonne d'identité n'est même lue", () => {
    for (const interdit of [
      "invitee_first_name",
      "invitee_last_name",
      "invitee_display",
      "invitee_key",
      "sale_note",
    ]) {
      assert.equal(COLONNES_EXPORT.includes(interdit), false, `${interdit} est lu`);
    }
  });
});

describe("le préambule", () => {
  it("24. il dit le fuseau, la forme des dates, et ce que ce flux n'est pas", () => {
    const entete = meta("abc");
    assert.equal(entete.fuseau_de_reference, "Europe/Paris");
    assert.equal(entete.horodatages, "ISO 8601 avec décalage");
    assert.match(entete.purge, /identité jamais servie/);
    assert.match(entete.purge, /13 mois/);
    assert.match(entete.purge, /pas une archive/);
    assert.equal(entete.suivant, "abc");
  });

  it("25. la dernière page l'annonce par un curseur nul", () => {
    assert.equal(meta(null).suivant, null);
  });
});
