/**
 * Banc de QA — l'agent : de la réservation au rendez-vous, sans WhatsApp.
 *
 * Il fait tourner le vrai code (`ouvrir`, `agentRecoit`, le moteur, `recevoir`)
 * contre la vraie base, en passant l'heure qu'il veut au lieu d'attendre des
 * jours :
 *
 * 1. Personne d'autre que Louis ne lit une conversation, même un membre du
 *    client : elles portent le téléphone et les réponses de la cliente.
 * 2. Le rythme (P12, 27/09/2026) : premier message tout de suite, rappels à
 *    J-7 et J-3, seulement J-3 une fois confirmé, un contenu au milieu, la
 *    veille, « sans réponse » noté, le lien le matin, la conversation close
 *    après le rendez-vous. Jamais d'annulation.
 * 3. Un même envoi ne part jamais deux fois, même si l'horloge repasse.
 * 4. STOP arrête tout, avec une seule réponse.
 * 5. Le webhook : rien tant que l'agent n'est pas lancé ; puis réservation,
 *    déplacement par la cliente (même conversation), annulation.
 * 6. La purge : bilan sans nom écrit, conversation effacée.
 *
 * Décor préfixé `zz-qa-`, supprimé en fin de course.
 */
import { createClient } from "@supabase/supabase-js";

import {
  annoncerCible,
  connecter,
  creer,
  creerCompte,
  env,
  journal,
  par,
  srv,
  supprimerCompte,
  vide,
} from "./qa-commun.mjs";

import { agentRecoit, ouvrir } from "../src/tools/agent/conversations.ts";
import { recevoir } from "../src/tools/agent/entrees.ts";
import { tournerConversation } from "../src/tools/agent/moteur.ts";
import { peggy } from "../src/tools/agent/profils/peggy.ts";
import { invitationCalendly } from "../src/tools/agent/reservation.ts";
import { ajouterJours, instantLocal, jourLocal } from "../src/tools/agent/temps.ts";

annoncerCible("QA — Agent");

// Sans clé, l'IA « tombe en panne » : le banc éprouve le chemin de secours
// (message d'attente, question dans la file) sans dépenser un centime.
// Les réponses de l'IA elles-mêmes sont éprouvées par `qa:agent-ia`.
delete process.env.ANTHROPIC_API_KEY;

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const P = "Europe/Paris";
const HEURE = 3_600_000;
const TYPE = `https://api.calendly.com/event_types/zz-qa-${marque}`;

const maintenant = Date.now();
const jourRdv = ajouterJours(jourLocal(maintenant, P), 8);
const debut = instantLocal(jourRdv, 14, 0, P);
const a = (decalageJours, heure, minute = 0) =>
  instantLocal(ajouterJours(jourLocal(maintenant, P), decalageJours), heure, minute, P);

function invitation(suffixe, surcharge = {}) {
  return {
    uri: `zz-qa:${marque}:${suffixe}`,
    email: `zz-qa-${marque}@comete-qa.test`,
    name: "Camille Essai",
    created_at: new Date(maintenant).toISOString(),
    timezone: P,
    questions_and_answers: [
      { question: "Ton numéro de téléphone", answer: "06 00 00 00 00", position: 0 },
      { question: "Comment tu fonctionnes quand tu décides de changer ?", answer: "Je fonce", position: 3 },
    ],
    reschedule_url: "https://calendly.com/reschedulings/qa",
    cancel_url: "https://calendly.com/cancellations/qa",
    scheduled_event: {
      uri: `zz-qa:${marque}:${suffixe}:rdv`,
      start_time: new Date(debut).toISOString(),
      end_time: new Date(debut + 45 * 60_000).toISOString(),
      event_type: TYPE,
      location: { type: "zoom", join_url: "https://zoom.us/j/qa" },
    },
    ...surcharge,
  };
}

async function messages(id) {
  const { data } = await admin
    .from("agent_messages")
    .select("sens, genre, modele, texte, cle_envoi, statut")
    .eq("conversation_id", id)
    .order("created_at");
  return data ?? [];
}
// Les modèles vraiment partis. Un contenu n'a pas de `modele` en base : sa clé
// le dit (comme `versEnvois`). Un créneau consommé sans rien envoyer reste
// noté en échec : il n'est pas parti.
const modelesDe = async (id) =>
  (await messages(id))
    .filter((m) => m.genre === "modele" && m.statut !== "echec")
    .map((m) => m.modele ?? (m.cle_envoi?.startsWith("contenu:") ? "contenu" : null));

