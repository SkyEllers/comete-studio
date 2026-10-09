/**
 * Banc de QA — l'agent qui tient ses promesses d'arrêt (09/10/2026).
 *
 * Deux simulations chez Peggy, avec le vrai code et la vraie API Claude
 * (quelques appels à Opus 5), tirées de la file du 09/10/2026 :
 *
 * 1. « Coline », comme Coralie : elle se plaint (« C'est un pénible ce bot ») ;
 *    l'agent s'excuse sans promettre le silence, et les articles s'arrêtent
 *    (les rappels, non). Puis « Merci d'arrêter d'envoyer des msg. » : STOP,
 *    lu sans IA.
 * 2. « Chantal », comme Christiane : deux questions de suite que l'agent ne
 *    tranche pas ; un seul « je vérifie », la deuxième rejoint la première
 *    dans la file. Puis une demande d'arrêt que la liste ne connaît pas :
 *    l'IA la rattrape, STOP.
 *
 * Les conversations sont des simulations (canal simulé : rien ne part chez
 * Meta). Chaque question de la file envoie à Louis le mail « [Simulation] ».
 * Par défaut elles sont effacées en fin de course ; `--garder` les laisse
 * dans /admin/agent pour les relire.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { env, journal } from "./qa-commun.mjs";

import { ouvrir } from "../src/tools/agent/conversations.ts";
import { recevoir } from "../src/tools/agent/entrees.ts";
import { tournerConversation } from "../src/tools/agent/moteur.ts";
import { peggy } from "../src/tools/agent/profils/peggy.ts";
import { invitationCalendly } from "../src/tools/agent/reservation.ts";
import { ajouterJours, instantLocal, jourLocal } from "../src/tools/agent/temps.ts";

if (!env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY est absente de `.env.local` : ce banc ne peut pas tourner.");
  process.exit(1);
}
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

const garder = process.argv.includes("--garder");
const { verifie, bilan } = journal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const P = "Europe/Paris";
const MINUTE = 60_000;
const debutCourse = Date.now();
const jourRdv = ajouterJours(jourLocal(debutCourse, P), 8);
const rdv = instantLocal(jourRdv, 14, 0, P);
const PROMESSES = /tranquille|je ne t'[ée]cri(s|rai) plus|redonne(rai)? signe|plus aucun message de ma part/i;

const { data: reglages } = await admin
  .from("agent_reglages")
  .select("organization_id")
  .eq("profil", "peggy")
  .limit(1)
  .single();
if (!reglages) throw new Error("Aucun agent réglé sur le profil peggy.");
const org = reglages.organization_id;

async function ouvrirSimulation(prenom) {
  const id = randomUUID();
  const inv = invitationCalendly.parse({
    uri: `simulation:${id}`,
    email: "simulation@cometestudio.fr",
    name: prenom,
    created_at: new Date(debutCourse).toISOString(),
    timezone: P,
    reschedule_url: `https://calendly.com/reschedulings/simulation-${id}`,
    cancel_url: `https://calendly.com/cancellations/simulation-${id}`,
    questions_and_answers: peggy.formulaire.map((q, position) => ({
      question: q.question,
      answer: q.exemple ?? "",
      position,
    })),
    scheduled_event: {
      uri: `simulation:${id}:rdv`,
      start_time: new Date(rdv).toISOString(),
      end_time: new Date(rdv + peggy.dureeMinutes * MINUTE).toISOString(),
      event_type: null,
      location: { type: "zoom", join_url: "https://zoom.us/j/simulation" },
    },
  });
  const issue = await ouvrir(admin, org, peggy, inv, {
    delaiMinimumMs: 0,
    recuLe: inv.created_at,
    simulation: true,
  });
  verifie(`${prenom} : la simulation s'ouvre`, issue === "ok", issue);
  const { data } = await admin.from("agent_conversations").select("id").eq("invitee_uri", inv.uri).single();
  await tournerConversation(admin, data.id);
  return data.id;
}

/** L'horloge de la simulation, posée sur `cible`, puis un passage du moteur. */
async function aller(id, cible) {
  const secondes = Math.round((cible - Date.now()) / 1000);
  await admin.from("agent_conversations").update({ decalage: `${secondes} seconds` }).eq("id", id);
  await tournerConversation(admin, id);
}

