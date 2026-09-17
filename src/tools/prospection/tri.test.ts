import assert from "node:assert/strict";
import { test } from "node:test";

import { formeDe, groupeDe, repartirVideos, semaineDe } from "./tri.ts";
import type { Prospect, Suivi } from "./types.ts";

const prospect = (p: Partial<Prospect> & { slug: string }): Prospect => ({
  nom: p.slug,
  metier: null,
  ville: null,
  statut: "approche",
  source: null,
  canal: "mail",
  contact: null,
  contacte_le: "2026-09-13",
  relance_le: "2026-09-23",
  question: null,
  note: null,
  avis_google: null,
  message_titre: null,
  message: null,
  note_detail: null,
  video: null,
  tri_rapide: null,
  historique: [],
  liens: [],
  maj_vault: null,
  suivi: null,
  ...p,
});

const suivi = (s: Partial<Suivi>): Suivi => ({
  video_filmee_le: null,
  relance_envoyee_le: null,
  relance_type: null,
  reponse_le: null,
  reponse: null,
  classe: false,
  ...s,
});

test("la semaine d'une date est celle de son lundi", () => {
  assert.equal(semaineDe("2026-09-23"), "2026-09-21"); // mercredi
  assert.equal(semaineDe("2026-09-21"), "2026-09-21"); // le lundi lui-même
  assert.equal(semaineDe("2026-09-27"), "2026-09-21"); // dimanche, même semaine
  assert.equal(semaineDe("2026-09-28"), "2026-09-28"); // lundi suivant
});

test("chaque prospect tombe dans le bon groupe", () => {
  const jour = "2026-09-23";
  assert.equal(groupeDe(prospect({ slug: "a", relance_le: "2026-09-21" }), jour), "retard");
  assert.equal(groupeDe(prospect({ slug: "b", relance_le: jour }), jour), "aujourdhui");
  assert.equal(groupeDe(prospect({ slug: "c", relance_le: "2026-09-26" }), jour), "semaine");
  assert.equal(groupeDe(prospect({ slug: "d", relance_le: "2026-10-15" }), jour), "plus-tard");
  assert.equal(groupeDe(prospect({ slug: "e", relance_le: null }), jour), "sans-date");
  assert.equal(
    groupeDe(
      prospect({ slug: "f", relance_le: "2026-09-21", suivi: suivi({ relance_envoyee_le: "2026-09-21" }) }),
      jour,
    ),
    "faite",
    "une relance envoyée sort de la file, même si sa date est passée",
  );
});

test("les meilleures notes de la semaine ont la vidéo, dans la limite du quota", () => {
  const liste = [
    prospect({ slug: "haut", note: 5, avis_google: 40 }),
    prospect({ slug: "milieu", note: 3, avis_google: 90 }),
    prospect({ slug: "bas", note: 1, avis_google: 200 }),
  ];
  const formes = repartirVideos(liste, 2);
  assert.equal(formes.get("haut"), "video");
  assert.equal(formes.get("milieu"), "video");
  assert.equal(formes.get("bas"), "mail", "le quota s'arrête, la note ne compense pas");
});

test("à note égale, le plus d'avis passe devant", () => {
  const formes = repartirVideos(
    [
      prospect({ slug: "peu-d-avis", note: 4, avis_google: 20 }),
      prospect({ slug: "beaucoup-d-avis", note: 4, avis_google: 300 }),
    ],
    1,
  );
  assert.equal(formes.get("beaucoup-d-avis"), "video");
  assert.equal(formes.get("peu-d-avis"), "mail");
});

test("un prospect pas encore noté ne prend la place de personne", () => {
  const formes = repartirVideos(
    [
      prospect({ slug: "note", note: 1 }),
      prospect({ slug: "pas-note", note: null, avis_google: 500 }),
    ],
    5,
  );
  assert.equal(formes.get("note"), "video");
  assert.equal(formes.get("pas-note"), "mail", "sans note, pas de vidéo, même avec 500 avis");
});

test("le quota se compte par semaine de relance", () => {
  const formes = repartirVideos(
    [
      prospect({ slug: "s1-a", note: 5, relance_le: "2026-09-23" }),
      prospect({ slug: "s1-b", note: 4, relance_le: "2026-09-26" }),
      prospect({ slug: "s2-a", note: 2, relance_le: "2026-09-30" }),
    ],
    1,
  );
  assert.equal(formes.get("s1-a"), "video");
  assert.equal(formes.get("s1-b"), "mail", "la semaine du 21/09 n'a qu'une place");
  assert.equal(formes.get("s2-a"), "video", "la semaine suivante a la sienne");
});

test("ce que Louis a coché l'emporte sur le calcul", () => {
  const p = prospect({ slug: "x", note: 0, suivi: suivi({ relance_type: "video" }) });
  const calculees = repartirVideos([p], 0);
  assert.deepEqual(formeDe(p, calculees), { forme: "video", choisie: true });
});