async function conversation(uri) {
  const { data } = await admin
    .from("agent_conversations")
    .select("*")
    .eq("invitee_uri", uri)
    .maybeSingle();
  return data;
}

const orgs = {};
let compte = null;

try {
  // ------------------------------- Décor -----------------------------------

  orgs.a = await creer("organizations", { name: "ZZ QA Agent", slug: `zz-qa-agent-${marque}` });
  await creer("agent_reglages", { organization_id: orgs.a.id, profil: "peggy" });

  const mail = `zz-qa-agent-${marque}@comete-qa.test`;
  compte = await creerCompte(mail);
  await creer("memberships", { organization_id: orgs.a.id, user_id: compte, role: "owner" });

  // --------------------------- 2. Le rythme ---------------------------------

  const inv = invitationCalendly.parse(invitation("sim"));
  const ouverte = await ouvrir(admin, orgs.a.id, peggy, inv, {
    delaiMinimumMs: 24 * HEURE,
    recuLe: inv.created_at,
    simulation: true,
  });
  verifie("une réservation ouvre une conversation", ouverte === "ok");
  const c = await conversation(inv.uri);
  verifie("téléphone au format international", c?.telephone === "+33600000000", c?.telephone);
  verifie("façon de décider lue", c?.facon_de_decider === "fonce", c?.facon_de_decider);

  await tournerConversation(admin, c.id, maintenant + 60_000);
  verifie("le premier message part tout de suite", (await modelesDe(c.id)).join() === "reservation");
  const premier = (await messages(c.id))[0];
  verifie(
    "il porte le jour, l'heure et le prénom",
    /^Bonjour Camille, .*14h, en visio/s.test(premier?.texte ?? ""),
    premier?.texte,
  );

  // ------------------------- 1. Qui lit quoi -------------------------------

  const membre = par(await connecter(mail));
  verifie(
    "un membre du client ne lit aucune conversation",
    vide(await membre("GET", `agent_conversations?select=id&organization_id=eq.${orgs.a.id}`)),
  );
  verifie(
    "ni aucun message",
    vide(await membre("GET", `agent_messages?select=id&conversation_id=eq.${c.id}`)),
  );
  verifie(
    "ni les réglages de l'agent",
    vide(await membre("GET", `agent_reglages?select=profil&organization_id=eq.${orgs.a.id}`)),
  );

  // ------------------------- 3. Idempotence --------------------------------

  await Promise.all([
    tournerConversation(admin, c.id, maintenant + 2 * 60_000),
    tournerConversation(admin, c.id, maintenant + 2 * 60_000),
  ]);
  verifie("deux passages de l'horloge n'envoient rien de plus", (await messages(c.id)).length === 1);

  // Rendez-vous à J+8, pas encore confirmé : rappels à J-7 (ici le
  // lendemain) et J-3, et un contenu au milieu de chaque intervalle d'au
  // moins deux jours (P12, « Le rythme selon la durée », 27/09/2026).
  await tournerConversation(admin, c.id, a(1, 10, 5));
  verifie(
    "rappel à J-7, 10h (ici le lendemain)",
    (await modelesDe(c.id)).join() === "reservation,rappel",
    (await modelesDe(c.id)).join(),
  );
  await tournerConversation(admin, c.id, a(2, 10, 5));
  verifie("rien le surlendemain : le contenu attend le milieu, J-5", (await messages(c.id)).length === 2);

  const lu = await recevoir(admin, c.id, "Oui, ça tient", a(2, 11));
  verifie("le bouton « Oui » confirme", lu?.sens === "confirme" && (await conversation(inv.uri)).confirme_le !== null);

  // Confirmée : plus que J-3 et la veille. Le contenu passe au milieu de la
  // réservation et de J-3, au jour 2 : il part dans le même passage que la
  // réponse, à la même seconde. On ne compte donc pas sur leur ordre.
  await tournerConversation(admin, c.id, a(2, 11, 1));
  const libres = (await messages(c.id)).filter((m) => m.genre === "libre");
  verifie(
    "IA en panne : elle reçoit « je vérifie et je reviens », une seule fois",
    libres.length === 1 && libres[0].texte === peggy.textes.attente,
    libres.map((m) => m.texte).join(" | "),
  );
  verifie(
    "confirmée : le contenu part au milieu, entre la réservation et J-3",
    (await modelesDe(c.id)).join() === "reservation,rappel,contenu",
    (await modelesDe(c.id)).join(),
  );
  const { data: file } = await admin.from("agent_questions").select("genre, etat").eq("conversation_id", c.id);
  verifie("… et la question entre dans la file de Louis", file?.length === 1 && file[0].etat === "ouverte");

  const nuit = await recevoir(admin, c.id, "Et on se voit sur Zoom c'est ça ?", a(2, 23, 30));
  await tournerConversation(admin, c.id, a(2, 23, 31));
  verifie(
    "un message de la nuit n'a pas de réponse avant 8h",
    nuit !== null && (await messages(c.id)).at(-1)?.sens === "entrant",
  );
  // Sa première question attend encore Louis : la nouvelle la rejoint, sans
  // second « je vérifie » (09/10/2026). La ligne notée à 8h n'envoie rien.
  await tournerConversation(admin, c.id, a(3, 8, 1));
  const apresNuit = await messages(c.id);
  const { data: fileNuit } = await admin.from("agent_questions").select("question").eq("conversation_id", c.id);
  verifie(
    "… à 8h, elle rejoint la question qui attend, sans second « je vérifie »",
    apresNuit.at(-1)?.sens === "sortant" &&
      apresNuit.at(-1)?.statut === "echec" &&
      apresNuit.filter((m) => m.texte === peggy.textes.attente).length === 1 &&
      fileNuit?.length === 1 &&
      fileNuit[0].question.includes("Puis, "),
    JSON.stringify(fileNuit),
  );

  await tournerConversation(admin, c.id, a(4, 10, 5));
  verifie("confirmée : plus rien avant J-3", (await modelesDe(c.id)).length === 3);
  await tournerConversation(admin, c.id, a(5, 10, 5));
  verifie(
    "… puis le rappel de J-3, 10h",
    (await modelesDe(c.id)).join() === "reservation,rappel,contenu,rappel",
    (await modelesDe(c.id)).join(),
  );
  // Entre J-3 et la veille, deux jours : un créneau de contenu à J-2. Un
  // article lui est parti il y a moins de cinq jours : le créneau se
  // consomme sans rien envoyer (05/10/2026).
  await tournerConversation(admin, c.id, a(6, 10, 5));
  const contenuSaute = (await messages(c.id)).at(-1);
  verifie(
    "rien d'autre avant la veille : le contenu de J-2 saute, un article est parti il y a moins de cinq jours",
    (await modelesDe(c.id)).length === 4 &&
      contenuSaute?.cle_envoi === `contenu:${ajouterJours(jourLocal(maintenant, P), 6)}` &&
      contenuSaute.statut === "echec",
    JSON.stringify(contenuSaute),
  );

  await tournerConversation(admin, c.id, a(7, 10, 5));
  verifie("le message de la veille part à 10h", (await modelesDe(c.id)).at(-1) === "veille");

  await tournerConversation(admin, c.id, a(8, 8, 0));
  const apresMatin = await conversation(inv.uri);
  verifie("sans réponse à la veille : noté", apresMatin.sans_reponse_veille === true);
  verifie("… et le rendez-vous n'est pas annulé", apresMatin.etat === "active", apresMatin.etat);
  const matin = (await messages(c.id)).at(-1);
  verifie("le lien Zoom part le matin", matin?.modele === "matin" && matin.texte.includes("https://zoom.us/j/qa"));

  await tournerConversation(admin, c.id, debut + 46 * 60_000);
  verifie("après le rendez-vous, la conversation se termine", (await conversation(inv.uri)).etat === "terminee");

  // ---------------------------- 4. STOP ------------------------------------

  const invStop = invitationCalendly.parse(invitation("stop"));
  await ouvrir(admin, orgs.a.id, peggy, invStop, { delaiMinimumMs: 24 * HEURE, recuLe: invStop.created_at, simulation: true });
  const cs = await conversation(invStop.uri);
  await tournerConversation(admin, cs.id, maintenant + 60_000);
  await recevoir(admin, cs.id, "STOP", maintenant + 5 * 60_000);
  const apresStop = await conversation(invStop.uri);
  verifie("STOP arrête la conversation", apresStop.etat === "stop" && apresStop.stop_le !== null);
  await tournerConversation(admin, cs.id, a(7, 10, 5));
  // Le STOP et sa réponse portent la même seconde : on ne compte pas sur leur ordre.
  const filStop = await messages(cs.id);
  verifie(
    "une seule réponse au STOP, puis plus rien",
    filStop.length === 3 && filStop.filter((m) => m.sens === "sortant" && m.genre === "libre").length === 1,
    filStop.map((m) => m.genre).join(),
  );

  // --------------------------- 5. Webhook ----------------------------------

  const cree = (payload) => ({ event: "invitee.created", created_at: new Date(maintenant).toISOString(), payload });
  const invW = invitation("webhook");
  await agentRecoit(admin, orgs.a.id, cree(invW));
  verifie("agent éteint : une vraie réservation n'ouvre rien", (await conversation(invW.uri)) === null);

  await admin
    .from("agent_reglages")
    .update({ actif: true, types_suivis: [TYPE] })
    .eq("organization_id", orgs.a.id);

  await agentRecoit(admin, orgs.a.id, cree({ ...invW, scheduled_event: { ...invW.scheduled_event, event_type: "autre" } }));
  verifie("un type non suivi n'ouvre rien", (await conversation(invW.uri)) === null);

  await agentRecoit(admin, orgs.a.id, cree(invW));
  await agentRecoit(admin, orgs.a.id, cree(invW));
  const cw = await conversation(invW.uri);
  verifie("agent lancé : la réservation ouvre une conversation, une seule", cw !== null && cw.simulation === false);

  const nouveauDebut = debut + 2 * 24 * HEURE;
  const invDeplacee = invitation("webhook-2", {
    old_invitee: invW.uri,
    rescheduled: false,
    scheduled_event: {
      ...invW.scheduled_event,
      uri: `zz-qa:${marque}:webhook-2:rdv`,
      start_time: new Date(nouveauDebut).toISOString(),
      end_time: new Date(nouveauDebut + 45 * 60_000).toISOString(),
    },
  });
  await agentRecoit(admin, orgs.a.id, { event: "invitee.canceled", payload: { ...invW, rescheduled: true } });
  await agentRecoit(admin, orgs.a.id, cree(invDeplacee));
  const deplacee = await conversation(invDeplacee.uri);
  verifie(
    "déplacé par la cliente : même conversation, nouvelle date, confirmée",
    deplacee?.id === cw.id &&
      Date.parse(deplacee.rdv_debut) === nouveauDebut &&
      deplacee.invites_precedents.includes(invW.uri) &&
      deplacee.confirme_le !== null &&
      deplacee.etat === "active",
  );

  await agentRecoit(admin, orgs.a.id, { event: "invitee.canceled", payload: { ...invDeplacee, rescheduled: false } });
  verifie("annulée dans Calendly : la conversation s'arrête", (await conversation(invDeplacee.uri)).etat === "annulee");

  // ----------------------------- 6. Purge ----------------------------------

  const { count: avant } = await admin
    .from("agent_bilans")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgs.a.id);
  await admin
    .from("agent_conversations")
    .update({ efface_apres: new Date(maintenant - 60_000).toISOString() })
    .eq("id", c.id);
  const { data: effacees } = await admin.rpc("agent_purger_conversations");
  verifie("la purge efface la conversation échue", effacees >= 1 && (await conversation(inv.uri)) === null);
  verifie("… et ses messages", (await messages(c.id)).length === 0);
  const { data: bilans } = await admin
    .from("agent_bilans")
    .select("*")
    .eq("organization_id", orgs.a.id);
  const b = bilans?.[0];
  // La purge compte les lignes, pas ce qui est parti. Sept modèles :
  // réservation, J-7, contenu, J-3, contenu de J-2 sauté, veille, matin. Deux
  // libres : « je vérifie », et la ligne de 8h qui n'a rien envoyé. Une seule
  // question : la seconde a rejoint la première.
  verifie(
    "elle laisse un bilan sans nom ni numéro",
    (bilans?.length ?? 0) === (avant ?? 0) + 1 &&
      b.confirme === true &&
      b.sans_reponse_veille === true &&
      b.modeles_envoyes === 7 &&
      b.questions_montees === 1 &&
      b.messages_libres === 2 &&
      !JSON.stringify(b).includes("Camille") &&
      !JSON.stringify(b).includes("+336"),
    JSON.stringify(b),
  );
  verifie(
    "et personne d'autre que Louis ne lit les bilans",
    vide(await membre("GET", `agent_bilans?select=id&organization_id=eq.${orgs.a.id}`)),
  );
} catch (erreur) {
  verifie("le banc a tourné jusqu'au bout", false, erreur instanceof Error ? erreur.message : String(erreur));
} finally {
  // ------------------------------- Ménage ----------------------------------
  if (orgs.a) await srv("DELETE", `organizations?id=eq.${orgs.a.id}`);
  if (compte) await supprimerCompte(compte);

  if (orgs.a) {
    for (const table of ["agent_conversations", "agent_reglages", "agent_bilans"]) {
      verifie(
        `aucun reste dans ${table}`,
        vide(await srv("GET", `${table}?select=organization_id&organization_id=eq.${orgs.a.id}`)),
      );
    }
  }
  bilan();
}
