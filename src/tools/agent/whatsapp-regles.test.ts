import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { peggy } from "./profils/peggy.ts";
import { mailEchecEnvoi } from "./file-regles.ts";
import {
  codeRefus,
  corpsModele,
  corpsTexte,
  depuisMeta,
  lireWebhook,
  nomModeleMeta,
  raisonRefus,
  refusDefinitif,
  signatureValide,
  suiviAvance,
  versMeta,
} from "./whatsapp-regles.ts";

const valeurs = { prenom: "Camille", jour: "jeudi 8 octobre", heure: "14h", lienVisio: "https://zoom.us/j/1", titreContenu: "", lienContenu: "" };

describe("WhatsApp — ce qui part", () => {
  it("un modèle part sous son nom Meta, en français, variables dans l'ordre", () => {
    const corps = corpsModele("+33612345678", "reservation", peggy.modeles.reservation, valeurs);
    assert.equal(corps.to, "33612345678");
    assert.equal(corps.template.name, "diag_reservation");
    assert.equal(corps.template.language.code, "fr");
    assert.deepEqual(
      corps.template.components[0].parameters.map((p) => p.text),
      ["Camille", "jeudi 8 octobre", "14h"],
    );
  });

  it("le modèle du matin porte l'heure puis le lien", () => {
    const corps = corpsModele("+33612345678", "matin", peggy.modeles.matin, valeurs);
    assert.equal(nomModeleMeta("matin"), corps.template.name);
    assert.deepEqual(
      corps.template.components[0].parameters.map((p) => p.text),
      ["Camille", "14h", "https://zoom.us/j/1"],
    );
  });

  it("un message libre part en texte", () => {
    const corps = corpsTexte("+33612345678", "Bonjour");
    assert.equal(corps.type, "text");
    assert.equal(corps.text.body, "Bonjour");
  });

  it("le numéro passe d'un format à l'autre", () => {
    assert.equal(versMeta("+33612345678"), "33612345678");
    assert.equal(depuisMeta("33612345678"), "+33612345678");
    assert.equal(depuisMeta("+33612345678"), "+33612345678");
  });

  it("un refus de Meta se lit avec sa raison", () => {
    const r = raisonRefus(
      { error: { code: 131047, message: "Re-engagement message", error_user_msg: "Plus de 24 h" } },
      400,
    );
    assert.match(r, /HTTP 400 · 131047 · Re-engagement message · Plus de 24 h/);
    assert.equal(raisonRefus("n'importe quoi", 502), "HTTP 502");
  });
});

describe("WhatsApp — la signature", () => {
  const secret = "cle-de-test";
  const corps = '{"object":"whatsapp_business_account","entry":[]}';
  const bonne = `sha256=${createHmac("sha256", secret).update(corps).digest("hex")}`;

  it("accepte la signature de Meta", () => {
    assert.equal(signatureValide(corps, bonne, secret), true);
  });
  it("refuse une signature fausse, absente ou mal formée", () => {
    assert.equal(signatureValide(corps + " ", bonne, secret), false);
    assert.equal(signatureValide(corps, null, secret), false);
    assert.equal(signatureValide(corps, "sha1=abc", secret), false);
    assert.equal(signatureValide(corps, bonne, "autre-cle"), false);
  });
});

const enveloppe = (value: unknown) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1367595148781611", changes: [{ field: "messages", value }] }],
});
const metadata = { display_phone_number: "33652621466", phone_number_id: "1327291337134730" };

