/**
 * Banc — l'agent WhatsApp branché sur l'outil de réservation maison, contre
 * la vraie base.
 *
 *   npm run qa:agent-outil
 *
 * Un client neuf, sa titulaire (lundi et mardi 14h-16h, agendas simulés),
 * l'agent allumé sur le canal simulé. On vérifie :
 * 1. une réservation de l'outil ouvre une conversation suivie (numéro, façon
 *    de décider, lien personnel `/mon-rdv/#…`), une seule même rejouée ;
 * 2. un report par la cliente garde la conversation, qui suit le nouveau
 *    rendez-vous et le tient pour confirmé ;
 * 3. un report par l'agent passe par le moteur (`reporter`, « agent ») ;
 * 4. la fenêtre entière de l'agent voit plus loin que la page ;
 * 5. une annulation arrête la conversation ;
 * 6. agent éteint : rien ne s'ouvre.
 *
 * Rien ne part : ni WhatsApp (canal simulé, l'horloge ne tourne pas ici), ni
 * Google, ni Radar (le client de test n'a pas Radar). Décor préfixé `zz-qa-`,
 * supprimé à la fin, même en cas d'échec.
 */
import { createClient } from "@supabase/supabase-js";

import { annoncerCible, creer, creerCompte, env, journal, srv, supprimerCompte, vide } from "./qa-commun.mjs";

import { agentRecoitInvitation } from "../src/tools/agent/conversations.ts";
import {
  fenetreEntiere,
  invitationDepuisRdv,
  lienMonRdv,
  TYPE_OUTIL,
  uriOutil,
} from "../src/tools/agent/outil-regles.ts";
import { peggy } from "../src/tools/agent/profils/peggy.ts";
import { ajouterJours, instantLocal, jourLocal } from "../src/tools/agent/temps.ts";
import { depotSupabase } from "../src/tools/reservation/depot.ts";
import { creneauxLibres, reporter, reserver } from "../src/tools/reservation/moteur.ts";

annoncerCible("Banc — l'agent sur l'outil de réservation");

const { verifie, bilan } = journal();
const marque = Date.now().toString(36);
const P = "Europe/Paris";

// Un lundi dans deux semaines au moins, loin du préavis et des 24 h de l'agent.
const aujourdhui = jourLocal(Date.now(), P);
let lundi = ajouterJours(aujourdhui, 14);
while (new Date(`${lundi}T12:00:00Z`).getUTCDay() !== 1) lundi = ajouterJours(lundi, 1);
const mardi = ajouterJours(lundi, 1);
const a = (jour, h, m = 0) => new Date(instantLocal(jour, h, m, P)).toISOString();

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const depot = depotSupabase(admin);
const agendas = { occupe: async () => [] };

const COLONNES_RDV =
  "id, organization_id, debut, fin, created_at, prenom, nom, email, telephone, fuseau_cliente, lien_visio, reponses, statut";
const lireRdv = async (id) =>
  (await admin.from("reservation_rendez_vous").select(COLONNES_RDV).eq("id", id).single()).data;
const conversations = async (org) =>
  (
    await admin
      .from("agent_conversations")
      .select("id, invitee_uri, invites_precedents, event_type_uri, etat, telephone, facon_de_decider, lien_report, rdv_debut, confirme_le, simulation")
      .eq("organization_id", org)
  ).data ?? [];

const jeton = "a".repeat(64);
const lien = lienMonRdv(peggy.urlTarifs, jeton);

let org = null;
let compte = null;

