/**
 * Banc de QA — le mail du matin de l'agent, contre la vraie base.
 *
 * 1. Avant 8h (heure de Paris), rien.
 * 2. La journée : les vraies conversations du jour, avec ce qu'elles ont dit
 *    à l'agent ; ni les simulations, ni les autres jours, ni les annulées.
 * 3. Un mail refusé rend la journée : le passage suivant réessaie.
 * 4. Une journée déjà prise ne repart pas.
 * 5. Un client sans mail du matin, ou sans agent lancé, n'est pas touché.
 *
 * Aucun mail : la clé Resend est retirée (le mail lui-même est éprouvé par
 * `resume-regles.test.ts` et par l'envoi de test de la page Agent).
 * Décor préfixé `zz-qa-`, supprimé en fin de course.
 */
import { createClient } from "@supabase/supabase-js";

import { annoncerCible, creer, env, journal, srv, vide } from "./qa-commun.mjs";

import { diagnosticsDuJour, envoyerResumes } from "../src/tools/agent/resume.ts";
import { ajouterJours, instantLocal, jourLocal } from "../src/tools/agent/temps.ts";

annoncerCible("QA — Agent, le mail du matin");

delete process.env.RESEND_API_KEY;

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const P = "Europe/Paris";
const jour = jourLocal(Date.now(), P);
const a = (j, h, m = 0) => new Date(instantLocal(j, h, m, P)).toISOString();

async function conversation(org, suffixe, surcharge) {
  const rdv = surcharge.rdv_debut ?? a(jour, 14);
  return creer("agent_conversations", {
    organization_id: org,
    invitee_uri: `zz-qa:${marque}:${suffixe}`,
    rdv_debut: rdv,
    rdv_fin: new Date(Date.parse(rdv) + 45 * 60_000).toISOString(),
    reserve_le: a(ajouterJours(jour, -8), 12),
    prenom: suffixe,
    efface_apres: a(ajouterJours(jour, 30), 12),
    ...surcharge,
  });
}

const reglage = async (org) =>
  (await admin.from("agent_reglages").select("resume_envoye_le").eq("organization_id", org).single()).data;

const orgs = [];

try {
  const [org, eteint] = [
    await creer("organizations", { name: "ZZ QA Agent matin", slug: `zz-qa-agent-matin-${marque}` }),
    await creer("organizations", { name: "ZZ QA Agent matin éteint", slug: `zz-qa-agent-matin-off-${marque}` }),
  ];
  orgs.push(org, eteint);
  await creer("agent_reglages", {
    organization_id: org.id,
    profil: "peggy",
    actif: true,
    resume_actif: true,
    resume_destinataires: [`zz-qa-${marque}@comete-qa.test`],
  });
  await creer("agent_reglages", {
    organization_id: eteint.id,
    profil: "peggy",
    actif: true,
    resume_actif: false,
    resume_destinataires: [`zz-qa-${marque}@comete-qa.test`],
  });

  const sandrine = await conversation(org.id, "Sandrine", { confirme_le: a(ajouterJours(jour, -1), 10) });
  await creer("agent_messages", {
    conversation_id: sandrine.id,
    organization_id: org.id,
    sens: "entrant",
    genre: "texte",
    texte: "J'ai une hypothyroïdie",
    canal: "simule",
    statut: "recu",
    comprehension: { ia: { note_pour_peggy: "Hypothyroïdie, renvoyée vers son médecin" } },
  });
  await conversation(org.id, "Nadia", { rdv_debut: a(jour, 10), sans_reponse_veille: true });
  await conversation(org.id, "Simulee", { simulation: true });
  await conversation(org.id, "Annulee", { etat: "annulee" });
  await conversation(org.id, "Demain", { rdv_debut: a(ajouterJours(jour, 1), 10) });
  await conversation(eteint.id, "Eteinte", {});

  // ------------------------------ 2. La journée ------------------------------

  const d = await diagnosticsDuJour(admin, org.id, jour, false);
  verifie(
    "les vraies conversations du jour, dans l'ordre",
    d.map((x) => x.prenom).join(",") === "Nadia,Sandrine",
    d.map((x) => x.prenom).join(","),
  );
  verifie(
    "avec ce qu'elle a dit à l'agent",
    d.find((x) => x.prenom === "Sandrine")?.notes[0] === "Hypothyroïdie, renvoyée vers son médecin",
  );
  const avecSim = await diagnosticsDuJour(admin, org.id, jour, true);
  verifie("l'envoi de test y ajoute les simulations", avecSim.some((x) => x.prenom === "Simulee"));

  // -------------------------------- 1. Avant 8h -------------------------------

  const tot = await envoyerResumes(admin, instantLocal(jour, 7, 55, P));
  verifie("avant 8h : rien", tot === 0 && (await reglage(org.id)).resume_envoye_le === null);

  // ------------------------- 3. Mail refusé : on réessaie ---------------------

  await envoyerResumes(admin, instantLocal(jour, 8, 5, P));
  verifie("mail refusé : la journée est rendue", (await reglage(org.id)).resume_envoye_le === null);
  verifie("un client au mail éteint n'est pas touché", (await reglage(eteint.id)).resume_envoye_le === null);

  // --------------------------- 4. Journée déjà prise --------------------------

  await admin.from("agent_reglages").update({ resume_envoye_le: jour }).eq("organization_id", org.id);
  await envoyerResumes(admin, instantLocal(jour, 8, 10, P));
  verifie("journée déjà prise : elle le reste", (await reglage(org.id)).resume_envoye_le === jour);

  // -------------------------- 5. Contrainte d'adresses ------------------------

  const { error } = await admin
    .from("agent_reglages")
    .update({ resume_destinataires: ["a@b.fr, c@d.fr"] })
    .eq("organization_id", org.id);
  verifie("la base refuse une virgule dans une adresse", Boolean(error));
} catch (erreur) {
  verifie("le banc a tourné jusqu'au bout", false, erreur instanceof Error ? erreur.stack : String(erreur));
} finally {
  for (const org of orgs) await srv("DELETE", `organizations?id=eq.${org.id}`);
  for (const org of orgs) {
    verifie(
      `aucun reste pour ${org.slug}`,
      vide(await srv("GET", `agent_conversations?select=id&organization_id=eq.${org.id}`)) &&
        vide(await srv("GET", `agent_reglages?select=organization_id&organization_id=eq.${org.id}`)),
    );
  }
  bilan();
}