describe("WhatsApp — ce qui arrive", () => {
  it("un texte, un bouton, un vocal", () => {
    const lu = lireWebhook(
      enveloppe({
        messaging_product: "whatsapp",
        metadata,
        contacts: [{ profile: { name: "Camille" }, wa_id: "33612345678" }],
        messages: [
          { from: "33612345678", id: "wamid.1", timestamp: "1", type: "text", text: { body: "Oui merci" } },
          { from: "33612345678", id: "wamid.2", timestamp: "2", type: "button", button: { text: "Je dois changer", payload: "Je dois changer" } },
          { from: "33612345678", id: "wamid.3", timestamp: "3", type: "audio", audio: { id: "x" } },
        ],
      }),
    );
    assert.ok(lu);
    assert.deepEqual(
      lu.entrees.map((e) => [e.idExterne, e.de, e.texte, e.numeroId]),
      [
        ["wamid.1", "+33612345678", "Oui merci", "1327291337134730"],
        ["wamid.2", "+33612345678", "Je dois changer", "1327291337134730"],
        ["wamid.3", "+33612345678", "[Elle a envoyé un message vocal]", "1327291337134730"],
      ],
    );
  });

  it("le suivi : distribué, lu, échec avec sa raison ; « envoyé » ignoré", () => {
    const lu = lireWebhook(
      enveloppe({
        messaging_product: "whatsapp",
        metadata,
        statuses: [
          { id: "wamid.a", status: "sent", timestamp: "1", recipient_id: "33612345678" },
          { id: "wamid.a", status: "delivered", timestamp: "2", recipient_id: "33612345678" },
          { id: "wamid.a", status: "read", timestamp: "3", recipient_id: "33612345678" },
          { id: "wamid.b", status: "failed", timestamp: "4", recipient_id: "33612345678", errors: [{ code: 131026, title: "Message undeliverable" }] },
        ],
      }),
    );
    assert.ok(lu);
    assert.deepEqual(
      lu.suivis.map((s) => [s.idExterne, s.statut, s.erreur]),
      [
        ["wamid.a", "distribue", null],
        ["wamid.a", "lu", null],
        ["wamid.b", "echec", "131026 · Message undeliverable"],
      ],
    );
  });

  it("un champ inconnu ne fait rien perdre ; un autre objet est ignoré", () => {
    const lu = lireWebhook({
      ...enveloppe({ metadata, nouveau: true, messages: [{ from: "33600000000", id: "w", type: "text", text: { body: "a" }, nouveau: 1 }] }),
      nouveau: "champ",
    });
    assert.equal(lu?.entrees.length, 1);
    assert.equal(lireWebhook({ object: "page", entry: [] }), null);
    assert.equal(lireWebhook(null), null);
  });

  it("un suivi ne fait jamais reculer un message", () => {
    assert.equal(suiviAvance("envoye", "distribue"), true);
    assert.equal(suiviAvance("distribue", "lu"), true);
    assert.equal(suiviAvance("lu", "distribue"), false);
    assert.equal(suiviAvance("envoye", "lu"), true);
    assert.equal(suiviAvance("lu", "echec"), true);
    assert.equal(suiviAvance("echec", "echec"), false);
    assert.equal(suiviAvance("recu", "lu"), false);
  });
});

describe("WhatsApp — un refus se retente ou non", () => {
  it("Meta en panne, débordé, limite de débit : on retente", () => {
    assert.equal(refusDefinitif(500, null), false);
    assert.equal(refusDefinitif(503, 131016), false);
    assert.equal(refusDefinitif(429, null), false);
    assert.equal(refusDefinitif(400, 130429), false);
    assert.equal(refusDefinitif(400, 131000), false);
    assert.equal(refusDefinitif(400, 131056), false);
  });
  it("numéro sans WhatsApp, modèle absent, paiement, fenêtre passée, jeton : on arrête", () => {
    assert.equal(refusDefinitif(400, 131026), true);
    assert.equal(refusDefinitif(404, 132001), true);
    assert.equal(refusDefinitif(400, 131042), true);
    assert.equal(refusDefinitif(400, 131047), true);
    assert.equal(refusDefinitif(401, 190), true);
    assert.equal(refusDefinitif(400, null), true);
  });
  it("le code se lit dans la réponse de Meta", () => {
    assert.equal(codeRefus({ error: { code: 131026, message: "x" } }), 131026);
    assert.equal(codeRefus({ autre: 1 }), null);
  });
  it("le mail à Louis ne porte ni prénom ni numéro, et échappe le HTML", () => {
    const m = mailEchecEnvoi({ client: "Peggy", erreur: "HTTP 400 · 131026 · <b>x</b>", lien: "https://app/x" });
    assert.match(m.sujet, /\[Agent Peggy\] Un message n'est pas parti/);
    assert.match(m.texte, /131026/);
    assert.ok(!m.html.includes("<b>x</b>"));
    assert.ok(!m.texte.includes("—"));
  });
});
