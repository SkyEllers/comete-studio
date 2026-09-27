/**
 * Essai de bout en bout de l'agent par le vrai WhatsApp, sur le numéro de
 * Louis, sans toucher aux clientes de Peggy.
 *
 *   --ouvrir +33XXXXXXXXX : ouvre une conversation d'essai (réelle, pas une
 *     simulation) à ce numéro, rendez-vous fictif dans 10 jours à 14h, sans
 *     réservation Calendly ni rendez-vous Radar ; passe le canal de Peggy sur
 *     WhatsApp. Le réglage reste `actif` faux : aucune vraie réservation
 *     n'ouvre de conversation, seule celle-ci parle par WhatsApp.
 *     Le modèle de réservation est noté comme non envoyé (les modèles
 *     attendent la validation de Meta) : l'horloge ne le retente pas.
 *   --etat : ce que la conversation d'essai contient (messages, statuts).
 *   --fermer : efface la conversation d'essai et remet le canal en simulé.
 *
 * Ensuite, Louis écrit au numéro de l'agent depuis son WhatsApp.
 */
import { createClient } from "@supabase/supabase-js";

import { env } from "./qa-commun.mjs";

import { ouvrir } from "../src/tools/agent/conversations.ts";
import { peggy } from "../src/tools/agent/profils/peggy.ts";
import { invitationCalendly, telephoneInternational } from "../src/tools/agent/reservation.ts";
import { ajouterJours, instantLocal, jourLocal } from "../src/tools/agent/temps.ts";

const P = "Europe/Paris";
const MARQUE = "essai:agent-whatsapp";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: org } = await admin.from("organizations").select("id").eq("slug", "peggy").single();

const essais = async () =>
  (
    await admin
      .from("agent_conversations")
      .select("id, etat, telephone, rdv_debut")
      .eq("organization_id", org.id)
      .like("invitee_uri", `${MARQUE}%`)
  ).data ?? [];

const arg = (nom) => {
  const i = process.argv.indexOf(nom);
  return i === -1 ? null : (process.argv[i + 1] ?? "");
};

if (arg("--ouvrir") !== null) {
  const telephone = telephoneInternational(arg("--ouvrir"));
  if (!telephone) throw new Error("Numéro illisible : +33XXXXXXXXX attendu.");
  if ((await essais()).length) throw new Error("Une conversation d'essai existe déjà : --fermer d'abord.");

  const maintenant = Date.now();
  const rdv = instantLocal(ajouterJours(jourLocal(maintenant, P), 10), 14, 0, P);
  const marque = `${MARQUE}-${maintenant}`;
  const inv = invitationCalendly.parse({
    uri: marque,
    email: "essai-agent@cometestudio.fr",
    first_name: "Louis",
    created_at: new Date(maintenant - 60_000).toISOString(),
    timezone: P,
    reschedule_url: "https://calendly.com/reschedulings/essai",
    questions_and_answers: peggy.formulaire.map((q, position) => ({
      question: q.question,
      answer: position === 0 ? telephone : q.exemple,
      position,
    })),
    scheduled_event: {
      uri: `${marque}:rdv`,
      start_time: new Date(rdv).toISOString(),
      end_time: new Date(rdv + 45 * 60_000).toISOString(),
      event_type: null,
      location: { type: "zoom", join_url: "https://zoom.us/j/essai" },
    },
  });
  await ouvrir(admin, org.id, peggy, inv, { delaiMinimumMs: 86_400_000, recuLe: new Date().toISOString(), simulation: false });
  const [c] = await essais();
  if (!c) throw new Error("Conversation non ouverte.");

  await admin.from("agent_messages").insert({
    conversation_id: c.id,
    organization_id: org.id,
    sens: "sortant",
    genre: "modele",
    modele: "reservation",
    cle_envoi: "reservation",
    texte: "(essai : modèle de réservation non envoyé, en attente de validation par Meta)",
    canal: "whatsapp",
    statut: "echec",
    erreur: "Essai : non envoyé exprès.",
  });
  await admin.from("agent_reglages").update({ canal: "whatsapp" }).eq("organization_id", org.id);
  const { data: rg } = await admin.from("agent_reglages").select("actif, canal").eq("organization_id", org.id).single();
  console.log(`Conversation d'essai ouverte (${c.etat}), rendez-vous fictif le ${c.rdv_debut}.`);
  console.log(`Réglage de Peggy : actif ${rg.actif}, canal ${rg.canal}.`);
  process.exit(0);
}

if (process.argv.includes("--etat")) {
  for (const c of await essais()) {
    const { data } = await admin
      .from("agent_messages")
      .select("created_at, sens, genre, statut, erreur, texte, id_externe")
      .eq("conversation_id", c.id)
      .order("created_at");
    console.log(`Conversation ${c.etat}`);
    for (const m of data ?? []) {
      const h = new Date(m.created_at).toLocaleTimeString("fr-FR", { timeZone: P });
      console.log(`  ${h} ${m.sens} ${m.genre} [${m.statut}]${m.erreur ? ` (${m.erreur})` : ""}${m.id_externe ? " wamid" : ""}`);
      console.log(`     ${m.texte.replace(/\n/g, " / ").slice(0, 300)}`);
    }
  }
  process.exit(0);
}

if (process.argv.includes("--fermer")) {
  const liste = await essais();
  for (const c of liste) await admin.from("agent_conversations").delete().eq("id", c.id);
  await admin.from("agent_reglages").update({ canal: "simule" }).eq("organization_id", org.id);
  const { data: rg } = await admin.from("agent_reglages").select("actif, canal").eq("organization_id", org.id).single();
  console.log(`${liste.length} conversation(s) d'essai effacée(s). Réglage de Peggy : actif ${rg.actif}, canal ${rg.canal}.`);
  process.exit(0);
}

console.log("Usage : --ouvrir +33XXXXXXXXX | --etat | --fermer");
