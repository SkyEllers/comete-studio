/**
 * Banc de QA — Prospection : les prospects de Comète ne sont à personne d'autre.
 *
 * 1. Un client connecté ne lit ni les prospects ni le suivi, même sans filtre.
 * 2. Il n'écrit rien : ni une fiche, ni une coche, ni chez lui ni ailleurs.
 * 3. La base tient ce qui ne doit jamais casser : une note entre 0 et 5, une
 *    relance qui est une vidéo ou un mail, un suivi qui porte sur un prospect
 *    qui existe.
 * 4. Un prospect retiré du vault emporte son suivi (cascade).
 *
 * Comme les autres bancs : décor préfixé `zz-qa-`, supprimé en fin de course,
 * et l'absence de restes est elle-même une vérification.
 */
import {
  annoncerCible,
  connecter,
  creer,
  creerCompte,
  journal,
  par,
  refuse,
  srv,
  supprimerCompte,
  vide,
} from "./qa-commun.mjs";

annoncerCible("QA — Prospection");

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);

const mailClient = `zz-qa-prospection-${marque}@comete-qa.test`;
const slug = `zz-qa-prospect-${marque}`;
let compte = null;
let org = null;

try {
  // ------------------------------- Décor -----------------------------------

  compte = await creerCompte(mailClient);
  org = await creer("organizations", {
    name: "ZZ QA Prospection",
    slug: `zz-qa-prospection-${marque}`,
  });
  await creer("memberships", { organization_id: org.id, user_id: compte, role: "owner" });

  await creer("prospection_prospects", {
    slug,
    nom: "ZZ QA Praticienne",
    metier: "hypnothérapeute",
    ville: "Nulle-Part",
    statut: "approche",
    canal: "mail",
    contact: "zz-qa@comete-qa.test",
    contacte_le: "2026-09-16",
    relance_le: "2026-09-26",
    note: 4,
    avis_google: 42,
    message: "Bonjour, …",
    historique: [{ date: "2026-09-16", canal: "Mail", texte: "Approche envoyée" }],
    liens: [{ libelle: "Site", url: "https://exemple.test" }],
  });
  await creer("prospection_suivi", { slug, video_filmee_le: "2026-09-21" });

  const jeton = par(await connecter(mailClient));

  // ---------------------------- 1. Lecture ----------------------------------

  console.log("== 1. Lecture ==");

  const fiches = await jeton("GET", "prospection_prospects?select=slug");
  verifie("un client ne voit aucun prospect", vide(fiches), JSON.stringify(fiches.data));

  const parLeSlug = await jeton("GET", `prospection_prospects?select=slug&slug=eq.${slug}`);
  verifie("il ne le voit pas non plus par son slug", vide(parLeSlug), JSON.stringify(parLeSlug.data));

  const suivi = await jeton("GET", "prospection_suivi?select=slug");
  verifie("il ne voit aucune coche", vide(suivi), JSON.stringify(suivi.data));

  // ---------------------------- 2. Écriture ---------------------------------

  console.log("== 2. Écriture ==");

  const creationFiche = await jeton("POST", "prospection_prospects?select=slug", {
    slug: `${slug}-client`,
    nom: "Tentative",
  });
  verifie("il ne crée pas de prospect", refuse(creationFiche), `statut ${creationFiche.status}`);

  const modifFiche = await jeton("PATCH", `prospection_prospects?slug=eq.${slug}&select=slug`, {
    nom: "Réécrit",
  });
  verifie("il ne modifie pas un prospect", refuse(modifFiche), `statut ${modifFiche.status}`);

  const suppressionFiche = await jeton("DELETE", `prospection_prospects?slug=eq.${slug}&select=slug`);
  verifie("il ne supprime pas un prospect", refuse(suppressionFiche), `statut ${suppressionFiche.status}`);

  const cocheClient = await jeton("POST", "prospection_suivi?select=slug", {
    slug,
    relance_envoyee_le: "2026-09-26",
  });
  verifie("il ne coche rien", refuse(cocheClient), `statut ${cocheClient.status}`);

  const intact = await srv("GET", `prospection_prospects?select=nom&slug=eq.${slug}`);
  verifie("la fiche est intacte", intact.data?.[0]?.nom === "ZZ QA Praticienne", JSON.stringify(intact.data));

  // ------------------------- 3. Ce que la base tient ------------------------

  console.log("== 3. Contraintes ==");

  const noteHorsBorne = await srv("PATCH", `prospection_prospects?slug=eq.${slug}`, { note: 7 });
  verifie("une note de 7 sur 5 est refusée", noteHorsBorne.status >= 400, `statut ${noteHorsBorne.status}`);

  const formeInconnue = await srv("PATCH", `prospection_suivi?slug=eq.${slug}`, {
    relance_type: "pigeon voyageur",
  });
  verifie("une relance qui n'est ni vidéo ni mail est refusée", formeInconnue.status >= 400, `statut ${formeInconnue.status}`);

  const suiviOrphelin = await srv("POST", "prospection_suivi", { slug: `${slug}-inconnu` });
  verifie(
    "un suivi sans prospect est refusé",
    suiviOrphelin.status >= 400,
    `statut ${suiviOrphelin.status}`,
  );

  const historiquePasUneListe = await srv("PATCH", `prospection_prospects?slug=eq.${slug}`, {
    historique: { date: "2026-09-16" },
  });
  verifie(
    "un historique qui n'est pas une liste est refusé",
    historiquePasUneListe.status >= 400,
    `statut ${historiquePasUneListe.status}`,
  );

  // ----------------------------- 4. Cascade ---------------------------------

  console.log("== 4. Cascade ==");

  await srv("DELETE", `prospection_prospects?slug=eq.${slug}`);
  const suiviApres = await srv("GET", `prospection_suivi?select=slug&slug=eq.${slug}`);
  verifie(
    "le suivi part avec le prospect",
    Array.isArray(suiviApres.data) && suiviApres.data.length === 0,
    JSON.stringify(suiviApres.data),
  );
} catch (erreur) {
  verifie("le banc s'est déroulé jusqu'au bout", false, erreur.message);
} finally {
  await srv("DELETE", `prospection_prospects?slug=like.zz-qa-prospect-*`);
  if (org?.id) await srv("DELETE", `organizations?id=eq.${org.id}`);
  if (compte) await supprimerCompte(compte);

  const restes = (await srv("GET", "prospection_prospects?select=slug&slug=like.zz-qa-*")).data;
  verifie("aucun prospect de test ne reste", restes.length === 0, `${restes.length} restant(s)`);

  const orgsRestantes = (await srv("GET", "organizations?select=slug&slug=like.zz-qa-prospection-*")).data;
  verifie("aucune organisation de test ne reste", orgsRestantes.length === 0, `${orgsRestantes.length} restante(s)`);

  bilan();
}