try {
  compte = await creerCompte(`zz-qa-agent-outil-${marque}@cometestudio.fr`);
  org = await creer("organizations", { name: "ZZ QA Agent outil", slug: `zz-qa-agent-outil-${marque}` });
  await creer("memberships", { organization_id: org.id, user_id: compte, role: "owner" });
  await creer("reservation_reglages", { organization_id: org.id, actif: true, preavis_minutes: 240, fenetre_max_jours: 30 });
  const titulaire = await creer("reservation_personnes", {
    organization_id: org.id,
    user_id: compte,
    role: "titulaire",
    google_connecte_le: new Date().toISOString(),
    // Sans agenda « Diagnostics », le moteur l'écarte (`agendaConnecte`).
    google_agenda: `zz-qa-${marque}@group.calendar.google.com`,
  });
  for (const jour of [1, 2]) {
    await creer("reservation_horaires", { personne_id: titulaire.id, organization_id: org.id, jour, debut: "14:00", fin: "16:00" });
  }
  await creer("agent_reglages", { organization_id: org.id, profil: "peggy", actif: true, canal: "simule" });

  const donnees = {
    origine: "essai",
    prenom: "Camille",
    nom: "Essai",
    email: `zz-qa-${marque}@comete-qa.test`,
    telephone: "+33600000000",
    fuseauCliente: P,
    reponses: [
      { question: "Ton numéro de téléphone (pour le rappel du rdv et des conseils via WhatsApp)", reponse: "06 00 00 00 00" },
      { question: "Comment tu fonctionnes quand tu décides de changer ?", reponse: "J'avance pas à pas" },
    ],
    utm: { utm_campaign: "test-qa" },
    jetonHash: `zz-${marque}-1`,
  };

  // --------------------------- 1. La réservation ----------------------------
  console.log("== 1. Une réservation de l'outil ouvre la conversation ==");
  const r1 = await reserver(org.id, a(lundi, 14), donnees, Date.now(), depot, agendas);
  verifie("le moteur réserve le lundi 14h", r1.ok, JSON.stringify(r1));
  const rdv1 = await lireRdv(r1.id);
  const inv1 = invitationDepuisRdv(rdv1, { lienPersonnel: lien });
  const issue1 = await agentRecoitInvitation(admin, org.id, "creee", inv1, new Date().toISOString());
  verifie("l'agent répond ok", issue1 === "ok", issue1);
  await agentRecoitInvitation(admin, org.id, "creee", inv1, new Date().toISOString());
  let cs = await conversations(org.id);
  verifie("une seule conversation, même rejouée", cs.length === 1, JSON.stringify(cs));
  const c = cs[0];
  verifie("suivie (active), en vrai, pas en simulation", c?.etat === "active" && c?.simulation === false, JSON.stringify(c));
  verifie("adresse reservation:<id>, type de l'outil", c?.invitee_uri === uriOutil(r1.id) && c?.event_type_uri === TYPE_OUTIL);
  verifie("le numéro au format WhatsApp", c?.telephone === "+33600000000", c?.telephone);
  verifie("sa façon de décider lue", c?.facon_de_decider === "pas_a_pas", c?.facon_de_decider);
  verifie("le lien personnel pour déplacer", c?.lien_report === `https://www.peggygirault.fr/mon-rdv/#${jeton}`, c?.lien_report);
  verifie("pas encore confirmé", c?.confirme_le === null);

  // ------------------------ 2. Report par la cliente -------------------------
  console.log("== 2. Elle déplace par son lien ==");
  const r2 = await reporter(org.id, r1.id, a(lundi, 15), "cliente", Date.now(), depot, agendas);
  verifie("le moteur déplace à 15h", r2.ok, JSON.stringify(r2));
  const inv2 = invitationDepuisRdv(await lireRdv(r2.id), { lienPersonnel: lien, ancienRdvId: r1.id });
  await agentRecoitInvitation(admin, org.id, "creee", inv2, new Date().toISOString());
  cs = await conversations(org.id);
  const c2 = cs[0];
  verifie("toujours une seule conversation", cs.length === 1, JSON.stringify(cs));
  verifie("elle suit le nouveau rendez-vous", c2?.invitee_uri === uriOutil(r2.id) && Date.parse(c2.rdv_debut) === Date.parse(a(lundi, 15)));
  verifie("l'ancien est gardé en mémoire", c2?.invites_precedents?.includes(uriOutil(r1.id)), JSON.stringify(c2?.invites_precedents));
  verifie("un créneau choisi vaut confirmation", c2?.confirme_le !== null);

  // ------------------------- 3. Report par l'agent ---------------------------
  console.log("== 3. L'agent déplace par le moteur ==");
  const r3 = await reporter(org.id, r2.id, a(mardi, 14), "agent", Date.now(), depot, agendas);
  verifie("le moteur déplace au mardi 14h", r3.ok, JSON.stringify(r3));
  const ancien = await lireRdv(r2.id);
  verifie("l'ancien est annulé en base", ancien?.statut === "annule", ancien?.statut);

  // ------------------------- 4. La fenêtre entière ---------------------------
  console.log("== 4. L'agent voit toute la fenêtre ==");
  const page = await creneauxLibres(org.id, Date.now(), depot, agendas);
  const agent = await creneauxLibres(org.id, Date.now(), fenetreEntiere(depot), agendas);
  const dernier = (d) => (d.etat === "ouvert" && d.creneaux.length > 0 ? Date.parse(d.creneaux.at(-1).debut) : 0);
  verifie("la page s'arrête à la première fenêtre qui a des créneaux", page.etat === "ouvert" && page.jours < 30, `${page.etat} ${page.jours}`);
  verifie("l'agent lit jusqu'à 30 jours", agent.etat === "ouvert" && agent.jours === 30, `${agent.etat} ${agent.jours}`);
  verifie("… et voit plus loin que la page", dernier(agent) > dernier(page));

  // --------------------------- 5. L'annulation -------------------------------
  console.log("== 5. Elle annule ==");
  const annule = await admin.rpc("reservation_annuler", { rendez_vous: r3.id, par: "cliente" });
  verifie("la base annule", !annule.error, annule.error?.message);
  // La conversation suit r3 comme le fera `reponse.ts` après un report de l'agent.
  await admin.from("agent_conversations").update({ invitee_uri: uriOutil(r3.id) }).eq("id", c.id);
  await agentRecoitInvitation(admin, org.id, "annulee", invitationDepuisRdv(await lireRdv(r3.id), { lienPersonnel: null }), new Date().toISOString());
  cs = await conversations(org.id);
  verifie("la conversation s'arrête", cs[0]?.etat === "annulee", cs[0]?.etat);

  // --------------------------- 6. Agent éteint -------------------------------
  console.log("== 6. Agent éteint ==");
  await admin.from("agent_reglages").update({ actif: false }).eq("organization_id", org.id);
  const r4 = await reserver(org.id, a(mardi, 15), { ...donnees, jetonHash: `zz-${marque}-4` }, Date.now(), depot, agendas);
  verifie("le moteur réserve encore", r4.ok, JSON.stringify(r4));
  await agentRecoitInvitation(admin, org.id, "creee", invitationDepuisRdv(await lireRdv(r4.id), { lienPersonnel: lien }), new Date().toISOString());
  cs = await conversations(org.id);
  verifie("rien de nouveau ne s'ouvre", cs.length === 1, JSON.stringify(cs.map((x) => x.invitee_uri)));
} catch (erreur) {
  verifie("le banc a tourné jusqu'au bout", false, erreur instanceof Error ? erreur.stack ?? erreur.message : String(erreur));
} finally {
  if (org) {
    const r = await srv("DELETE", `organizations?id=eq.${org.id}`);
    if (r.status >= 300) console.log(`  ménage : ${r.status} ${JSON.stringify(r.data)}`);
    verifie("aucun reste dans agent_conversations", vide(await srv("GET", `agent_conversations?select=id&organization_id=eq.${org.id}`)));
    verifie("aucun reste dans reservation_rendez_vous", vide(await srv("GET", `reservation_rendez_vous?select=id&organization_id=eq.${org.id}`)));
  }
  if (compte) await supprimerCompte(compte);
  bilan();
}
