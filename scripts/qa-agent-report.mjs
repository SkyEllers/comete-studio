/**
 * Banc de QA — le report, de bout en bout, en simulation chez un vrai client.
 *
 * Une conversation simulée (rien ne part vers personne) sur l'organisation
 * de Peggy : son vrai réglage, son vrai jeton d'agent, les vrais créneaux
 * libres de son agenda (lecture seule), les vraies réponses de Claude
 * Opus 5. La réservation, elle, est simulée : rien n'est écrit dans son
 * Calendly ni dans Radar.
 *
 * Quatre messages de la cliente, quatre appels à l'IA (quelques dizaines de
 * centimes). La conversation est supprimée à la fin.
 *
 *   1. « je ne pourrai pas »      → il demande l'heure ou la journée
 *   2. « toute la journée »       → trois créneaux, tous lus dans l'agenda
 *   3. « le deuxième »            → réservé (simulé) au bon créneau, confirmé
 *   4. « je dois encore changer » → plus de créneau : le lien
 */
import { createClient } from "@supabase/supabase-js";

import { env, journal } from "./qa-commun.mjs";

import { ouvrir } from "../src/tools/agent/conversations.ts";
import { recevoir } from "../src/tools/agent/entrees.ts";
import { tournerConversation } from "../src/tools/agent/moteur.ts";
import { peggy } from "../src/tools/agent/profils/peggy.ts";
import { invitationCalendly } from "../src/tools/agent/reservation.ts";
import { tournuresInterdites } from "../src/tools/agent/style.ts";
import { ajouterJours, heureEnMots, instantLocal, jourEnMots, jourLocal } from "../src/tools/agent/temps.ts";

process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { verifie, bilan } = journal();
const P = "Europe/Paris";

// Une heure où l'agent répond (8h-21h) : maintenant, ou demain 10h.
const vrai = Date.now();
const heure = Number(heureEnMots(vrai, P).split("h")[0]);
const debutJeu = heure >= 8 && heure < 20 ? vrai : instantLocal(ajouterJours(jourLocal(vrai, P), 1), 10, 0, P);
let horloge = debutJeu;
const plus = (minutes) => (horloge += minutes * 60_000);

// Le rendez-vous d'origine : dans 13 jours à 14h, là où l'agenda est plein.
const jourRdv = ajouterJours(jourLocal(debutJeu, P), 13);
const rdv = instantLocal(jourRdv, 14, 0, P);

const { data: org } = await admin.from("organizations").select("id").eq("slug", "peggy").single();
const marque = Math.random().toString(36).slice(2, 8);
const inv = invitationCalendly.parse({
  uri: `simulation:qa-report-${marque}`,
  email: "simulation@cometestudio.fr",
  name: "Camille",
  created_at: new Date(debutJeu - 60_000).toISOString(),
  timezone: P,
  reschedule_url: `https://calendly.com/reschedulings/simulation-${marque}`,
  questions_and_answers: peggy.formulaire.map((q, position) => ({ question: q.question, answer: q.exemple, position })),
  scheduled_event: {
    uri: `simulation:qa-report-${marque}:rdv`,
    start_time: new Date(rdv).toISOString(),
    end_time: new Date(rdv + 45 * 60_000).toISOString(),
    event_type: null,
    location: { type: "zoom", join_url: "https://zoom.us/j/simulation" },
  },
});

let id = null;
const etat = async () =>
  (await admin.from("agent_conversations").select("*").eq("id", id).single()).data;
const dernierSortant = async () => {
  const { data } = await admin
    .from("agent_messages")
    .select("texte, sens")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0];
};

async function elle(texte) {
  plus(2);
  await recevoir(admin, id, texte, horloge);
  plus(1);
  await tournerConversation(admin, id, horloge);
  const m = await dernierSortant();
  console.log(`\nElle   : ${texte}\nAgent  : ${m?.sens === "sortant" ? m.texte.replace(/\n/g, " / ") : "(rien)"}`);
  const interdites = m?.sens === "sortant" ? tournuresInterdites(m.texte) : [];
  verifie(`aucune tournure interdite après « ${texte.slice(0, 30)} »`, interdites.length === 0, interdites.join(", "));
  return m?.sens === "sortant" ? m.texte : "";
}

try {
  await ouvrir(admin, org.id, peggy, inv, {
    delaiMinimumMs: 24 * 3_600_000,
    recuLe: inv.created_at,
    simulation: true,
  });
  id = (await admin.from("agent_conversations").select("id").eq("invitee_uri", inv.uri).single()).data.id;
  await tournerConversation(admin, id, horloge);
  console.log(`Rendez-vous d'origine : ${jourEnMots(rdv, P)} à ${heureEnMots(rdv, P)}`);
  console.log(`Agent  : ${(await dernierSortant())?.texte.replace(/\n/g, " / ")}`);

  const r1 = await elle(`Ah mince, ${jourEnMots(rdv, P).split(" ")[0]} je ne pourrai pas finalement`);
  const e1 = await etat();
  verifie("1. l'empêchement est compris : report en cours", e1.report_demande_le !== null);
  verifie("1. aucun créneau proposé d'emblée", e1.creneaux_proposes.length === 0, r1);

  const r2 = await elle("Toute la journée, je travaille ce jour-là");
  const e2 = await etat();
  console.log(`         créneaux retenus : ${e2.creneaux_proposes.map((c) => `${jourEnMots(c, P)} ${heureEnMots(c, P)}`).join(" | ")}`);
  verifie("2. trois créneaux proposés", e2.creneaux_proposes.length === 3, String(e2.creneaux_proposes.length));
  verifie(
    "2. aucun le jour qu'elle ne peut pas",
    e2.creneaux_proposes.every((c) => jourLocal(c, P) !== jourRdv),
  );
  verifie(
    "2. chaque créneau retenu est écrit dans le message",
    e2.creneaux_proposes.every((c) => r2.includes(heureEnMots(c, P))),
    r2,
  );

  const vise = e2.creneaux_proposes[1] ?? e2.creneaux_proposes[0];
  await elle(e2.creneaux_proposes.length > 1 ? "Le deuxième me va très bien" : "Celui-là me va très bien");
  const e3 = await etat();
  verifie(
    "3. rendez-vous déplacé (simulé) au créneau choisi",
    Date.parse(e3.rdv_debut) === Date.parse(vise) && e3.reports_agent === 1,
    `${e3.rdv_debut} contre ${vise}`,
  );
  verifie("3. report clos, et le choix vaut confirmation", e3.report_demande_le === null && e3.creneaux_proposes.length === 0 && e3.confirme_le !== null);
  verifie("3. l'ancien invité est gardé pour reconnaître son annulation", e3.invites_precedents.includes(inv.uri));

  const r4 = await elle("En fait je dois encore changer, désolée");
  const e4 = await etat();
  verifie("4. au deuxième report, aucun créneau proposé", e4.creneaux_proposes.length === 0 && e4.reports_agent === 1, r4);
  verifie("4. … mais le lien pour reprendre rendez-vous", r4.includes("calendly.com/reschedulings/"), r4);
} catch (erreur) {
  verifie("le banc a tourné jusqu'au bout", false, erreur instanceof Error ? erreur.message : String(erreur));
} finally {
  if (id) await admin.from("agent_conversations").delete().eq("id", id).eq("simulation", true);
  const { count } = await admin
    .from("agent_conversations")
    .select("id", { count: "exact", head: true })
    .like("invitee_uri", `simulation:qa-report-${marque}%`);
  verifie("aucun reste de la simulation", count === 0);
  bilan();
}
