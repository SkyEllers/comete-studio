import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOUTONS, messageAvecBouton } from "./prompt.ts";

const lien = `https://www.peggygirault.fr/mon-rdv/#${"a".repeat(64)}`;
const liens = { changer: lien, reprendre: "https://www.peggygirault.fr/rdv-diagnostic/" };

describe("Agent — le lien part dans un bouton", () => {
  it("les libellés tiennent dans les 20 caractères de WhatsApp", () => {
    for (const t of Object.values(BOUTONS)) assert.ok(t.length <= 20, t);
  });

  it("sans bouton demandé, le texte part tel quel", () => {
    assert.deepEqual(messageAvecBouton("Bonjour", "", liens), { texte: "Bonjour" });
  });

  it("le bouton porte le bon lien", () => {
    const m = messageAvecBouton("Tu peux choisir un autre moment avec le bouton ci-dessous.", "changer", liens);
    assert.deepEqual(m.lien, { texte: "Changer mon créneau", url: lien });
    const r = messageAvecBouton("À bientôt peut-être.", "reprendre", liens);
    assert.equal(r.lien?.url, "https://www.peggygirault.fr/rdv-diagnostic/");
  });

  it("l'adresse écrite quand même disparaît du texte", () => {
    const m = messageAvecBouton(`Voilà le lien pour choisir dans l'agenda : ${lien}\nTon rendez-vous reste réservé.`, "changer", liens);
    assert.equal(m.texte, "Voilà le lien pour choisir dans l'agenda.\nTon rendez-vous reste réservé.");
    assert.doesNotMatch(m.texte, /https/);
  });

  it("sans lien connu, pas de bouton", () => {
    assert.deepEqual(messageAvecBouton("Texte", "changer", { changer: null, reprendre: null }), { texte: "Texte" });
  });
});
