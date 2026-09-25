import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { peggy } from "./profils/peggy.ts";
import { rendreModele } from "./profil.ts";
import {
  effaceApres,
  invitationCalendly,
  lireReservation,
  telephoneInternational,
} from "./reservation.ts";

const HEURE = 3_600_000;

function invitation(surcharge: Record<string, unknown> = {}) {
  return invitationCalendly.parse({
    uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
    email: "camille@example.com",
    name: "Camille Dupont",
    created_at: "2026-10-01T08:00:00.000000Z",
    timezone: "Europe/Paris",
    text_reminder_number: null,
    cancel_url: "https://calendly.com/cancellations/I1",
    reschedule_url: "https://calendly.com/reschedulings/I1",
    questions_and_answers: [
      { question: "Ton numéro de téléphone", answer: "06 12 34 56 78", position: 0 },
      { question: "Qu'est-ce qui te pousse à vouloir perdre du poids ?", answer: "Tout essayé", position: 1 },
      {
        question: "Comment tu fonctionnes quand tu décides de changer ?",
        answer: "J'ai besoin d'être accompagnée",
        position: 3,
      },
    ],
    scheduled_event: {
      uri: "https://api.calendly.com/scheduled_events/E1",
      start_time: "2026-10-08T12:00:00.000000Z",
      end_time: "2026-10-08T12:45:00.000000Z",
      event_type: "https://api.calendly.com/event_types/T1",
      location: { type: "zoom", join_url: "https://zoom.us/j/123" },
    },
    ...surcharge,
  });
}

const options = { delaiMinimumMs: 24 * HEURE, recuLe: "2026-10-01T08:00:01Z" };

describe("telephoneInternational", () => {
  it("met un numéro français au format international", () => {
    assert.equal(telephoneInternational("06 12 34 56 78"), "+33612345678");
    assert.equal(telephoneInternational("06.12.34.56.78"), "+33612345678");
    assert.equal(telephoneInternational("+33 6 12 34 56 78"), "+33612345678");
    assert.equal(telephoneInternational("0033612345678"), "+33612345678");
  });

  it("garde un numéro étranger déjà international", () => {
    assert.equal(telephoneInternational("+1 514 555 0199"), "+15145550199");
  });

  it("ne devine rien d'un numéro illisible", () => {
    assert.equal(telephoneInternational("612345678"), null);
    assert.equal(telephoneInternational("pas de numéro"), null);
    assert.equal(telephoneInternational(""), null);
    assert.equal(telephoneInternational(null), null);
  });
});

describe("lireReservation", () => {
  it("lit le téléphone, la façon de décider, la visio et les liens", () => {
    const c = lireReservation(invitation(), peggy, options);
    assert.equal(c.etat, "active");
    assert.equal(c.telephone, "+33612345678");
    assert.equal(c.facon_de_decider, "accompagnee");
    assert.equal(c.lien_visio, "https://zoom.us/j/123");
    assert.equal(c.lien_report, "https://calendly.com/reschedulings/I1");
    assert.equal(c.prenom, "Camille");
    assert.equal(c.nom, "Dupont");
    assert.equal(c.reponses.length, 3);
  });

  it("prend le numéro du rappel SMS quand le formulaire n'en a pas", () => {
    const c = lireReservation(
      invitation({ questions_and_answers: [], text_reminder_number: "+33 7 00 00 00 01" }),
      peggy,
      options,
    );
    assert.equal(c.telephone, "+33700000001");
    assert.equal(c.etat, "active");
  });

  it("laisse hors champ un rendez-vous à moins de 24 h, sans rien garder pour la joindre", () => {
    const c = lireReservation(
      invitation({ created_at: "2026-10-07T13:00:00.000000Z" }),
      peggy,
      options,
    );
    assert.equal(c.etat, "hors_champ");
    assert.equal(c.telephone, null);
    assert.equal(c.email, null);
    assert.deepEqual(c.reponses, []);
  });

  it("laisse hors champ une réservation sans numéro utilisable", () => {
    const c = lireReservation(invitation({ questions_and_answers: [] }), peggy, options);
    assert.equal(c.etat, "hors_champ");
  });

  it("efface 30 jours après la fin du rendez-vous", () => {
    assert.equal(effaceApres("2026-10-08T12:45:00.000Z"), "2026-11-07T12:45:00.000Z");
  });
});

describe("le vrai formulaire de Peggy", () => {
  it("trouve le téléphone et la façon de décider, même en réponse libre", () => {
    const reponses = peggy.formulaire.map((q, position) => ({
      question: q.question,
      answer: position === 0 ? "07 11 22 33 44" : position === 3 ? "Je fonce… et je lâche au bout de trois semaines" : q.exemple,
      position,
    }));
    const c = lireReservation(invitation({ questions_and_answers: reponses }), peggy, options);
    assert.equal(c.telephone, "+33711223344");
    assert.equal(c.facon_de_decider, "fonce");
  });

  it("ne prend aucune autre question pour celle du téléphone ou de la décision", () => {
    const autres = peggy.formulaire.filter((_, i) => i !== 0 && i !== 3);
    for (const q of autres) {
      assert.doesNotMatch(q.question, peggy.questions.telephone, q.question);
      assert.doesNotMatch(q.question, peggy.questions.faconDeDecider, q.question);
    }
  });

  it("lit « j'analyse tout avant, et après j'y vais à fond » comme une analyste", () => {
    const reponses = [
      { question: peggy.formulaire[0].question, answer: "0600000000", position: 0 },
      { question: peggy.formulaire[3].question, answer: "J'analyse tout avant, et après j'y vais à fond", position: 3 },
    ];
    const c = lireReservation(invitation({ questions_and_answers: reponses }), peggy, options);
    assert.equal(c.facon_de_decider, "analyse");
  });
});

describe("les modèles de Peggy", () => {
  it("remplacent leurs variables dans l'ordre déclaré", () => {
    const valeurs = {
      prenom: "Camille",
      jour: "jeudi 8 octobre",
      heure: "14h",
      lienVisio: "https://zoom.us/j/123",
    };
    assert.match(
      rendreModele(peggy.modeles.reservation, valeurs),
      /^Bonjour Camille, [^]*a lieu jeudi 8 octobre à 14h, sur Zoom/,
    );
    assert.match(
      rendreModele(peggy.modeles.matin, valeurs),
      /c'est aujourd'hui à 14h !\nLe lien Zoom pour ton diagnostic : https:\/\/zoom\.us\/j\/123/,
    );
  });

  it("finissent tous sur une question ou un lien, et aucun ne nomme qui reçoit", () => {
    for (const modele of Object.values(peggy.modeles)) {
      assert.doesNotMatch(modele.corps, /\{\{[4-9]\}\}/);
      assert.doesNotMatch(modele.corps, /Mélanie|closeuse/i);
    }
  });
});
