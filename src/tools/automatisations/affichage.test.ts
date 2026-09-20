import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aRegarder,
  aVenir,
  compteur,
  ecart,
  jamaisVues,
  jour,
  parClient,
  quand,
  resume,
} from "./affichage.ts";
import type { Automatisation, Etat } from "./types.ts";

const auto = (a: Partial<Automatisation> & { slug: string }): Automatisation => ({
  client: "peggy",
  nom: "Rapport ads",
  cadence: "mardi 07:00",
  depot: "peggygirault-site",
  workflow: "ads-report",
  mail_attendu: "toujours",
  actif: true,
  ordre: 0,
  prochaine_le: null,
  attendue_le: null,
  recu_le: null,
  recu_objet: null,
  run_statut: null,
  run_le: null,
  run_url: null,
  etat: "ok" as Etat,
  releve_le: "2026-09-20T10:00:00Z",
  passages: [],
  ...a,
});

// Dimanche 20 septembre 2026, 12h00 à Paris.
const DIMANCHE = new Date("2026-09-20T10:00:00Z");

test("l'écart se dit en minutes, en heures, puis en jours", () => {
  assert.equal(ecart("2026-09-20T10:30:00Z", DIMANCHE), "dans 30 min");
  assert.equal(ecart("2026-09-20T09:30:00Z", DIMANCHE), "il y a 30 min");
  assert.equal(ecart("2026-09-20T16:00:00Z", DIMANCHE), "dans 6 h");
  assert.equal(ecart("2026-09-21T16:00:00Z", DIMANCHE), "demain");
  assert.equal(ecart("2026-09-19T16:00:00Z", DIMANCHE), "hier");
  assert.equal(ecart("2026-09-22T05:00:00Z", DIMANCHE), "dans 2 jours");
  assert.equal(ecart(null, DIMANCHE), "—");
});

test("une date de fin de soirée reste « demain », pas « dans 12 h »", () => {
  // 21/09 à 18h00 Paris vu depuis le 20/09 à 23h30 Paris : c'est demain.
  const tard = new Date("2026-09-20T21:30:00Z");
  assert.equal(ecart("2026-09-21T16:00:00Z", tard), "demain");
});

test("les dates s'écrivent à l'heure de Paris", () => {
  // 05:00 UTC un mardi de septembre = 07:00 à Paris.
  assert.equal(quand("2026-09-22T05:00:00Z"), "Mar. 22/09 07:00");
  assert.equal(jour("2026-09-22T05:00:00Z"), "mardi 22/09");
});

test("les clients gardent l'ordre du fichier du vault", () => {
  const groupes = parClient([
    auto({ slug: "peggy/nl-rapport", ordre: 8 }),
    auto({ slug: "jonathan/ads-report", client: "jonathan", ordre: 0 }),
    auto({ slug: "peggy/ads-report", ordre: 2 }),
  ]);
  assert.deepEqual(
    groupes.map((g) => g.client),
    ["peggy", "jonathan"],
  );
  assert.deepEqual(
    groupes[0].lignes.map((l) => l.slug),
    ["peggy/ads-report", "peggy/nl-rapport"],
  );
});

test("le compteur sépare ce qui va bien, ce qui n'a jamais tourné et ce qui dort", () => {
  const lignes = [
    auto({ slug: "a", etat: "ok" }),
    auto({ slug: "b", etat: "silence" }),
    auto({ slug: "c", etat: "manque" }),
    auto({ slug: "d", etat: "pause", actif: false }),
    auto({ slug: "e", etat: "inconnu" }),
  ];
  // « e » n'a jamais tourné : elle ne compte pas comme un échec, et pas non
  // plus comme une réussite — on n'en sait rien.
  assert.deepEqual(compteur(lignes), { sereines: 2, jugees: 3, jamais: 1, pause: 1 });
  assert.deepEqual(
    aRegarder(lignes).map((l) => l.slug),
    ["c"],
  );
  assert.deepEqual(
    jamaisVues(lignes).map((l) => l.slug),
    ["e"],
  );
});

test("une automatisation jamais vue passer le dit, et donne sa première échéance", () => {
  const neuve = auto({
    slug: "jonathan/seo-report",
    etat: "inconnu",
    prochaine_le: "2026-10-01T06:00:00Z",
  });
  assert.equal(resume(neuve, DIMANCHE), "Jamais vue passer · prochaine jeudi 01/10 (dans 11 jours)");
});

test("le résumé dit d'abord ce qui manque, puis quand revient la prochaine", () => {
  const perdu = auto({
    slug: "peggy/ads-report",
    etat: "mail-perdu",
    attendue_le: "2026-09-15T05:00:00Z",
    prochaine_le: "2026-09-22T05:00:00Z",
  });
  assert.equal(
    resume(perdu, DIMANCHE),
    "Job vert, mail absent pour Mar. 15/09 07:00 · prochaine mardi 22/09 (dans 2 jours)",
  );

  const recu = auto({
    slug: "peggy/nl-veille",
    etat: "ok",
    recu_le: "2026-09-18T11:12:00Z",
    prochaine_le: "2026-09-25T09:00:00Z",
  });
  assert.match(resume(recu, DIMANCHE), /^Dernier reçu Ven\. 18\/09 13:12 · prochaine vendredi 25\/09/);

  assert.equal(resume(auto({ slug: "x", actif: false }), DIMANCHE), "En pause — rien n'est attendu");
});

test("la prochaine échéance passe devant, en pause ou sans date on ne la propose pas", () => {
  const suite = aVenir([
    auto({ slug: "peggy/nl-rapport", prochaine_le: "2026-10-05T06:00:00Z" }),
    auto({ slug: "peggy/article-publish", prochaine_le: "2026-09-21T16:00:00Z" }),
    auto({ slug: "jonathan/ads-report", prochaine_le: "2026-09-22T05:00:00Z" }),
    auto({ slug: "jonathan/article-generate", actif: false, prochaine_le: "2026-09-21T05:47:00Z" }),
    auto({ slug: "sans-date", prochaine_le: null }),
  ]);
  assert.deepEqual(
    suite.map((l) => l.slug),
    ["peggy/article-publish", "jonathan/ads-report", "peggy/nl-rapport"],
  );
});
