import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decision, prometLeSilence, transcrire } from "./prompt.ts";

describe("prometLeSilence", () => {
  it("reconnaît une promesse de silence (Coralie, 07/10/2026)", () => {
    for (const t of [
      "Je te laisse tranquille, je te redonne signe juste avant le 21.",
      "Et si tu préfères que je te laisse tranquille jusqu'au rendez-vous, dis-le-moi.",
      "Promis, je ne t’écris plus d'ici là.",
      "Je me fais discrète jusqu'au jour J.",
    ]) {
      assert.equal(prometLeSilence(t), true, t);
    }
  });

  it("ne voit pas de promesse dans une réponse ordinaire", () => {
    for (const t of [
      "C'est noté, je ne t'envoie plus d'articles. Je t'écrirai seulement pour te rappeler ton rendez-vous.",
      "Je vérifie et je reviens vers toi très vite.",
      "Le diagnostic est offert et sans engagement.",
    ]) {
      assert.equal(prometLeSilence(t), false, t);
    }
  });
});

describe("la décision de l'IA", () => {
  it("porte une demande d'arrêt : vide, articles ou tout", () => {
    const base = {
      reponse: "",
      sur: true,
      question_pour_louis: "",
      confirme: false,
      veut_changer: false,
      detresse: false,
      contenu_propose: "",
      contenu_envoye: "",
      note_pour_peggy: "",
      creneaux_proposes: [],
      creneau_choisi: "",
      veut_annuler: false,
      annulation_confirmee: false,
      raison_annulation: "",
      raison_categorie: "",
      bouton: "",
    };
    for (const arret of ["", "articles", "tout"]) assert.equal(decision.safeParse({ ...base, arret }).success, true);
    assert.equal(decision.safeParse({ ...base, arret: "peut-etre" }).success, false);
    assert.equal(decision.safeParse(base).success, false);
  });
});

describe("transcrire", () => {
  it("ne montre pas à l'IA ce qui n'est jamais parti", () => {
    const quand = "2026-10-08T16:19:00Z";
    const texte = transcrire(
      [
        { sens: "entrant", genre: "texte", modele: null, texte: "Ma question", created_at: quand },
        { sens: "sortant", genre: "libre", modele: null, texte: "Je vérifie et je reviens vers toi très vite.", created_at: quand, statut: "distribue" },
        { sens: "entrant", genre: "texte", modele: null, texte: "Et une autre", created_at: quand },
        { sens: "sortant", genre: "libre", modele: null, texte: "(rien envoyé : sa question a rejoint celle qui attend déjà dans la file)", created_at: quand, statut: "echec" },
      ],
      "Europe/Paris",
    );
    assert.match(texte, /Je vérifie/);
    assert.doesNotMatch(texte, /rien envoyé/);
    assert.match(texte, /Et une autre/);
  });
});
