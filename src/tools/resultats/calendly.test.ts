/**
 * Le nom de l'invité, seule donnée nominative que Radar accepte.
 *
 * Les payloads de recette n'en éprouvent qu'une branche — celle du repli sur
 * `name`, parce que c'est celle-là que les fixtures portent. Les deux autres
 * arrivent pourtant chez de vrais clients : un formulaire Calendly en deux
 * champs renseigne `first_name` et `last_name`, et un invité ajouté à la main
 * peut n'avoir aucun des trois. Elles se déroulent ici en quelques
 * microsecondes plutôt que d'attendre le premier rendez-vous qui les révèle.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { motifAnnulation, nomInvite, quiAAnnule } from "./calendly.ts";

describe("nomInvite — les trois cas de la décision 8", () => {
  it("1. prend first_name et last_name quand Calendly les donne", () => {
    assert.deepEqual(nomInvite({ first_name: "Camille", last_name: "Dupont" }), {
      prenom: "Camille",
      nom: "Dupont",
    });
  });

  it("2. les préfère au nom complet, qui peut être formaté autrement", () => {
    assert.deepEqual(
      nomInvite({ first_name: "Camille", last_name: "Dupont", name: "DUPONT, Camille" }),
      { prenom: "Camille", nom: "Dupont" },
    );
  });

  it("3. se replie sur name, découpé au premier espace", () => {
    assert.deepEqual(nomInvite({ first_name: null, last_name: null, name: "Camille Dupont" }), {
      prenom: "Camille",
      nom: "Dupont",
    });
  });

  it("4. le découpage au premier espace garde les noms composés entiers", () => {
    assert.deepEqual(nomInvite({ name: "Jean Pierre Martin Blanc" }), {
      prenom: "Jean",
      nom: "Pierre Martin Blanc",
    });
  });

  it("5. un nom d'un seul mot est un prénom", () => {
    assert.deepEqual(nomInvite({ name: "Camille" }), { prenom: "Camille", nom: "" });
  });

  it("6. rien du tout : deux chaînes vides, et la vie continue", () => {
    assert.deepEqual(nomInvite({}), { prenom: "", nom: "" });
    assert.deepEqual(nomInvite({ first_name: null, last_name: null, name: null }), {
      prenom: "",
      nom: "",
    });
  });
});

describe("nomInvite — ce que la base accepte", () => {
  it("7. les espaces de bord ne comptent pas comme un nom", () => {
    assert.deepEqual(nomInvite({ first_name: "   ", last_name: "  ", name: "  Camille Dupont " }), {
      prenom: "Camille",
      nom: "Dupont",
    });
  });

  it("8. un prénom seul suffit à ne pas déclencher le repli", () => {
    assert.deepEqual(nomInvite({ first_name: "Camille", last_name: null, name: "Autre Chose" }), {
      prenom: "Camille",
      nom: "",
    });
  });

  it("9. rien ne dépasse 80 caractères, la limite des colonnes", () => {
    const long = "a".repeat(200);
    const depuisChamps = nomInvite({ first_name: long, last_name: long });
    assert.equal(depuisChamps.prenom.length, 80);
    assert.equal(depuisChamps.nom.length, 80);

    const depuisNom = nomInvite({ name: `${long} ${long}` });
    assert.equal(depuisNom.prenom.length, 80);
    assert.equal(depuisNom.nom.length, 80);
  });

  it("10. un nom de plus de 80 caractères sans espace ne perd pas son début", () => {
    const { prenom, nom } = nomInvite({ name: "b".repeat(120) });
    assert.equal(prenom, "b".repeat(80));
    assert.equal(nom, "");
  });
});

describe("quiAAnnule — les deux seules réponses que Calendly donne", () => {
  it("1. host, c'est le client depuis son propre agenda", () => {
    assert.equal(quiAAnnule({ canceler_type: "host" }), "host");
  });

  it("2. invitee, c'est la personne qui avait réservé", () => {
    assert.equal(quiAAnnule({ canceler_type: "invitee" }), "invitee");
  });

  it("3. un champ absent ne se fait pas passer pour une réponse", () => {
    assert.equal(quiAAnnule({}), null);
    assert.equal(quiAAnnule(null), null);
    assert.equal(quiAAnnule(undefined), null);
  });

  it("4. une valeur inconnue de Calendly tombe sur null, pas sur host", () => {
    assert.equal(quiAAnnule({ canceler_type: "ADMIN" }), null);
    assert.equal(quiAAnnule({ canceler_type: "" }), null);
  });
});

describe("motifAnnulation — ce que la fiche affiche", () => {
  it("1. une reprogrammation passe avant le par-qui : le rendez-vous n'est pas perdu", () => {
    assert.equal(motifAnnulation(true, "host"), "Reprogrammée depuis Calendly");
    assert.equal(motifAnnulation(true, "invitee"), "Reprogrammée depuis Calendly");
  });

  it("2. annulée par le client, depuis son agenda", () => {
    assert.equal(motifAnnulation(false, "host"), "Annulée par toi dans Calendly");
  });

  it("3. annulée par la personne qui avait réservé", () => {
    assert.equal(motifAnnulation(false, "invitee"), "Annulée par la personne");
  });

  it("4. sans le par-qui, le libellé d'avant : un vieux message ne ment pas", () => {
    assert.equal(motifAnnulation(false, null), "Annulée dans Calendly");
    assert.equal(motifAnnulation(false), "Annulée dans Calendly");
    assert.equal(motifAnnulation(null), "Annulée dans Calendly");
  });
});
