import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planifier, type ConversationPlanning, type EnvoiPasse } from "./planning.ts";
import { instantLocal } from "./temps.ts";

// Paris, octobre 2026 : UTC+2. Réservé le jeudi 1er à 9h pour le jeudi 8 à 14h.
const P = "Europe/Paris";
const t = (jour: string, h: number, m = 0) => instantLocal(jour, h, m, P);
const iso = (n: number) => new Date(n).toISOString();

function conv(surcharge: Partial<ConversationPlanning> = {}): ConversationPlanning {
  return {
    etat: "active",
    reserve_le: iso(t("2026-10-01", 9)),
    rdv_debut: iso(t("2026-10-08", 14)),
    rdv_fin: iso(t("2026-10-08", 14, 45)),
    fuseau: P,
    confirme_le: null,
    derniere_entree_le: null,
    derniere_sortie_le: null,
    sans_reponse_veille: false,
    envois: [],
    ...surcharge,
  };
}

const envoi = (modele: EnvoiPasse["modele"], cle: string, le: number): EnvoiPasse => ({
  modele,
  cle_envoi: cle,
  le: iso(le),
});

const reservation = envoi("reservation", "reservation", t("2026-10-01", 9, 1));

const cles = (actions: ReturnType<typeof planifier>) =>
  actions.map((a) => (a.genre === "envoyer" ? a.cle : a.genre));

