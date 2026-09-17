/**
 * Banc de QA — Horizon : ce qu'un client voit de son argent, et rien de plus.
 *
 * 1. Deux organisations, deux membres. B ne lit rien des relevés de A.
 * 2. Un brouillon n'existe pas pour le client : il ne voit que les relevés
 *    publiés, même en interrogeant l'API directement.
 * 3. Le client lit, il n'écrit pas : ni créer, ni modifier, ni supprimer un
 *    relevé, même chez lui.
 * 4. Outil coupé : ses relevés publiés disparaissent à ses yeux.
 * 5. Un seul relevé par mois et par client, et un mois est un premier du mois.
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

annoncerCible("QA — Horizon");

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);

const comptes = {};
const orgs = {};

const mailA = `zz-qa-horizon-a-${marque}@comete-qa.test`;
const mailB = `zz-qa-horizon-b-${marque}@comete-qa.test`;

const contenu = { resume: "Banc de QA", entrees: [{ libelle: "Clientes", centimes: 100000, budgetCentimes: null }] };

try {
  // ------------------------------- Décor -----------------------------------

  comptes.a = await creerCompte(mailA);
  comptes.b = await creerCompte(mailB);

  orgs.a = await creer("organizations", { name: "ZZ QA Horizon A", slug: `zz-qa-horizon-a-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA Horizon B", slug: `zz-qa-horizon-b-${marque}` });

  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.a, role: "owner" });
  await creer("memberships", { organization_id: orgs.b.id, user_id: comptes.b, role: "owner" });

  const outil = (await srv("GET", "tools?select=id,name,kind,sort_order&slug=eq.finances")).data[0];
  verifie(
    "l'outil `finances` est au catalogue, sous le nom Horizon",
    Boolean(outil?.id) && outil.name === "Horizon" && outil.kind === "internal",
    JSON.stringify(outil),
  );

  for (const org of [orgs.a, orgs.b]) {
    await creer("organization_tools", { organization_id: org.id, tool_id: outil.id, enabled: true });
  }

  const publie = await creer("horizon_releves", {
    organization_id: orgs.a.id,
    mois: "2026-09-01",
    publie: true,
    contenu,
  });
  const brouillon = await creer("horizon_releves", {
    organization_id: orgs.a.id,
    mois: "2026-10-01",
    publie: false,
    contenu,
  });

  const jetonA = par(await connecter(mailA));
  const jetonB = par(await connecter(mailB));

  // ------------------------ 1 et 2. Ce que chacun lit -----------------------

  console.log("== 1. Lecture ==");

  const lectureA = await jetonA("GET", `horizon_releves?select=id,mois,publie&organization_id=eq.${orgs.a.id}`);
  verifie(
    "A lit son relevé publié",
    lectureA.status === 200 && lectureA.data.some((releve) => releve.id === publie.id),
    JSON.stringify(lectureA.data),
  );
  verifie(
    "A ne voit pas son brouillon",
    lectureA.status === 200 && !lectureA.data.some((releve) => releve.id === brouillon.id),
    JSON.stringify(lectureA.data),
  );

  const brouillonDirect = await jetonA("GET", `horizon_releves?select=id&id=eq.${brouillon.id}`);
  verifie("A ne lit pas son brouillon, même par son identifiant", vide(brouillonDirect), JSON.stringify(brouillonDirect.data));

  const lectureB = await jetonB("GET", `horizon_releves?select=id&organization_id=eq.${orgs.a.id}`);
  verifie("B ne lit rien des relevés de A", vide(lectureB), JSON.stringify(lectureB.data));

  const toutB = await jetonB("GET", "horizon_releves?select=id");
  verifie("B, sans filtre, ne voit aucun relevé", vide(toutB), JSON.stringify(toutB.data));

  // ----------------------------- 3. Écriture --------------------------------

  console.log("== 3. Écriture ==");

  const creationA = await jetonA("POST", "horizon_releves?select=id", {
    organization_id: orgs.a.id,
    mois: "2026-11-01",
    publie: true,
    contenu,
  });
  verifie("A ne crée pas de relevé chez lui", refuse(creationA), `statut ${creationA.status}`);

  const modificationA = await jetonA("PATCH", `horizon_releves?id=eq.${publie.id}&select=id`, {
    contenu: { resume: "réécrit" },
  });
  verifie("A ne modifie pas son relevé", refuse(modificationA), `statut ${modificationA.status}`);

  const suppressionA = await jetonA("DELETE", `horizon_releves?id=eq.${publie.id}&select=id`);
  verifie("A ne supprime pas son relevé", refuse(suppressionA), `statut ${suppressionA.status}`);

  const creationB = await jetonB("POST", "horizon_releves?select=id", {
    organization_id: orgs.a.id,
    mois: "2026-12-01",
    publie: true,
    contenu,
  });
  verifie("B n'écrit pas chez A", refuse(creationB), `statut ${creationB.status}`);

  const toujoursLa = await srv("GET", `horizon_releves?select=id,contenu&id=eq.${publie.id}`);
  verifie(
    "le relevé de A est intact",
    toujoursLa.data?.[0]?.contenu?.resume === "Banc de QA",
    JSON.stringify(toujoursLa.data),
  );

  // --------------------------- 4. Outil coupé -------------------------------

  console.log("== 4. Outil coupé ==");

  await srv("PATCH", `organization_tools?organization_id=eq.${orgs.a.id}&tool_id=eq.${outil.id}`, { enabled: false });
  const outilCoupe = await jetonA("GET", `horizon_releves?select=id&organization_id=eq.${orgs.a.id}`);
  verifie("outil coupé : A ne voit plus ses relevés", vide(outilCoupe), JSON.stringify(outilCoupe.data));
  await srv("PATCH", `organization_tools?organization_id=eq.${orgs.a.id}&tool_id=eq.${outil.id}`, { enabled: true });
  const outilRallume = await jetonA("GET", `horizon_releves?select=id&organization_id=eq.${orgs.a.id}`);
  verifie(
    "outil rallumé : son relevé publié revient",
    outilRallume.status === 200 && outilRallume.data.length === 1,
    JSON.stringify(outilRallume.data),
  );

  // --------------------------- 5. Contraintes -------------------------------

  console.log("== 5. Contraintes ==");

  const doublon = await srv("POST", "horizon_releves", {
    organization_id: orgs.a.id,
    mois: "2026-09-01",
    contenu,
  });
  verifie("deux relevés pour le même mois sont refusés", doublon.status >= 400, `statut ${doublon.status}`);

  const milieuDeMois = await srv("POST", "horizon_releves", {
    organization_id: orgs.a.id,
    mois: "2026-09-15",
    contenu,
  });
  verifie("un mois qui n'est pas un premier du mois est refusé", milieuDeMois.status >= 400, `statut ${milieuDeMois.status}`);

  const pasUnObjet = await srv("POST", "horizon_releves", {
    organization_id: orgs.a.id,
    mois: "2027-01-01",
    contenu: [1, 2],
  });
  verifie("un contenu qui n'est pas un document est refusé", pasUnObjet.status >= 400, `statut ${pasUnObjet.status}`);
} catch (erreur) {
  verifie("le banc s'est déroulé jusqu'au bout", false, erreur.message);
} finally {
  const cibles = Object.values(orgs)
    .map((org) => org?.id)
    .filter(Boolean);

  for (const org of Object.values(orgs)) {
    if (org?.id) await srv("DELETE", `organizations?id=eq.${org.id}`);
  }
  for (const compte of Object.values(comptes)) {
    if (compte) await supprimerCompte(compte);
  }

  if (cibles.length > 0) {
    const restes = (await srv("GET", `horizon_releves?select=id&organization_id=in.(${cibles.join(",")})`)).data;
    verifie("les relevés du décor sont partis avec leur organisation", restes.length === 0, `${restes.length} restant(s)`);
  }
  const orgsRestantes = (await srv("GET", "organizations?select=slug&slug=like.zz-qa-horizon-*")).data;
  verifie("aucune organisation de test ne reste", orgsRestantes.length === 0, `${orgsRestantes.length} restante(s)`);

  bilan();
}
