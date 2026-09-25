import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { finDeFenetre, mailDeLaFile, sansPrenom } from "./file-regles.ts";

describe("le mail de la file", () => {
  const lien = "https://app.cometestudio.fr/admin/agent/file";

  it("ne dit que le client et le genre, jamais ce qu'elle a écrit", () => {
    const m = mailDeLaFile({ genre: "incertain", client: "Peggy Girault", simulation: false, lien });
    assert.equal(m.sujet, "[Agent Peggy Girault] Une question t'attend");
    assert.match(m.texte, /admin\/agent\/file/);
    assert.match(m.html, /href="https:\/\/app\.cometestudio\.fr\/admin\/agent\/file"/);
  });

  it("annonce la détresse et le 3114 dans le sujet", () => {
    const m = mailDeLaFile({ genre: "detresse", client: "Peggy Girault", simulation: false, lien });
    assert.match(m.sujet, /Détresse : le 3114 est parti/);
    assert.match(m.texte, /Rien à faire de ton côté/);
  });

  it("marque une simulation", () => {
    const m = mailDeLaFile({ genre: "incertain", client: "Peggy Girault", simulation: true, lien });
    assert.ok(m.sujet.startsWith("[Simulation] "));
  });

  it("échappe le HTML", () => {
    const m = mailDeLaFile({ genre: "incertain", client: "X", simulation: false, lien: 'https://a.fr/"<b>' });
    assert.ok(!m.html.includes('"<b>'));
  });
});

describe("la fenêtre de 24 h", () => {
  it("part de son dernier message", () => {
    assert.equal(finDeFenetre("2026-09-25T10:00:00.000Z"), Date.parse("2026-09-26T10:00:00.000Z"));
  });

  it("n'existe pas si elle n'a jamais écrit", () => {
    assert.equal(finDeFenetre(null), null);
  });
});

describe("une réponse fixe sans prénom", () => {
  it("retire le prénom, quelle que soit la casse", () => {
    assert.equal(
      sansPrenom("Oui Sandrine, et SANDRINE peut venir.", "Sandrine"),
      "Oui [prénom], et [prénom] peut venir.",
    );
  });

  it("ne touche pas un mot qui le contient", () => {
    assert.equal(sansPrenom("Annabelle et Anna", "Anna"), "Annabelle et [prénom]");
  });

  it("garde les accents et les prénoms composés", () => {
    assert.equal(sansPrenom("Merci Marie-Hélène !", "Marie-Hélène"), "Merci [prénom] !");
    assert.equal(sansPrenom("Bonjour Élodie", "élodie"), "Bonjour [prénom]");
  });

  it("laisse le texte tel quel pour un prénom d'une lettre", () => {
    assert.equal(sansPrenom("A bientôt", "A"), "A bientôt");
  });
});
