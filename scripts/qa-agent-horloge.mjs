/**
 * Banc de QA — l'horloge de l'agent, par la vraie route.
 *
 * Il appelle `POST /api/agent/horloge` sur un serveur qui tourne (par défaut
 * le serveur local de la copie de travail, `next start -p 3101`) :
 *
 * 1. Sans en-tête, ou avec un mauvais secret : 401, rien ne part.
 * 2. Avec le secret : une conversation dont le premier message attend le
 *    reçoit, une seule fois, même si l'horloge passe deux fois.
 *
 * Le secret est lu dans `.env.local` (AGENT_HORLOGE_SECRET), celui du serveur
 * visé. Décor préfixé `zz-qa-`, supprimé en fin de course.
 *
 *   npm run qa:agent-horloge                 # http://localhost:3101
 *   npm run qa:agent-horloge -- <adresse>
 */
import { createClient } from "@supabase/supabase-js";

import { annoncerCible, creer, env, journal, srv, vide } from "./qa-commun.mjs";

import { ouvrir } from "../src/tools/agent/conversations.ts";
import { peggy } from "../src/tools/agent/profils/peggy.ts";
import { invitationCalendly } from "../src/tools/agent/reservation.ts";
import { ajouterJours, instantLocal, jourLocal } from "../src/tools/agent/temps.ts";

annoncerCible("QA — Agent, l'horloge");

const base = (process.argv[2] ?? "http://localhost:3101").replace(/\/+$/, "");
const route = `${base}/api/agent/horloge`;
const secret = env.AGENT_HORLOGE_SECRET;

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const P = "Europe/Paris";
const maintenant = Date.now();
const debut = instantLocal(ajouterJours(jourLocal(maintenant, P), 8), 14, 0, P);

const appeler = (entetes = {}) => fetch(route, { method: "POST", headers: entetes });
const modeles = async (id) =>
  (
    await admin
      .from("agent_messages")
      .select("modele")
      .eq("conversation_id", id)
      .eq("genre", "modele")
  ).data ?? [];

let org = null;

try {
  if (!secret) throw new Error("AGENT_HORLOGE_SECRET manque dans .env.local.");

  org = await creer("organizations", { name: "ZZ QA Agent horloge", slug: `zz-qa-agent-horloge-${marque}` });
  await creer("agent_reglages", { organization_id: org.id, profil: "peggy" });

  const inv = invitationCalendly.parse({
    uri: `zz-qa:${marque}:horloge`,
    email: `zz-qa-${marque}@comete-qa.test`,
    name: "Camille Essai",
    created_at: new Date(maintenant).toISOString(),
    timezone: P,
    questions_and_answers: [{ question: "Ton numéro de téléphone", answer: "06 00 00 00 00", position: 0 }],
    reschedule_url: "https://calendly.com/reschedulings/qa",
    cancel_url: "https://calendly.com/cancellations/qa",
    scheduled_event: {
      uri: `zz-qa:${marque}:horloge:rdv`,
      start_time: new Date(debut).toISOString(),
      end_time: new Date(debut + 45 * 60_000).toISOString(),
      event_type: null,
      location: { type: "zoom", join_url: "https://zoom.us/j/qa" },
    },
  });
  // Ouverte sans passer par le moteur : le premier message attend l'horloge.
  await ouvrir(admin, org.id, peggy, inv, { delaiMinimumMs: 24 * 3_600_000, recuLe: inv.created_at, simulation: true });
  const { data: c } = await admin.from("agent_conversations").select("id").eq("invitee_uri", inv.uri).single();
  verifie("avant l'horloge, rien n'est parti", (await modeles(c.id)).length === 0);

  const sans = await appeler();
  verifie("sans en-tête : 401", sans.status === 401, String(sans.status));
  const faux = await appeler({ Authorization: `Bearer ${"0".repeat(64)}` });
  verifie("mauvais secret : 401", faux.status === 401, String(faux.status));
  verifie("… et rien n'est parti", (await modeles(c.id)).length === 0);

  const un = await appeler({ Authorization: `Bearer ${secret}` });
  const corps = await un.json().catch(() => null);
  verifie("avec le secret : 200", un.status === 200, `${un.status} ${JSON.stringify(corps)}`);
  const apres = await modeles(c.id);
  verifie("le premier message est parti", apres.length === 1 && apres[0].modele === "reservation", JSON.stringify(apres));

  const deux = await appeler({ Authorization: `Bearer ${secret}` });
  verifie("un deuxième passage répond 200", deux.status === 200);
  verifie("… sans rien renvoyer", (await modeles(c.id)).length === 1);
} catch (erreur) {
  verifie("le banc a tourné jusqu'au bout", false, erreur instanceof Error ? erreur.message : String(erreur));
} finally {
  if (org) await srv("DELETE", `organizations?id=eq.${org.id}`);
  if (org) {
    verifie(
      "aucun reste dans agent_conversations",
      vide(await srv("GET", `agent_conversations?select=id&organization_id=eq.${org.id}`)),
    );
  }
  bilan();
}