describe("planifier — sans aucune réponse", () => {
  it("envoie le premier message tout de suite, même le soir", () => {
    assert.deepEqual(cles(planifier(conv(), t("2026-10-01", 23, 30))), ["reservation"]);
  });

  it("attend deux jours puis rappelle à 10h, pas avant", () => {
    const c = conv({ envois: [reservation] });
    assert.deepEqual(cles(planifier(c, t("2026-10-02", 10))), []);
    assert.deepEqual(cles(planifier(c, t("2026-10-03", 9, 55))), []);
    assert.deepEqual(cles(planifier(c, t("2026-10-03", 10))), ["rappel:2026-10-03"]);
    assert.deepEqual(cles(planifier(c, t("2026-10-03", 20))), [], "pas après 20h");
  });

  it("rappelle encore deux jours après le rappel précédent", () => {
    const c = conv({
      envois: [reservation, envoi("rappel", "rappel:2026-10-03", t("2026-10-03", 10))],
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-04", 12))), []);
    assert.deepEqual(cles(planifier(c, t("2026-10-05", 10, 5))), ["rappel:2026-10-05"]);
  });

  it("ne rappelle pas la veille : c'est le message de la veille qui part", () => {
    const c = conv({
      envois: [reservation, envoi("rappel", "rappel:2026-10-05", t("2026-10-05", 10))],
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-07", 10))), ["veille:2026-10-08"]);
  });

  it("note « sans réponse à la veille » et envoie quand même le lien le matin", () => {
    const c = conv({
      envois: [reservation, envoi("veille", "veille:2026-10-08", t("2026-10-07", 10))],
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-08", 7, 59))), []);
    assert.deepEqual(cles(planifier(c, t("2026-10-08", 8))), [
      "noter_sans_reponse_veille",
      "matin:2026-10-08",
    ]);
  });

  it("n'annule jamais : après le rendez-vous, la conversation se termine, c'est tout", () => {
    const c = conv({ envois: [reservation] });
    assert.deepEqual(cles(planifier(c, t("2026-10-08", 14, 45))), ["terminer"]);
    assert.deepEqual(cles(planifier(c, t("2026-10-08", 14, 10))), []);
  });
});

describe("planifier — elle répond", () => {
  it("un message d'elle repousse le rappel de deux jours", () => {
    const c = conv({ envois: [reservation], derniere_entree_le: iso(t("2026-10-02", 18)), derniere_sortie_le: iso(t("2026-10-02", 18, 1)) });
    assert.deepEqual(cles(planifier(c, t("2026-10-03", 10))), []);
    assert.deepEqual(cles(planifier(c, t("2026-10-04", 10))), ["rappel:2026-10-04"]);
  });

  it("confirmée tôt : une préparation au milieu, puis la veille", () => {
    const c = conv({
      envois: [reservation],
      confirme_le: iso(t("2026-10-01", 9, 30)),
      derniere_entree_le: iso(t("2026-10-01", 9, 30)),
      derniere_sortie_le: iso(t("2026-10-01", 9, 31)),
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-03", 10))), [], "plus de rappel");
    assert.deepEqual(cles(planifier(c, t("2026-10-04", 10))), ["preparation:2026-10-08"]);
    const apres = { ...c, envois: [...c.envois, envoi("preparation", "preparation:2026-10-08", t("2026-10-04", 10))] };
    assert.deepEqual(cles(planifier(apres, t("2026-10-05", 10))), []);
    assert.deepEqual(cles(planifier(apres, t("2026-10-07", 10))), ["veille:2026-10-08"]);
  });

  it("pas de préparation quand confirmation et veille sont à 4 jours ou moins", () => {
    const c = conv({
      envois: [reservation],
      confirme_le: iso(t("2026-10-03", 11)),
      derniere_entree_le: iso(t("2026-10-03", 11)),
      derniere_sortie_le: iso(t("2026-10-03", 11, 1)),
    });
    for (const jour of ["2026-10-04", "2026-10-05", "2026-10-06"]) {
      assert.deepEqual(cles(planifier(c, t(jour, 10))), [], jour);
    }
  });

  it("répondre à la veille évite la mention « sans réponse »", () => {
    const c = conv({
      envois: [reservation, envoi("veille", "veille:2026-10-08", t("2026-10-07", 10))],
      derniere_entree_le: iso(t("2026-10-07", 12)),
      derniere_sortie_le: iso(t("2026-10-07", 12, 1)),
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-08", 8))), ["matin:2026-10-08"]);
  });
});

describe("planifier — répondre", () => {
  it("elle a écrit en dernier : l'agent lui répond avant tout modèle", () => {
    const c = conv({
      envois: [reservation],
      derniere_sortie_le: reservation.le,
      derniere_entree_le: iso(t("2026-10-07", 10, 30)),
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-07", 10, 31))), ["repondre"]);
  });

  it("un message de la nuit attend 8h", () => {
    const c = conv({
      envois: [reservation],
      derniere_sortie_le: reservation.le,
      derniere_entree_le: iso(t("2026-10-02", 23, 10)),
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-02", 23, 15))), []);
    assert.deepEqual(cles(planifier(c, t("2026-10-03", 7, 59))), []);
    assert.deepEqual(cles(planifier(c, t("2026-10-03", 8))), ["repondre"]);
  });

  it("une fois répondu, le planning reprend", () => {
    const c = conv({
      envois: [reservation],
      derniere_entree_le: iso(t("2026-10-01", 9, 30)),
      derniere_sortie_le: iso(t("2026-10-01", 9, 31)),
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-01", 12))), []);
  });

  it("un empêchement écrit juste avant le Zoom reçoit encore une réponse", () => {
    const c = conv({
      envois: [reservation, envoi("matin", "matin:2026-10-08", t("2026-10-08", 8))],
      derniere_sortie_le: iso(t("2026-10-08", 8)),
      derniere_entree_le: iso(t("2026-10-08", 14, 2)),
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-08", 14, 3))), ["repondre"]);
  });
});

describe("planifier — cas limites", () => {
  it("réservé la veille : pas de message de la veille, le lien le matin", () => {
    const c = conv({
      reserve_le: iso(t("2026-10-07", 11)),
      envois: [envoi("reservation", "reservation", t("2026-10-07", 11))],
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-07", 15))), []);
    assert.deepEqual(cles(planifier(c, t("2026-10-08", 8))), ["matin:2026-10-08"]);
  });

  it("rendez-vous à 8h30 : le lien part à 7h30", () => {
    const c = conv({
      rdv_debut: iso(t("2026-10-08", 8, 30)),
      rdv_fin: iso(t("2026-10-08", 9, 15)),
      envois: [reservation],
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-08", 7, 29))), []);
    assert.deepEqual(cles(planifier(c, t("2026-10-08", 7, 30))), ["matin:2026-10-08"]);
  });

  it("un passage manqué de l'horloge se rattrape dans la journée", () => {
    const c = conv({ envois: [reservation] });
    assert.deepEqual(cles(planifier(c, t("2026-10-07", 16))), ["veille:2026-10-08"]);
  });

  it("rien ne part après un STOP, une annulation, ou hors champ", () => {
    for (const etat of ["stop", "annulee", "hors_champ", "terminee"]) {
      assert.deepEqual(planifier(conv({ etat }), t("2026-10-01", 9, 1)), [], etat);
    }
  });

  it("déplacé à une autre date : la veille et le matin repartent pour la nouvelle", () => {
    const c = conv({
      rdv_debut: iso(t("2026-10-12", 14)),
      rdv_fin: iso(t("2026-10-12", 14, 45)),
      confirme_le: iso(t("2026-10-07", 12)),
      envois: [reservation, envoi("veille", "veille:2026-10-08", t("2026-10-07", 10))],
    });
    assert.deepEqual(cles(planifier(c, t("2026-10-11", 10))), ["veille:2026-10-12"]);
  });

  it("l'heure de la cliente, pas celle de Paris", () => {
    const m = "America/Montreal";
    const c = conv({ fuseau: m, envois: [reservation] });
    // 10h à Paris = 4h à Montréal : trop tôt pour elle.
    assert.deepEqual(cles(planifier(c, t("2026-10-03", 10))), []);
    assert.deepEqual(cles(planifier(c, instantLocal("2026-10-03", 10, 0, m))), ["rappel:2026-10-03"]);
  });
});
