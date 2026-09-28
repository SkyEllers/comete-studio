import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  horodatage,
  lireResume,
  poids,
  texteACopier,
  typeDuFichier,
  versRepliques,
} from "./enregistrement-format.ts";

describe("Enregistrement du diagnostic : la transcription", () => {
  it("garde qui parle, quand et quoi, et rien d'autre", () => {
    const r = versRepliques([
      { speaker: "A", start: 1200.4, end: 5000, text: " Bonjour Sylvie. ", confidence: 0.9, words: [{}] },
      { speaker: "B", start: 5100, end: 9000, text: "Bonjour !" },
    ]);
    assert.deepEqual(r, [
      { qui: "A", debut: 1200, fin: 5000, texte: "Bonjour Sylvie." },
      { qui: "B", debut: 5100, fin: 9000, texte: "Bonjour !" },
    ]);
  });

  it("écarte les répliques vides et ce qui n'est pas une liste", () => {
    assert.deepEqual(versRepliques(null), []);
    assert.deepEqual(versRepliques("x"), []);
    assert.deepEqual(versRepliques([{ speaker: "A", text: "   " }, null, 3]), []);
    assert.deepEqual(versRepliques([{ text: "Oui" }]), [{ qui: "?", debut: 0, fin: 0, texte: "Oui" }]);
  });

  it("l'heure dans l'appel se lit en minutes, puis en heures", () => {
    assert.equal(horodatage(0), "0:00");
    assert.equal(horodatage(65_000), "1:05");
    assert.equal(horodatage(3_725_000), "1:02:05");
  });

  it("le texte à copier : un titre, puis une réplique par paragraphe", () => {
    const t = texteACopier(
      [
        { qui: "A", debut: 0, fin: 1, texte: "Bonjour." },
        { qui: "B", debut: 61_000, fin: 62_000, texte: "Merci." },
      ],
      "Diagnostic de Sylvie",
    );
    assert.equal(t, "Diagnostic de Sylvie\n\nVoix A (0:00) : Bonjour.\n\nVoix B (1:01) : Merci.");
  });
});

describe("Enregistrement du diagnostic : le reste", () => {
  it("le résumé relu de la base a toujours ses quatre champs", () => {
    assert.deepEqual(lireResume({ probleme: "Ventre", objectif: 3 }), {
      probleme: "Ventre",
      objectif: "",
      freins: "",
      propose: "",
    });
    assert.equal(lireResume(null), null);
    assert.equal(lireResume([]), null);
  });

  it("le type d'un fichier sans type connu du navigateur se lit à son extension", () => {
    assert.equal(typeDuFichier("zoom.mp4", "video/mp4"), "video/mp4");
    assert.equal(typeDuFichier("audio_only.m4a", ""), "audio/mp4");
    assert.equal(typeDuFichier("Réunion.MOV", ""), "video/quicktime");
    assert.equal(typeDuFichier("notes.pdf", "application/pdf"), null);
  });

  it("le poids en Mo, puis en Go", () => {
    assert.equal(poids(412 * 1024 ** 2), "412 Mo");
    assert.equal(poids(1.25 * 1024 ** 3), "1,3 Go");
    assert.equal(poids(10), "1 Mo");
  });
});
