/**
 * Banc de QA — Automatisations : le courrier de Comète n'est à personne d'autre.
 *
 * 1. Un client connecté ne lit ni les automatisations ni leurs passages, même
 *    sans filtre. Ce sont les dépôts, les workflows et les mails de Comète :
 *    rien là-dedans ne regarde un client.
 * 2. Il n'écrit rien : ni une automatisation, ni un passage. Seule la clé de
 *    service, celle du relevé qui tourne sur le PC de Louis, écrit ici.
 * 3. La base tient ce qui ne doit jamais casser : un état qui existe, un
 *    `mail_attendu` qui vaut `toujours` ou `au-besoin`, un passage qui porte
 *    sur une automatisation connue.
 * 4. Une automatisation retirée du vault emporte ses passages (cascade).
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

annoncerCible("QA — Automatisations");

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);

const mailClient = `zz-qa-automatisations-${marque}@comete-qa.test`;
const slug = `zz-qa/${marque}`;
const attendue = "2026-09-15T05:00:00Z";
let compte = null;
let org = null;

try {
  // ------------------------------- Décor -----------------------------------

  compte = await creerCompte(mailClient);
  org = await creer("organizations", {
    name: "ZZ QA Automatisations",
    slug: `zz-qa-automatisations-${marque}`,
  });
  await creer("memberships", { organization_id: org.id, user_id: compte, role: "owner" });

  await creer("automatisations", {
    slug,
    client: "zz-qa",
    nom: "ZZ QA Rapport",
    cadence: "mardi 07:00",
    depot: "zz-qa-site",
    workflow: "ads-report",
    mail_attendu: "toujours",
    etat: "ok",
  });
  await creer("automatisations_passages", { slug, attendue_le: attendue, etat: "ok" });

  const jeton = await connecter(mailClient);
  const client = par(jeton);

  // --------------------------- 1. Il ne lit rien ----------------------------

  console.log("== 1. Lecture ==");

  verifie(
    "un client ne lit aucune automatisation",
    vide(await client("GET", "automatisations?select=slug")),
    "la table devrait être vide pour lui",
  );
  verifie(
    "un client ne lit aucun passage",
    vide(await client("GET", "automatisations_passages?select=slug")),
    "la table devrait être vide pour lui",
  );

  // --------------------------- 2. Il n'écrit rien ---------------------------

  console.log("== 2. Écriture ==");

  verifie(
    "un client ne dépose pas d'automatisation",
    refuse(
      await client("POST", "automatisations", {
        slug: `zz-qa/${marque}-client`,
        client: "zz-qa",
        nom: "ZZ QA intrus",
        cadence: "lundi 09:00",
        depot: "zz-qa-site",
        workflow: "intrus",
        etat: "ok",
      }),
    ),
    "l'insertion aurait dû être refusée",
  );
  verifie(
    "un client ne dépose pas de passage",
    refuse(
      await client("POST", "automatisations_passages", {
        slug,
        attendue_le: "2026-09-22T05:00:00Z",
        etat: "ok",
      }),
    ),
    "l'insertion aurait dû être refusée",
  );
  verifie(
    "un client ne réécrit pas un état",
    refuse(await client("PATCH", `automatisations?slug=eq.${encodeURIComponent(slug)}`, { etat: "panne" })),
    "la mise à jour aurait dû être refusée",
  );

  // ------------------------- 3. Ce que la base tient ------------------------

  console.log("== 3. Gardes ==");

  const etatInvente = await srv("POST", "automatisations", {
    slug: `zz-qa/${marque}-etat`,
    client: "zz-qa",
    nom: "ZZ QA état inventé",
    cadence: "lundi 09:00",
    depot: "zz-qa-site",
    workflow: "etat",
    etat: "presque-bien",
  });
  verifie("un état inventé est refusé", etatInvente.status >= 400, `statut ${etatInvente.status}`);

  const mailInvente = await srv("POST", "automatisations", {
    slug: `zz-qa/${marque}-mail`,
    client: "zz-qa",
    nom: "ZZ QA mail inventé",
    cadence: "lundi 09:00",
    depot: "zz-qa-site",
    workflow: "mail",
    mail_attendu: "parfois",
    etat: "ok",
  });
  verifie(
    "un mail_attendu hors des deux valeurs est refusé",
    mailInvente.status >= 400,
    `statut ${mailInvente.status}`,
  );

  const passageOrphelin = await srv("POST", "automatisations_passages", {
    slug: `zz-qa/${marque}-fantome`,
    attendue_le: attendue,
    etat: "ok",
  });
  verifie(
    "un passage sans automatisation est refusé",
    passageOrphelin.status >= 400,
    `statut ${passageOrphelin.status}`,
  );

  // ----------------------------- 4. Cascade ---------------------------------

  console.log("== 4. Cascade ==");

  await srv("DELETE", `automatisations?slug=eq.${encodeURIComponent(slug)}`);
  const passagesApres = await srv(
    "GET",
    `automatisations_passages?select=slug&slug=eq.${encodeURIComponent(slug)}`,
  );
  verifie(
    "les passages partent avec l'automatisation",
    Array.isArray(passagesApres.data) && passagesApres.data.length === 0,
    JSON.stringify(passagesApres.data),
  );
} catch (erreur) {
  verifie("le banc s'est déroulé jusqu'au bout", false, erreur.message);
} finally {
  await srv("DELETE", "automatisations?client=eq.zz-qa");
  if (org?.id) await srv("DELETE", `organizations?id=eq.${org.id}`);
  if (compte) await supprimerCompte(compte);

  const restes = (await srv("GET", "automatisations?select=slug&client=eq.zz-qa")).data;
  verifie("aucune automatisation de test ne reste", restes.length === 0, `${restes.length} restante(s)`);

  const passagesRestants = (
    await srv("GET", "automatisations_passages?select=slug&slug=like.zz-qa*")
  ).data;
  verifie(
    "aucun passage de test ne reste",
    passagesRestants.length === 0,
    `${passagesRestants.length} restant(s)`,
  );

  const orgsRestantes = (
    await srv("GET", "organizations?select=slug&slug=like.zz-qa-automatisations-*")
  ).data;
  verifie("aucune organisation de test ne reste", orgsRestantes.length === 0, `${orgsRestantes.length} restante(s)`);

  bilan();
}
