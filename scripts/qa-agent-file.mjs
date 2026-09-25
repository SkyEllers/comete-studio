/**
 * Banc de QA — la file de l'agent : ce qui revient à Louis.
 *
 * Il fait tourner le vrai code (`ouvrir`, le moteur, `recevoir`,
 * `mettreEnFile`, `traiter`) contre la vraie base :
 *
 * 1. Une question de l'agent entre dans la file ; elle a reçu « je vérifie ».
 * 2. Louis envoie sa réponse : elle part une fois, dans la conversation, et
 *    devient une réponse fixe sans son prénom.
 * 3. Une question déjà traitée ne se traite pas deux fois.
 * 4. La détresse se classe, elle ne s'envoie pas (le 3114 est déjà parti).
 * 5. Rien ne part dans une conversation close.
 * 6. Hors de la fenêtre de 24 h, sur WhatsApp, rien ne part.
 *
 * Aucun mail : la clé Resend est retirée, le mail lui-même est testé par
 * `file-regles.test.ts`. Décor préfixé `zz-qa-`, supprimé en fin de course.
 */
import { createClient } from "@supabase/supabase-js";

import { annoncerCible, creer, env, journal, srv, vide } from "./qa-commun.mjs";

import { ouvrir } from "../src/tools/agent/conversations.ts";
import { recevoir } from "../src/tools/agent/entrees.ts";
import { mettreEnFile, traiter } from "../src/tools/agent/file.ts";
import { tournerConversation } from "../src/tools/agent/moteur.ts";
import { peggy } from "../src/tools/agent/profils/peggy.ts";
import { invitationCalendly } from "../src/tools/agent/reservation.ts";
import { ajouterJours, instantLocal, jourLocal } from "../src/tools/agent/temps.ts";

annoncerCible("QA — Agent, la file");

delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const P = "Europe/Paris";
const HEURE = 3_600_000;
const maintenant = Date.now();
const debut = instantLocal(ajouterJours(jourLocal(maintenant, P), 8), 14, 0, P);

const inv = invitationCalendly.parse({
  uri: `zz-qa:${marque}:file`,
  email: `zz-qa-${marque}@comete-qa.test`,
  name: "Camille Essai",
  created_at: new Date(maintenant).toISOString(),
  timezone: P,
  questions_and_answers: [{ question: "Ton numéro de téléphone", answer: "06 00 00 00 00", position: 0 }],
  reschedule_url: "https://calendly.com/reschedulings/qa",
  cancel_url: "https://calendly.com/cancellations/qa",
  scheduled_event: {
    uri: `zz-qa:${marque}:file:rdv`,
    start_time: new Date(debut).toISOString(),
    end_time: new Date(debut + 45 * 60_000).toISOString(),
    event_type: null,
    location: { type: "zoom", join_url: "https://zoom.us/j/qa" },
  },
});

async function question(id) {
  const { data } = await admin.from("agent_questions").select("*").eq("id", id).single();
  return data;
}
async function sortants(conversationId) {
  const { data } = await admin
    .from("agent_messages")
    .select("genre, texte, cle_envoi")
    .eq("conversation_id", conversationId)
    .eq("sens", "sortant")
    .order("created_at");
  return data ?? [];
}

let org = null;