async function ecrire(id, texte) {
  console.log(`   elle : ${texte}`);
  await recevoir(admin, id, texte);
  await tournerConversation(admin, id);
}

async function fil(id) {
  const { data } = await admin
    .from("agent_messages")
    .select("id, sens, genre, modele, texte, cle_envoi, statut, comprehension, created_at")
    .eq("conversation_id", id)
    .order("created_at");
  return data ?? [];
}

const dernierSortant = async (id) => (await fil(id)).filter((m) => m.sens === "sortant").at(-1);
const dernierEntrant = async (id) => (await fil(id)).filter((m) => m.sens === "entrant").at(-1);
const etat = async (id) =>
  (await admin.from("agent_conversations").select("etat, stop_le").eq("id", id).single()).data;
const questions = async (id) =>
  (await admin.from("agent_questions").select("etat, question, brouillon").eq("conversation_id", id)).data ?? [];

function imprimer(titre, lignes) {
  console.log(`\n── ${titre}`);
  for (const m of lignes) {
    const qui = m.sens === "entrant" ? "elle" : m.genre === "modele" ? `modèle ${m.modele ?? m.cle_envoi}` : "agent";
    const echec = m.statut === "echec" ? " [rien envoyé]" : "";
    console.log(`   ${m.created_at.slice(5, 16).replace("T", " ")} ${qui}${echec} : ${m.texte.replace(/\n/g, " / ")}`);
  }
}

