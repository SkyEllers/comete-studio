/**
 * Banc de QA — la trace de l'agent dans Radar (0041), de bout en bout.
 *
 * Il envoie de vrais messages Calendly signés à la route du webhook d'un
 * serveur qui tourne (par défaut `next start -p 3101` de la copie de
 * travail), dans l'ordre où Calendly les enverrait quand l'agent déplace un
 * rendez-vous : la réservation neuve (sans `old_invitee`), puis l'annulation
 * de l'ancien par l'hôte.
 *
 * 1. Une réservation suivie par l'agent : sa marque Radar est « en_cours ».
 * 2. Le report de l'agent : le nouveau rendez-vous hérite du canal et de la
 *    closeuse, pointe vers l'ancien, et porte la marque « confirme ».
 * 3. L'annulation de l'ancien est une reprogrammation par l'assistante, pas
 *    une annulation du client.
 * 4. Une vraie annulation par l'hôte reste une annulation.
 * 5. STOP se lit dans Radar.
 * 6. Le mail du matin : les rendez-vous de la closeuse partent chez elle ;
 *    retirée du client, ils reviennent au client.
 *
 *   npm run qa:agent-radar                 # http://localhost:3101
 *   npm run qa:agent-radar -- <adresse>
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { annoncerCible, creer, creerCompte, env, journal, srv, supprimerCompte } from "./qa-commun.mjs";

import { diagnosticsDuJour, repartir } from "../src/tools/agent/resume.ts";
import { ajouterJours, jourLocal } from "../src/tools/agent/temps.ts";

annoncerCible("QA — Agent, la trace dans Radar");

delete process.env.RESEND_API_KEY;

const BASE = (process.argv[2] ?? "http://localhost:3101").replace(/\/+$/, "");
const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TYPE = "https://api.calendly.com/event_types/EEEEEEEE";
const CLE = "cle-de-signature-agent-0123456789abcdef";
const SEL = "sel-agent-fedcba9876543210";
const EMAIL = `camille-${marque}@example.com`;

const invitee = (s) => `https://api.calendly.com/scheduled_events/zz-agent-${marque}/invitees/${s}`;
const evenement = (s) => `https://api.calendly.com/scheduled_events/zz-agent-${marque}-${s}`;
/** Dans `jours` jours à 10h UTC, au format de Calendly. */
const dans = (jours, heure = 10) => {
  const d = new Date(Date.now() + jours * 86_400_000);
  d.setUTCHours(heure, 0, 0, 0);
  return d.toISOString().replace(".000Z", ".000000Z");
};
const plus45 = (iso) => new Date(Date.parse(iso) + 45 * 60_000).toISOString().replace(".000Z", ".000000Z");

const gabarit = (fichier, r) => {
  let texte = readFileSync(new URL(`../src/tools/resultats/fixtures/${fichier}`, import.meta.url), "utf8");
  for (const [cle, valeur] of Object.entries(r)) texte = texte.split(`{{${cle}}}`).join(valeur);
  return texte;
};
// Avec un numéro : sans lui, l'agent laisse le rendez-vous hors champ.
const creation = (s, debut, email = EMAIL) =>
  gabarit("cree-gratuit.json", { EMAIL: email, INVITEE_URI: invitee(s), EVENT_URI: evenement(s), START: debut, END: plus45(debut) })
    .replace('"text_reminder_number": null', '"text_reminder_number": "+33600000000"');
const annulationHote = (s, debut, email = EMAIL) =>
  gabarit("annule.json", { EMAIL: email, INVITEE_URI: invitee(s), EVENT_URI: evenement(s), START: debut, END: plus45(debut) })
    .replace('"canceler_type": "invitee"', '"canceler_type": "host"');

