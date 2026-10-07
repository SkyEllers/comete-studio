import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ficheEnregistree, lignesFiche, mailCloseuse, mailTitulaire, manqueR2, type DemandeR2 } from "./regles.ts";

const complete: DemandeR2 = {
  fiche: { venue: "Comprendre ses troubles digestifs.", questions: "Avec quel laboratoire travaillez-vous ?" },
  freins: ["competence", "budget"],
  prete: "oui",
  joindre: "En semaine après 18h",
  telephone: "06 12 34 56 78",
};

describe("R2 : la demande de la closeuse", () => {
  it("exige pourquoi elle est venue, ses questions, quand la joindre et un numéro", () => {
    assert.equal(manqueR2(complete), null);
    assert.match(manqueR2({ ...complete, fiche: { ...complete.fiche, venue: " " } }) ?? "", /pourquoi elle est venue/);
    assert.match(manqueR2({ ...complete, fiche: { venue: "x" } }) ?? "", /questions exactes/);
    assert.match(manqueR2({ ...complete, joindre: "" }) ?? "", /joindre/);
    assert.match(manqueR2({ ...complete, telephone: "06 12" }) ?? "", /numéro/);
  });

  it("refuse un R2 sans intention d'avancer (protocole de Peggy)", () => {
    assert.match(manqueR2({ ...complete, prete: "non" }) ?? "", /pas un R2 de vente/);
    assert.equal(manqueR2({ ...complete, prete: "a_preciser" }), null);
  });

  it("garde la fiche dans l'ordre du protocole, freins et réponse après les questions", () => {
    const fiche = ficheEnregistree(complete);
    assert.deepEqual(
      lignesFiche(fiche).map((l) => l.libelle),
      [
        "Pourquoi elle est venue",
        "Ses questions exactes pour Peggy",
        "Frein principal",
        "Si Peggy répond, prête à envisager l'accompagnement ?",
      ],
    );
    assert.equal(lignesFiche(fiche)[2].texte, "Compétence, crédibilité, Budget");
  });
});

describe("R2 : les mails", () => {
  it("donne à la titulaire le numéro, quand appeler et la fiche, sans HTML injecté", () => {
    const m = mailTitulaire({
      prenomTitulaire: "Peggy",
      cliente: "Muriel <b>B.</b>",
      closeuse: "Marion",
      quandRdv: "le mercredi 7 octobre",
      telephone: "06 12 34 56 78",
      joindre: "En semaine après 18h",
      fiche: ficheEnregistree(complete),
      lienRadar: "https://app.cometestudio.fr/app/peggy/resultats",
    });
    assert.match(m.texte, /Téléphone : 06 12 34 56 78/);
    assert.match(m.texte, /Avec quel laboratoire/);
    assert.match(m.html, /tel:0612345678/);
    assert.doesNotMatch(m.html, /<b>B\.<\/b>/);
  });

  it("dit à la closeuse d'envoyer le devis si la cliente veut démarrer", () => {
    const oui = mailCloseuse({
      prenomCloseuse: "Marion",
      titulaire: "Peggy",
      cliente: "Muriel",
      resultat: "demarrer",
      note: null,
      lienEspace: "https://app.cometestudio.fr/app/peggy/closeuse",
    });
    assert.match(oui.sujet, /veut démarrer/);
    assert.match(oui.texte, /envoyer le devis/);
    const non = mailCloseuse({ ...{ prenomCloseuse: "Marion", titulaire: "Peggy", cliente: "Muriel", lienEspace: "x" }, resultat: "non", note: "Pas le budget." });
    assert.doesNotMatch(non.texte, /devis/);
    assert.match(non.texte, /Pas le budget\./);
  });
});