try {
  org = await creer("organizations", { name: "ZZ QA Agent file", slug: `zz-qa-agent-file-${marque}` });
  await creer("agent_reglages", { organization_id: org.id, profil: "peggy" });

  await ouvrir(admin, org.id, peggy, inv, { delaiMinimumMs: 24 * HEURE, recuLe: inv.created_at, simulation: true });
  const { data: c } = await admin.from("agent_conversations").select("*").eq("invitee_uri", inv.uri).single();
  await tournerConversation(admin, c.id);

  // ---------------------- 1. Une question entre ----------------------------

  const lu = await recevoir(admin, c.id, "Je peux venir avec ma fille au rendez-vous ?");
  await tournerConversation(admin, c.id);
  const { data: enFile } = await admin.from("agent_questions").select("*").eq("conversation_id", c.id);
  verifie("l'IA muette met la question dans la file", enFile?.length === 1 && enFile[0].genre === "incertain");
  verifie(
    "… et elle a reçu « je vérifie »",
    (await sortants(c.id)).some((m) => m.texte === peggy.textes.attente),
  );
  verifie("sans clé Resend, aucun mail noté comme parti", enFile?.[0]?.notifie_le === null);

  const idQ = await mettreEnFile(admin, {
    conversation_id: c.id,
    organization_id: org.id,
    message_id: lu.messageId,
    genre: "incertain",
    question: "Camille demande si elle peut venir avec sa fille.",
    brouillon: "Oui Camille, ta fille peut être à côté de toi.",
    created_at: new Date().toISOString(),
  });
  verifie("mettreEnFile rend l'identifiant de la question", typeof idQ === "string");

  // ------------------------ 2. Louis répond --------------------------------

  const texte = "Bien sûr Camille, ta fille peut être à côté de toi pendant le Zoom.";
  const envoi = await traiter(admin, idQ, {
    choix: "envoyer",
    texte,
    fixe: { question: "Camille demande si elle peut venir avec sa fille." },
  });
  verifie("la réponse de Louis part", envoi.ok, JSON.stringify(envoi));
  const partis = (await sortants(c.id)).filter((m) => m.cle_envoi === `file:${idQ}`);
  verifie("… une fois, en message libre, mot pour mot", partis.length === 1 && partis[0].genre === "libre" && partis[0].texte === texte);
  const q2 = await question(idQ);
  verifie("la question passe à « envoyée », avec la réponse", q2.etat === "envoyee" && q2.reponse === texte && q2.traitee_le !== null);

  const { data: fixes } = await admin.from("agent_reponses_fixes").select("*").eq("organization_id", org.id);
  verifie(
    "elle devient une réponse fixe, sans le prénom",
    fixes?.length === 1 &&
      fixes[0].actif &&
      !JSON.stringify(fixes[0]).includes("Camille") &&
      fixes[0].reponse.includes("[prénom]"),
    JSON.stringify(fixes),
  );

  // ---------------------- 3. Pas deux fois ---------------------------------

  const encore = await traiter(admin, idQ, { choix: "envoyer", texte: "doublon", fixe: null });
  verifie("une question traitée ne repart pas", !encore.ok && (await sortants(c.id)).every((m) => m.texte !== "doublon"));

  // ------------------------- 4. La détresse --------------------------------

  const idD = await mettreEnFile(admin, {
    conversation_id: c.id,
    organization_id: org.id,
    message_id: lu.messageId,
    genre: "detresse",
    question: "je n'en peux plus",
    brouillon: null,
    created_at: new Date().toISOString(),
  });
  const refusD = await traiter(admin, idD, { choix: "envoyer", texte: "non", fixe: null });
  verifie("la détresse ne s'envoie pas", !refusD.ok);
  const classeD = await traiter(admin, idD, { choix: "classer" });
  verifie("… elle se classe", classeD.ok && (await question(idD)).etat === "classee");

  // ------------------- 5. Conversation close --------------------------------

  const idC = await mettreEnFile(admin, {
    conversation_id: c.id,
    organization_id: org.id,
    message_id: lu.messageId,
    genre: "incertain",
    question: "autre question",
    brouillon: "brouillon",
    created_at: new Date().toISOString(),
  });
  await admin.from("agent_conversations").update({ etat: "stop" }).eq("id", c.id);
  const refusC = await traiter(admin, idC, { choix: "envoyer", texte: "après STOP", fixe: null });
  verifie("rien ne part après un STOP", !refusC.ok && (await sortants(c.id)).every((m) => m.texte !== "après STOP"));

  // ------------------ 6. Hors fenêtre, sur WhatsApp -------------------------

  await admin
    .from("agent_conversations")
    .update({ etat: "active", simulation: false, derniere_entree_le: new Date(maintenant - 25 * HEURE).toISOString() })
    .eq("id", c.id);
  await admin.from("agent_reglages").update({ canal: "whatsapp" }).eq("organization_id", org.id);
  const refusF = await traiter(admin, idC, { choix: "envoyer", texte: "hors fenêtre", fixe: null });
  verifie(
    "hors de la fenêtre de 24 h, WhatsApp : rien ne part",
    !refusF.ok && /24 h/.test(refusF.erreur) && (await sortants(c.id)).every((m) => m.texte !== "hors fenêtre"),
  );
  verifie("… et la question reste ouverte", (await question(idC)).etat === "ouverte");
} catch (erreur) {
  verifie("le banc a tourné jusqu'au bout", false, erreur instanceof Error ? erreur.stack : String(erreur));
} finally {
  if (org) await srv("DELETE", `organizations?id=eq.${org.id}`);
  if (org) {
    for (const table of ["agent_conversations", "agent_questions", "agent_reponses_fixes", "agent_reglages"]) {
      verifie(
        `aucun reste dans ${table}`,
        vide(await srv("GET", `${table}?select=organization_id&organization_id=eq.${org.id}`)),
      );
    }
  }
  bilan();
}
