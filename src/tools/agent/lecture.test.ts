import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { demandeArret, estReaction, estSansContenus, estStop, sensDuBouton } from "./lecture.ts";
import { peggy } from "./profils/peggy.ts";

describe("estStop", () => {
  it("reconnaît STOP et ses variantes seules", () => {
    for (const t of ["STOP", "stop", " Stop. ", "Arrête", "arret", "ARRÊT !"]) {
      assert.equal(estStop(t), true, t);
    }
  });

  it("ne prend pas un empêchement pour un STOP", () => {
    for (const t of ["Stop, je ne pourrai pas venir", "stop tabac", "j'arrête pas de penser", ""]) {
      assert.equal(estStop(t), false, t);
    }
  });

  it("reconnaît une demande d'arrêt écrite en toutes lettres (liste A, 09/10/2026)", () => {
    for (const t of [
      "Merci d’arrêter d’envoyer des msg.",
      "Arrêtez de m'écrire svp",
      "Pouvez-vous cesser de me relancer ?",
      "Arrêtez les messages",
      "Stop aux messages merci",
      "Ne m'écrivez plus",
      "ne m'envoyez plus rien",
      "Ne me contactez plus",
      "Je ne veux plus recevoir de messages du tout",
      "je ne souhaite plus être contactée",
      "Désinscrivez-moi",
      "je veux me désabonner",
      "Supprimez mon numéro",
      "Retirez-moi de la liste",
      "Laissez-moi tranquille",
      "fichez-moi la paix",
    ]) {
      assert.equal(demandeArret(t), "tout", t);
      assert.equal(estStop(t), true, t);
      assert.equal(estSansContenus(t), false, t);
    }
  });

  it("ne prend pas pour un STOP ce qui parle d'arrêter autre chose", () => {
    for (const t of [
      "je dois arrêter le sucre",
      "J'ai arrêt le sucre depuis 4 mois, sauf les fruits...",
      "Honnêtement je n'en peux plus, j'ai envie de tout arrêter, de disparaître",
      "j'ai arrêté de manger le soir",
      "Je vous écris plus tard",
      "C'est un pénible ce bot",
      "mon corps est en arrêt depuis 3 ans",
    ]) {
      assert.equal(demandeArret(t), null, t);
      assert.equal(estStop(t), false, t);
    }
  });
});

describe("sensDuBouton", () => {
  it("retrouve le sens d'un bouton par son libellé", () => {
    assert.equal(sensDuBouton(peggy, "Oui, c'est bon"), "confirme");
    assert.equal(sensDuBouton(peggy, "Je dois décaler"), "changer");
    assert.equal(sensDuBouton(peggy, "J'ai un empêchement"), "changer");
    assert.equal(sensDuBouton(peggy, "Peut-être"), null);
  });
});

describe("estReaction", () => {
  it("une réaction seule n'appelle pas de réponse", () => {
    assert.equal(estReaction("[Elle a envoyé une réaction]"), true);
    assert.equal(estReaction("[Elle a envoyé un message vocal]"), false);
    assert.equal(estReaction("Merci ❤️"), false);
  });
});

describe("estSansContenus", () => {
  it("« Ne plus recevoir » arrête les articles, pas tout", () => {
    assert.equal(estStop("Ne plus recevoir"), false);
    assert.equal(estSansContenus("Ne plus recevoir"), true);
    assert.equal(estSansContenus(" ne plus recevoir. "), true);
    assert.equal(estSansContenus("Je ne veux plus recevoir de messages du tout"), false);
  });
  it("une demande d'arrêter les articles seulement coupe les articles, pas tout", () => {
    for (const t of ["arrêtez de m'envoyer des articles", "Je ne veux plus recevoir d'articles", "stop aux recettes, merci"]) {
      assert.equal(estStop(t), false, t);
      assert.equal(estSansContenus(t), true, t);
    }
    // Les articles ET les messages : tout s'arrête.
    assert.equal(estStop("Arrêtez de m'envoyer des articles et des messages"), true);
  });
  it("le bouton du modèle de contenu porte ce sens", () => {
    assert.equal(sensDuBouton(peggy, "Ne plus recevoir"), "sans_contenus");
  });
});
