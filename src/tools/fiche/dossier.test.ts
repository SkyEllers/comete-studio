import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dossierACopier, type Dossier } from "./dossier.ts";

const base: Dossier = {
  nom: "Sophie Martin",
  diagnosticLe: "2026-10-06T13:00:00.000Z",
  closeuse: "Camille",
  objet: "Retrouver de l'énergie et perdre 8 kg",
  reponses: [{ question: "Qu'est-ce qui te pèse le plus ?", reponse: "La fatigue" }],
  enregistrement: {
    sansEnregistrement: false,
    resume: null,
    transcriptionEtat: "faite",
    transcription: [
      { qui: "A", debut: 0, fin: 4000, texte: "Bonjour Sophie." },
      { qui: "B", debut: 4000, fin: 9000, texte: "Bonjour !" },
    ],
  },
};

describe("dossierACopier", () => {
  it("met tout dans un seul texte, dans l'ordre", () => {
    const { texte, manque } = dossierACopier(base);
    assert.deepEqual(manque, []);
    assert.ok(texte.startsWith("Dossier de Sophie Martin\nDiagnostic du 6 octobre 2026, avec Camille."));
    assert.ok(texte.includes("« Retrouver de l'énergie et perdre 8 kg »"));
    const q = texte.indexOf("Question : Qu'est-ce qui te pèse le plus ?\nSa réponse : La fatigue");
    const t = texte.indexOf("Voix A (0:00) : Bonjour Sophie.");
    assert.ok(q > 0 && t > q);
  });

  it("dit ce qui manque, sans rien inventer", () => {
    const { texte, manque } = dossierACopier({
      ...base,
      reponses: [],
      objet: null,
      enregistrement: { ...base.enregistrement!, transcriptionEtat: "en_cours", transcription: null },
    });
    assert.deepEqual(manque, ["pas de réponses au questionnaire", "transcription du diagnostic pas encore prête"]);
    assert.ok(!texte.includes("QUESTIONNAIRE"));
    assert.ok(!texte.includes("TRANSCRIPTION"));
  });

  it("prend le résumé écrit quand il n'y a pas d'enregistrement", () => {
    const { texte, manque } = dossierACopier({
      ...base,
      enregistrement: {
        sansEnregistrement: true,
        resume: { probleme: "Fatiguée", objectif: "Perdre 8 kg", freins: "", propose: "9 mois" },
        transcriptionEtat: "aucune",
        transcription: null,
      },
    });
    assert.deepEqual(manque, []);
    assert.ok(texte.includes("Son problème : Fatiguée"));
    assert.ok(!texte.includes("Ses freins"));
  });

  it("sans enregistrement du tout", () => {
    assert.deepEqual(dossierACopier({ ...base, enregistrement: null }).manque, ["pas d'enregistrement du diagnostic"]);
  });
});
