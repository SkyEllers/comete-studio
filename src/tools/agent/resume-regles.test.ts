import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { etatEnMots, mailDuResume, notesEnMots, type DiagnosticDuJour } from "./resume-regles.ts";

const P = "Europe/Paris";

const diag = (surcharge: Partial<DiagnosticDuJour> = {}): DiagnosticDuJour => ({
  rdv_debut: "2026-10-02T08:00:00.000Z", // 10h à Paris
  prenom: "Sandrine",
  fuseau: P,
  etat: "active",
  confirme_le: null,
  reports_agent: 0,
  deplace: false,
  sans_reponse_veille: false,
  simulation: false,
  notes: [],
  ...surcharge,
});

describe("où en est le rendez-vous", () => {
  it("confirmé", () => assert.equal(etatEnMots(diag({ confirme_le: "x" })), "Confirmé."));
  it("reporté puis confirmé", () =>
    assert.equal(etatEnMots(diag({ confirme_le: "x", reports_agent: 1 })), "Reporté, puis confirmé."));
  it("déplacé par elle, puis confirmé", () =>
    assert.equal(etatEnMots(diag({ confirme_le: "x", deplace: true })), "Reporté, puis confirmé."));
  it("sans réponse à la veille", () =>
    assert.equal(
      etatEnMots(diag({ sans_reponse_veille: true })),
      "Sans réponse depuis la veille. Le lien Zoom lui part ce matin.",
    ));
  it("pas encore confirmé", () => assert.equal(etatEnMots(diag()), "Pas encore confirmé."));
  it("STOP : le rendez-vous tient", () => assert.match(etatEnMots(diag({ etat: "stop" })), /Le rendez-vous tient/));
  it("réservé trop près", () => assert.match(etatEnMots(diag({ etat: "hors_champ" })), /ne lui a pas écrit/));
});

describe("ce qu'elle a dit", () => {
  it("rien", () => assert.equal(notesEnMots([]), "rien de particulier."));
  it("dédoublonne et ponctue", () =>
    assert.equal(
      notesEnMots(["Hypothyroïdie, renvoyée vers son médecin", "Hypothyroïdie, renvoyée vers son médecin", " "]),
      "hypothyroïdie, renvoyée vers son médecin.",
    ));
  it("garde un sigle en tête", () => assert.equal(notesEnMots(["IMC élevé"]), "IMC élevé."));
  it("garde la ponctuation d'origine", () =>
    assert.equal(notesEnMots(["Veut comprendre pourquoi elle stagne ?", "Budget serré."]), "veut comprendre pourquoi elle stagne ? Budget serré."));
});

describe("le mail du matin", () => {
  it("rien quand la journée est vide", () => {
    assert.equal(mailDuResume({ jour: "2026-10-02", fuseau: P, diagnostics: [] }), null);
  });

  it("trois lignes par diagnostic, dans l'ordre de la journée", () => {
    const m = mailDuResume({
      jour: "2026-10-02",
      fuseau: P,
      diagnostics: [
        diag({ rdv_debut: "2026-10-02T13:30:00.000Z", prenom: "Nadia", confirme_le: "x" }),
        diag({ notes: ["Hypothyroïdie, renvoyée vers son médecin"] }),
      ],
    });
    assert.ok(m);
    assert.equal(m.sujet, "Tes 2 diagnostics du vendredi 2 octobre");
    assert.ok(m.texte.indexOf("10h · Sandrine") < m.texte.indexOf("15h30 · Nadia"));
    assert.match(m.texte, /Ce qu'elle a dit : hypothyroïdie, renvoyée vers son médecin\./);
    assert.match(m.texte, /15h30 · Nadia\nCe qu'elle a dit : Rien de particulier\.\nConfirmé\./);
  });

  it("au singulier pour un seul", () => {
    const m = mailDuResume({ jour: "2026-10-02", fuseau: P, diagnostics: [diag()] });
    assert.equal(m?.sujet, "Ton diagnostic du vendredi 2 octobre");
  });

  it("le test se voit, la simulation aussi", () => {
    const m = mailDuResume({ jour: "2026-10-02", fuseau: P, diagnostics: [diag({ simulation: true })], test: true });
    assert.ok(m?.sujet.startsWith("[Test] "));
    assert.match(m?.texte ?? "", /Sandrine \(simulation\)/);
  });

  it("échappe le HTML de ce qu'elle a dit", () => {
    const m = mailDuResume({ jour: "2026-10-02", fuseau: P, diagnostics: [diag({ notes: ["<script>x</script>"] })] });
    assert.ok(!m?.html.includes("<script>"));
  });
});
