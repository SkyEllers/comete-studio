import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { descriptionEvenement, lienFiche, mailReservation, nomComplet, reponsesLues } from "./reponses.ts";

const rdv = {
  debut: "2026-10-01T12:00:00.000Z",
  prenom: "Camille",
  nom: "Martin",
  email: "camille@exemple.fr",
  telephone: "+33600000000",
  reponses: [
    { question: "Qu'est-ce qui t'amène ?", reponse: "Des ballonnements <depuis> un an" },
    { question: "Vide", reponse: "  " },
    "pas une réponse",
  ],
};
const ESPACE = "https://app.cometestudio.fr/app/peggy/resultats/rendez-vous?resa=r1";

describe("reponsesLues", () => {
  it("garde les réponses remplies, dans l'ordre, et ignore le reste", () => {
    assert.deepEqual(reponsesLues(rdv.reponses), [
      { question: "Qu'est-ce qui t'amène ?", reponse: "Des ballonnements <depuis> un an" },
    ]);
    assert.deepEqual(reponsesLues(null), []);
    assert.deepEqual(reponsesLues({}), []);
  });
});

describe("nomComplet", () => {
  it("prénom et nom, ou « une cliente »", () => {
    assert.equal(nomComplet(rdv), "Camille Martin");
    assert.equal(nomComplet({ prenom: " ", nom: null }), "une cliente");
  });
});

describe("lienFiche", () => {
  it("la titulaire va sur la fiche Radar, une closeuse sur son espace", () => {
    const base = "https://app.cometestudio.fr/app/peggy";
    assert.equal(lienFiche(base, "titulaire", "r1"), `${base}/resultats/rendez-vous?resa=r1`);
    assert.equal(lienFiche(base, "closeuse", "r1"), `${base}/closeuse`);
  });
});

describe("descriptionEvenement", () => {
  it("porte le numéro, le rappel, les réponses et le lien de l'espace, sans l'email", () => {
    const d = descriptionEvenement({ ...rdv, email: null }, ESPACE);
    assert.match(d, /par Camille Martin\./);
    assert.match(d, /Téléphone : \+33600000000/);
    assert.match(d, /lancer l'enregistrement/);
    assert.match(d, /Qu'est-ce qui t'amène \?\nDes ballonnements <depuis> un an/);
    assert.ok(d.endsWith(`Sa fiche : ${ESPACE}`));
    assert.doesNotMatch(d, /camille@exemple\.fr/);
  });
  it("reste sous 7 000 caractères avec 12 longues réponses, lien compris", () => {
    const longues = Array.from({ length: 12 }, (_, i) => ({ question: `Question ${i}`, reponse: "x".repeat(2000) }));
    const d = descriptionEvenement({ ...rdv, reponses: longues }, ESPACE);
    assert.ok(d.length <= 7000, `${d.length}`);
    assert.ok(d.endsWith(ESPACE));
  });
});

describe("mailReservation", () => {
  it("nouveau : le jour à l'heure de la personne, les coordonnées, les réponses échappées", () => {
    const m = mailReservation({ type: "nouveau", rdv, fuseau: "Europe/Paris", lienVisio: "https://zoom.us/j/1", lienFiche: ESPACE });
    assert.equal(m.sujet, "Nouveau diagnostic : Camille, jeudi 1 octobre à 14h");
    assert.match(m.texte, /^Camille a réservé un diagnostic pour jeudi 1 octobre à 14h\./);
    assert.match(m.texte, /Email : camille@exemple\.fr/);
    assert.match(m.texte, /Visio : https:\/\/zoom\.us\/j\/1/);
    assert.match(m.html, /&lt;depuis&gt;/);
    assert.doesNotMatch(m.html, /<depuis>/);
  });
  it("déplacé : le nouveau créneau", () => {
    const m = mailReservation({ type: "deplace", rdv, fuseau: "Europe/Paris", lienVisio: null, lienFiche: ESPACE });
    assert.equal(m.sujet, "Diagnostic déplacé : Camille, jeudi 1 octobre à 14h");
    assert.doesNotMatch(m.texte, /Visio :/);
  });
});