let orgId = null;
const poster = async (corps) => {
  const t = Math.floor(Date.now() / 1000);
  const r = await fetch(`${BASE}/api/webhooks/calendly/${orgId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Calendly-Webhook-Signature": `t=${t},v1=${createHmac("sha256", CLE).update(`${t}.${corps}`).digest("hex")}`,
    },
    body: corps,
  });
  return r.status;
};

const rdv = async (s) =>
  (await admin.from("radar_bookings").select("*").eq("organization_id", orgId).eq("invitee_uri", invitee(s)).maybeSingle()).data;
const activites = async (id) =>
  (await admin.from("radar_booking_activities").select("type, payload").eq("booking_id", id)).data ?? [];
const conversationDe = async (email) =>
  (await admin.from("agent_conversations").select("*").eq("organization_id", orgId).eq("email", email)).data ?? [];

let closeuse = null;

try {
  // ------------------------------- Décor -----------------------------------
  const org = await creer("organizations", { name: "ZZ QA Agent Radar", slug: `zz-qa-agent-radar-${marque}` });
  orgId = org.id;
  const outil = (await srv("GET", "tools?select=id&slug=eq.resultats")).data[0].id;
  await creer("organization_tools", { organization_id: orgId, tool_id: outil, enabled: true });
  await creer("radar_settings", { organization_id: orgId, window_days: 90, currency: "EUR", connected_at: new Date().toISOString() });
  await srv("POST", "rpc/radar_set_secret", { org: orgId, kind: "signing_key", value: CLE });
  await srv("POST", "rpc/radar_set_secret", { org: orgId, kind: "salt", value: SEL });
  const canal = await creer("radar_channels", { organization_id: orgId, key: "zz-facebook", label: "Facebook (QA)", sort_order: 1 });
  await creer("agent_reglages", {
    organization_id: orgId,
    profil: "peggy",
    actif: true,
    types_suivis: [TYPE],
    resume_actif: true,
    resume_destinataires: [`client-${marque}@comete-qa.test`],
  });
  const mailCloseuse = `zz-qa-closeuse-${marque}@comete-qa.test`;
  closeuse = await creerCompte(mailCloseuse);
  await creer("radar_closeuses", { organization_id: orgId, user_id: closeuse });

  // ------------------- 1. Une réservation suivie ----------------------------
  const S1 = dans(6);
  verifie("réservation → 200", (await poster(creation("a", S1))) === 200);
  const a = await rdv("a");
  verifie("Radar l'a notée", Boolean(a));
  // Le canal et la closeuse d'origine, posés à la main : c'est ce que le
  // report doit transmettre.
  await admin.from("radar_bookings").update({ channel_id: canal.id, closeuse_id: closeuse }).eq("id", a.id);
  const [c1] = await conversationDe(EMAIL);
  verifie("l'agent a ouvert sa conversation, reliée au rendez-vous", c1?.booking_id === a.id);
  verifie("marque Radar : en_cours", (await rdv("a")).agent_suivi === "en_cours", (await rdv("a")).agent_suivi);

  // ------------------------ 2. Le report de l'agent --------------------------
  const S2 = dans(3, 13);
  await admin.from("agent_conversations").update({ report_attendu: S2 }).eq("id", c1.id);
  verifie("réservation de l'agent → 200", (await poster(creation("b", S2))) === 200);
  const b = await rdv("b");
  verifie("le nouveau pointe vers l'ancien", b?.rescheduled_from === a.id, JSON.stringify(b?.rescheduled_from));
  verifie("… hérite du canal", b?.channel_id === canal.id);
  verifie("… et de la closeuse", b?.closeuse_id === closeuse);
  verifie(
    "… activité « reprogrammé » marquée agent",
    (await activites(b.id)).some((x) => x.type === "booking.rescheduled" && x.payload?.agent === true),
  );
  const [c2] = await conversationDe(EMAIL);
  verifie("la conversation suit le nouveau rendez-vous", c2.booking_id === b.id && c2.invitee_uri === invitee("b"));
  verifie("marque Radar du nouveau : confirme", (await rdv("b")).agent_suivi === "confirme", (await rdv("b")).agent_suivi);

  // --------------------- 3. L'annulation de l'ancien -------------------------
  // Ce que `deplacerRendezVous` écrit après la réservation réussie.
  await admin.from("agent_conversations").update({ reports_agent: 1 }).eq("id", c1.id);
  verifie("annulation de l'ancien par l'hôte → 200", (await poster(annulationHote("a", S1))) === 200);
  const aApres = await rdv("a");
  verifie("l'ancien est « Reprogrammée par l'assistante »", aApres.status_note === "Reprogrammée par l'assistante", aApres.status_note);
  verifie(
    "… compté comme reprogrammé, pas comme annulé par le client",
    (await activites(a.id)).some((x) => x.type === "booking.canceled" && x.payload?.reprogramme === true && x.payload?.par === null && x.payload?.agent === true),
  );
  verifie("la conversation reste en cours", (await conversationDe(EMAIL))[0].etat === "active");

  // ---------------------- 4. Une vraie annulation ----------------------------
  const EMAIL_C = `dominique-${marque}@example.com`;
  const S3 = dans(5);
  await poster(creation("c", S3, EMAIL_C));
  await poster(annulationHote("c", S3, EMAIL_C));
  verifie("une vraie annulation par l'hôte reste « Annulée par toi »", (await rdv("c")).status_note === "Annulée par toi dans Calendly", (await rdv("c")).status_note);
  verifie("… et arrête sa conversation", (await conversationDe(EMAIL_C))[0]?.etat === "annulee");

  // ------------------------------- 5. STOP -----------------------------------
  await admin.from("agent_conversations").update({ etat: "stop" }).eq("id", c1.id);
  verifie("STOP se lit dans Radar", (await rdv("b")).agent_suivi === "stop");
  await admin.from("agent_conversations").update({ etat: "active" }).eq("id", c1.id);

  // -------------------------- 6. Le mail du matin ----------------------------
  const jourB = jourLocal(S2, "Europe/Paris");
  const diag = await diagnosticsDuJour(admin, orgId, jourB, false);
  const envois = await repartir(admin, orgId, [`client-${marque}@comete-qa.test`], diag);
  verifie(
    "le rendez-vous de la closeuse part chez elle",
    envois.length === 1 && envois[0].a[0] === mailCloseuse && envois[0].diagnostics.length === 1,
    JSON.stringify(envois.map((e) => e.a)),
  );
  await admin.from("radar_closeuses").delete().eq("organization_id", orgId).eq("user_id", closeuse);
  const envois2 = await repartir(admin, orgId, [`client-${marque}@comete-qa.test`], diag);
  verifie(
    "retirée du client, il revient au client",
    envois2.length === 1 && envois2[0].a[0] === `client-${marque}@comete-qa.test`,
    JSON.stringify(envois2.map((e) => e.a)),
  );
  const autreJour = await diagnosticsDuJour(admin, orgId, ajouterJours(jourB, 1), false);
  verifie("un autre jour ne reprend pas ce rendez-vous", autreJour.every((d) => d.prenom !== "Camille"));
} catch (erreur) {
  verifie("le banc a tourné jusqu'au bout", false, erreur instanceof Error ? erreur.stack : String(erreur));
} finally {
  if (orgId) {
    await srv("POST", "rpc/radar_clear_secrets", { org: orgId });
    await srv("DELETE", `organizations?id=eq.${orgId}`);
    const reste = await srv("GET", `radar_bookings?select=id&organization_id=eq.${orgId}`);
    verifie("aucun reste dans Radar", (reste.data ?? []).length === 0);
  }
  if (closeuse) await supprimerCompte(closeuse);
  bilan();
}
