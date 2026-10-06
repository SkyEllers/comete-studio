import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estReaction, estSansContenus, estStop, sensDuBouton } from "./lecture.ts";
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
  it("le bouton du modèle de contenu porte ce sens", () => {
    assert.equal(sensDuBouton(peggy, "Ne plus recevoir"), "sans_contenus");
  });
});
