/**
 * Essai réel — l'agent réserve un vrai créneau chez Peggy, puis l'annule.
 *
 * Les deux gestes que l'agent fait dans Calendly lors d'un report
 * (`reserver`, `annulerAncien` de `src/tools/agent/calendly.ts`) n'ont
 * jamais tourné pour de vrai : les bancs les simulent. Cet essai les fait
 * tourner une fois, avec le jeton de l'agent, sur un créneau libre lointain.
 *
 *   Sans argument : lecture seule. Montre le type de séance, le créneau
 *   choisi, les réponses au formulaire qui partiraient. Rien n'est écrit.
 *
 *   --reserver : réserve ce créneau au nom de « Essai Agent »
 *   (essai-agent@cometestudio.fr), attend une minute, l'annule, puis relit
 *   l'événement pour vérifier qu'il est bien annulé.
 *
 * Effets de --reserver : Peggy reçoit deux mails de Calendly (réservation,
 * annulation) ; un lien Zoom est créé puis annulé ; Radar compte une
 * réservation et une annulation (heures affichées à la fin, à exclure).
 * L'adresse d'essai n'est dans aucune liste de Peggy : pas de conversion
 * Meta (le site n'en envoie que pour un contact connu et consentant).
 */
import { createClient } from "@supabase/supabase-js";

import { env } from "./qa-commun.mjs";

import { annulerAncien, creneauxLibres, jetonAgent, reserver } from "../src/tools/agent/calendly.ts";
import { heureEnMots, jourEnMots } from "../src/tools/agent/temps.ts";

const P = "Europe/Paris";
const EMAIL = "essai-agent@cometestudio.fr";
const PRENOM = "Essai";
const NOM = "Agent";
const RAISON = "Essai technique de Comète Studio, rendez-vous annulé automatiquement.";
const JOUR_MS = 86_400_000;
/** Au moins trois semaines d'écart : là où l'agenda de Peggy est le moins demandé. */
const ECART_MIN_JOURS = 21;
const PAUSE_MS = 60_000;

const reel = process.argv.includes("--reserver");
const ENTETES = (jeton) => ({ Authorization: `Bearer ${jeton}`, "User-Agent": "comete-hub-agent/1.0" });
const quand = (iso) => `${jourEnMots(iso, P)} à ${heureEnMots(iso, P)}`;

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: org } = await admin.from("organizations").select("id").eq("slug", "peggy").single();
const { data: reglages } = await admin
  .from("agent_reglages")
  .select("types_suivis")
  .eq("organization_id", org.id)
  .single();
const typeUri = reglages?.types_suivis?.[0];
if (!typeUri) throw new Error("Aucun type de séance suivi par l'agent chez Peggy.");

const jeton = await jetonAgent(admin, org.id);
if (!jeton) throw new Error("Jeton Calendly de l'agent introuvable dans le Vault.");

// Le type de séance et ses vraies questions, lus chez Calendly.
const typeRep = await fetch(typeUri, { headers: ENTETES(jeton) });
if (!typeRep.ok) throw new Error(`Type de séance illisible (${typeRep.status}).`);
const type = (await typeRep.json()).resource;

// Une réponse d'essai par question active, lisible comme telle par Peggy.
const reponses = (type.custom_questions ?? [])
  .filter((q) => q.enabled)
  .map((q) => {
    let answer = "Essai technique Comète, à ignorer";
    if (q.type === "phone_number") answer = "+33 6 00 00 00 00";
    // La source : le dernier choix (Newsletter), pour ne gonfler ni Facebook ni
    // Instagram, que Peggy compare. Le reste : le premier choix.
    else if (q.type === "single_select" || q.type === "multi_select")
      answer = (/connue/i.test(q.name) ? q.answer_choices?.at(-1) : q.answer_choices?.[0]) ?? answer;
    return { question: q.name, answer, position: q.position, requise: q.required, forme: q.type };
  });

// Le premier créneau libre à au moins trois semaines.
const depuis = Date.now() + ECART_MIN_JOURS * JOUR_MS;
const libres = await creneauxLibres(jeton, typeUri, depuis, 7);
if (!libres?.length) throw new Error("Aucun créneau libre entre J+21 et J+28.");
const creneau = libres[0];

console.log(`\nType de séance : ${type.name} (${type.duration} min)`);
console.log(`Créneau choisi : ${quand(creneau)} (${libres.length} libres sur la semaine)`);
console.log(`Au nom de      : ${PRENOM} ${NOM} <${EMAIL}>`);
console.log("\nRéponses au formulaire :");
for (const r of reponses) {
  console.log(`  - [${r.forme}${r.requise ? ", requise" : ""}] ${r.question}\n      → ${r.answer}`);
}

if (!reel) {
  console.log("\nLecture seule : rien n'a été réservé. Pour l'essai réel : ajouter --reserver.\n");
  process.exit(0);
}

console.log("\n1. Réservation…");
const pris = await reserver(jeton, {
  typeUri,
  debut: creneau,
  prenom: PRENOM,
  nom: NOM,
  email: EMAIL,
  fuseau: P,
  reponses: reponses.map(({ question, answer, position }) => ({ question, answer, position })),
});
if (!pris) {
  console.log("   ÉCHEC : Calendly a refusé la réservation (le code d'erreur est plus haut). Rien à annuler.\n");
  process.exit(1);
}
const reserveA = new Date();
console.log(`   OK : ${quand(pris.debut)} → ${heureEnMots(pris.fin, P)}`);
console.log(`   Événement : ${pris.eventUri}`);
console.log(`   Lien visio : ${pris.lienVisio ? "oui" : "non"} · lien de report : ${pris.lienReport ? "oui" : "non"}`);

console.log(`\n2. Pause d'une minute, puis annulation…`);
await new Promise((r) => setTimeout(r, PAUSE_MS));
const annule = await annulerAncien(jeton, pris.eventUri, RAISON);
const annuleA = new Date();
console.log(annule ? "   OK : annulation acceptée" : "   ÉCHEC : annulation refusée. À ANNULER À LA MAIN dans le Calendly de Peggy.");

console.log("\n3. Relecture de l'événement…");
const relu = await fetch(pris.eventUri, { headers: ENTETES(jeton) });
const statut = relu.ok ? (await relu.json()).resource.status : `illisible (${relu.status})`;
console.log(`   Statut chez Calendly : ${statut}`);

console.log("\nÀ exclure de Radar :");
console.log(`   réservation vers ${heureEnMots(reserveA, P)}, annulation vers ${heureEnMots(annuleA, P)} (${jourEnMots(reserveA, P)})`);
console.log(`   ${EMAIL} · ${pris.eventUri}\n`);
process.exit(annule && statut === "canceled" ? 0 : 1);