const ids = [];
try {
  // ------------------- 1. Coline : la plainte, puis l'arrêt -------------------

  console.log("\n== Simulation 1 : Coline");
  const coline = await ouvrirSimulation("Coline");
  ids.push(coline);

  await aller(coline, debutCourse + 2 * MINUTE);
  await ecrire(coline, "C'est un pénible ce bot");
  const excuse = await dernierSortant(coline);
  console.log(`   agent : ${excuse?.texte}`);
  verifie("Coline : l'agent répond (pas de « je vérifie »)", excuse?.texte !== peggy.textes.attente, excuse?.texte);
  verifie("Coline : il ne promet pas le silence", !PROMESSES.test(excuse?.texte ?? ""), excuse?.texte);
  verifie("Coline : il parle des articles", /article/i.test(excuse?.texte ?? ""), excuse?.texte);
  const plainte = await dernierEntrant(coline);
  verifie(
    "Coline : la plainte coupe les articles",
    plainte?.comprehension?.sens === "sans_contenus",
    JSON.stringify(plainte?.comprehension),
  );
  verifie("Coline : la conversation continue", (await etat(coline))?.etat === "active");

  // Les jours passent, à 10h et à 18h, jusqu'à la veille au soir.
  for (let j = 1; ajouterJours(jourLocal(debutCourse, P), j) < jourRdv; j++) {
    const jour = ajouterJours(jourLocal(debutCourse, P), j);
    await aller(coline, instantLocal(jour, 10, 5, P));
    await aller(coline, instantLocal(jour, 18, 5, P));
  }
  const apres = (await fil(coline)).filter((m) => m.sens === "sortant" && Date.parse(m.created_at) > Date.parse(plainte.created_at));
  const articles = apres.filter((m) => m.cle_envoi?.startsWith("contenu:"));
  verifie(
    "Coline : aucun article ne part après la plainte",
    articles.every((m) => m.statut === "echec"),
    articles.map((m) => `${m.statut} ${m.texte}`).join(" | "),
  );
  verifie(
    "Coline : les rappels partent quand même (la veille)",
    apres.some((m) => m.cle_envoi === `veille:${jourRdv}` && m.statut !== "echec"),
    apres.map((m) => m.cle_envoi).join(", "),
  );

  await aller(coline, instantLocal(ajouterJours(jourRdv, -1), 19, 0, P));
  await ecrire(coline, "Merci d’arrêter d’envoyer des msg.");
  const stop = await dernierSortant(coline);
  const demande = await dernierEntrant(coline);
  verifie("Coline : la demande est lue comme un STOP, sans IA", demande?.comprehension?.stop === true && !demande?.comprehension?.ia);
  verifie("Coline : la réponse fixe du STOP part", stop?.texte === peggy.textes.stop, stop?.texte);
  verifie("Coline : la conversation est arrêtée", (await etat(coline))?.etat === "stop");
  verifie("Coline : rien dans la file", (await questions(coline)).length === 0);
  await aller(coline, instantLocal(jourRdv, 8, 30, P));
  verifie("Coline : plus rien le matin du rendez-vous", (await dernierSortant(coline))?.id === stop?.id);
  imprimer("Coline, toute la conversation", await fil(coline));

  // ------------- 2. Chantal : deux questions, une attente, puis l'arrêt ------

  console.log("\n== Simulation 2 : Chantal");
  const chantal = await ouvrirSimulation("Chantal");
  ids.push(chantal);
  const t0 = Date.now();

  await aller(chantal, t0 + 2 * MINUTE);
  await ecrire(
    chantal,
    "Je suis déjà dans le programme avec Peggy depuis juin, je voudrais arrêter mes prélèvements, comment je fais ?",
  );
  const attente = await dernierSortant(chantal);
  verifie("Chantal : la première question reçoit « je vérifie »", attente?.texte === peggy.textes.attente, attente?.texte);
  verifie("Chantal : « arrêter mes prélèvements » n'est pas un STOP", (await etat(chantal))?.etat === "active");

  await aller(chantal, t0 + 3 * MINUTE);
  await ecrire(chantal, "Et pour le mois de septembre, je peux être remboursée ?");
  const messagesChantal = await fil(chantal);
  const attentes = messagesChantal.filter((m) => m.sens === "sortant" && m.texte === peggy.textes.attente);
  verifie("Chantal : un seul « je vérifie » pour les deux questions", attentes.length === 1, `${attentes.length}`);
  const file = await questions(chantal);
  verifie("Chantal : une seule question dans la file", file.length === 1, `${file.length}`);
  verifie("Chantal : la deuxième y est jointe", /\n\nPuis, /.test(file[0]?.question ?? ""), file[0]?.question);
  console.log(`   file : ${file[0]?.question.replace(/\n/g, " / ")}`);
  console.log(`   brouillon : ${file[0]?.brouillon?.replace(/\n/g, " / ")}`);

  await aller(chantal, t0 + 5 * MINUTE);
  await ecrire(chantal, "Franchement j'en ai assez de recevoir tout ça sur WhatsApp, c'est fini pour moi.");
  const fin = await dernierSortant(chantal);
  const arret = await dernierEntrant(chantal);
  verifie("Chantal : la liste ne l'a pas lue (c'est l'IA)", arret?.comprehension?.ia?.arret === "tout", JSON.stringify(arret?.comprehension));
  verifie("Chantal : la réponse fixe du STOP part", fin?.texte === peggy.textes.stop, fin?.texte);
  verifie("Chantal : la conversation est arrêtée", (await etat(chantal))?.etat === "stop");
  imprimer("Chantal, toute la conversation", await fil(chantal));
} finally {
  if (garder) {
    console.log(`\nSimulations gardées dans /admin/agent : ${ids.join(", ")}`);
  } else {
    for (const id of ids) await admin.from("agent_conversations").delete().eq("id", id).eq("simulation", true);
  }
  bilan();
}
