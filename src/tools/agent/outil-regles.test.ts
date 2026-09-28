import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  estDeLOutil,
  idOutil,
  invitationDepuisRdv,
  lienMonRdv,
  lireLienPersonnel,
  TYPE_OUTIL,
  uriOutil,
  veilleMailDue,
  type RdvOutil,
} from "./outil-regles.ts";
import { invitationCalendly, lireReservation } from "./reservation.ts";
import { peggy } from "./profils/peggy.ts";

const rdv: RdvOutil = {
  id: "5b8f7c1e-0000-4000-8000-000000000001",
  debut: "2026-10-08 12:00:00+00",
  fin: "2026-10-08 12:45:00+00",
  created_at: "2026-09-28T09:00:00.000Z",
  prenom: "Camille",
  nom: "Test",
  email: "camille@example.com",
  telephone: "+33612345678",
  fuseau_cliente: "Europe/Paris",
  lien_visio: "https://zoom.us/j/123",
  reponses: [
    { question: "Ton numéro de téléphone (pour le rappel du rdv et des conseils via WhatsApp)", reponse: "06 12 34 56 78" },
    { question: "Comment tu fonctionnes quand tu décides de changer ?", reponse: "J'ai besoin d'être accompagnée" },
  ],
};

describe("Agent — un rendez-vous de l'outil maison", () => {
  it("se reconnaît à son préfixe, comme dans Radar", () => {
    assert.equal(uriOutil("abc"), "reservation:abc");
    assert.equal(estDeLOutil("reservation:abc"), true);
    assert.equal(estDeLOutil("https://api.calendly.com/scheduled_events/x/invitees/y"), false);
    assert.equal(estDeLOutil(null), false);
    assert.equal(idOutil("reservation:abc"), "abc");
    assert.equal(idOutil("reservation:"), null);
    assert.equal(idOutil("https://api.calendly.com/x"), null);
  });

  it("le lien personnel pointe vers /mon-rdv/ du site, après le #", () => {
    assert.equal(
      lienMonRdv("https://www.peggygirault.fr/tarifs/", "a".repeat(64)),
      `https://www.peggygirault.fr/mon-rdv/#${"a".repeat(64)}`,
    );
    assert.equal(lienMonRdv(null, "x"), null);
    assert.equal(lienMonRdv("https://www.peggygirault.fr/", null), null);
  });

  it("se traduit en une invitation que l'agent sait lire", () => {
    const invite = invitationDepuisRdv(rdv, { lienPersonnel: "https://www.peggygirault.fr/mon-rdv/#x" });
    assert.equal(invitationCalendly.safeParse(invite).success, true);
    assert.equal(invite.uri, "reservation:5b8f7c1e-0000-4000-8000-000000000001");
    assert.equal(invite.scheduled_event.uri, invite.uri);
    assert.equal(invite.scheduled_event.event_type, TYPE_OUTIL);
    assert.equal(invite.scheduled_event.start_time, "2026-10-08T12:00:00.000Z");
    assert.equal(invite.scheduled_event.location?.join_url, "https://zoom.us/j/123");
    assert.equal(invite.reschedule_url, "https://www.peggygirault.fr/mon-rdv/#x");
    assert.equal(invite.old_invitee, null);
    assert.deepEqual(invite.questions_and_answers?.[1], {
      question: "Comment tu fonctionnes quand tu décides de changer ?",
      answer: "J'ai besoin d'être accompagnée",
      position: 1,
    });
  });

  it("un report désigne l'ancien rendez-vous", () => {
    const invite = invitationDepuisRdv(rdv, { lienPersonnel: null, ancienRdvId: "ancien" });
    assert.equal(invite.old_invitee, "reservation:ancien");
  });

  it("ouvre une conversation suivie : numéro, façon de décider, lien de report", () => {
    const invite = invitationDepuisRdv(rdv, { lienPersonnel: "https://www.peggygirault.fr/mon-rdv/#x" });
    const c = lireReservation(invite, peggy, { delaiMinimumMs: 24 * 3_600_000, recuLe: rdv.created_at });
    assert.equal(c.etat, "active");
    assert.equal(c.telephone, "+33612345678");
    assert.equal(c.facon_de_decider, "accompagnee");
    assert.equal(c.lien_report, "https://www.peggygirault.fr/mon-rdv/#x");
    assert.equal(c.lien_visio, "https://zoom.us/j/123");
    assert.equal(c.event_type_uri, TYPE_OUTIL);
  });

  it("sans réponse du numéro, le téléphone de la réservation sert", () => {
    const sansQuestion = { ...rdv, reponses: [] };
    const c = lireReservation(invitationDepuisRdv(sansQuestion, { lienPersonnel: null }), peggy, {
      delaiMinimumMs: 24 * 3_600_000,
      recuLe: rdv.created_at,
    });
    assert.equal(c.telephone, "+33612345678");
  });

  it("à moins de 24 h, hors champ, comme avec Calendly", () => {
    const proche = { ...rdv, debut: "2026-09-28 20:00:00+00", fin: "2026-09-28 20:45:00+00" };
    const c = lireReservation(invitationDepuisRdv(proche, { lienPersonnel: null }), peggy, {
      delaiMinimumMs: 24 * 3_600_000,
      recuLe: rdv.created_at,
    });
    assert.equal(c.etat, "hors_champ");
    assert.equal(c.telephone, null);
  });
});

describe("Agent — le lien personnel et le mail de la veille", () => {
  it("lit le site et le jeton du lien /mon-rdv/", () => {
    const j = "b".repeat(64);
    assert.deepEqual(lireLienPersonnel(`https://www.peggygirault.fr/mon-rdv/#${j}`), {
      site: "https://www.peggygirault.fr",
      jeton: j,
    });
    assert.equal(lireLienPersonnel("https://calendly.com/reschedulings/x"), null);
    assert.equal(lireLienPersonnel(`http://www.peggygirault.fr/mon-rdv/#${j}`), null);
    assert.equal(lireLienPersonnel("https://www.peggygirault.fr/mon-rdv/#court"), null);
    assert.equal(lireLienPersonnel(null), null);
  });

  // Rendez-vous le jeudi 8 octobre à 14h, heure de Paris (UTC+2).
  const c = { rdv_debut: "2026-10-08T12:00:00.000Z", fuseau: "Europe/Paris", veille_mail_le: null };
  const paris = (jour: string, h: number) => Date.parse(`${jour}T${String(h - 2).padStart(2, "0")}:00:00.000Z`);

  it("part la veille, de 10h à 21h, heure de la cliente", () => {
    assert.equal(veilleMailDue(c, paris("2026-10-07", 9)), false);
    assert.equal(veilleMailDue(c, paris("2026-10-07", 10)), true);
    assert.equal(veilleMailDue(c, paris("2026-10-07", 20)), true);
    assert.equal(veilleMailDue(c, paris("2026-10-07", 21)), false);
  });

  it("ni l'avant-veille, ni le jour même, ni deux fois", () => {
    assert.equal(veilleMailDue(c, paris("2026-10-06", 12)), false);
    assert.equal(veilleMailDue(c, paris("2026-10-08", 10)), false);
    assert.equal(veilleMailDue({ ...c, veille_mail_le: "2026-10-07T08:00:00.000Z" }, paris("2026-10-07", 12)), false);
  });
});
