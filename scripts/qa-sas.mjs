/**
 * Banc de QA — Sas : isolation, porte d'entrée, contraintes.
 *
 * Sas est l'outil le plus ouvert du hub : qui y accède lit, écrit, corrige et
 * efface. Tout repose donc sur une seule fonction, `can_access_sas`, et sur
 * deux contraintes de table. Ce banc ne vérifie rien d'autre, mais il le
 * vérifie de bout en bout :
 *
 * 1. Deux organisations, deux membres. B ne lit, n'écrit, ne modifie et
 *    n'efface rien chez A — ni les idées, ni les boîtes.
 * 2. Outil coupé pour A : ses propres idées disparaissent à ses yeux, y
 *    compris par l'API. Rallumé, elles reviennent.
 * 3. On n'écrit pas sous le nom d'un autre : `created_by = auth.uid()`.
 * 4. Une note perso n'a jamais de boîte — la base refuse, pas l'interface.
 * 5. Supprimer une boîte rend ses idées à « À ranger » et n'en efface aucune.
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

annoncerCible("QA — Sas");

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);

const comptes = {};
const orgs = {};

const mailA = `zz-qa-sas-a-${marque}@comete-qa.test`;
const mailB = `zz-qa-sas-b-${marque}@comete-qa.test`;

try {
  // ------------------------------- Décor -----------------------------------

  comptes.a = await creerCompte(mailA);
  comptes.b = await creerCompte(mailB);

  orgs.a = await creer("organizations", {
    name: "ZZ QA Sas A",
    slug: `zz-qa-sas-a-${marque}`,
  });
  orgs.b = await creer("organizations", {
    name: "ZZ QA Sas B",
    slug: `zz-qa-sas-b-${marque}`,
  });

  await creer("memberships", {
    organization_id: orgs.a.id,
    user_id: comptes.a,
    role: "owner",
  });
  await creer("memberships", {
    organization_id: orgs.b.id,
    user_id: comptes.b,
    role: "owner",
  });

  const outil = (await srv("GET", "tools?select=id,name,sort_order&slug=eq.sas"))
    .data[0];
  verifie(
    "l'outil `sas` est au catalogue",
    Boolean(outil?.id) && outil.name === "Sas" && outil.sort_order === 40,
    JSON.stringify(outil),
  );

  const allumer = (org, enabled) =>
    srv(
      "PATCH",
      `organization_tools?organization_id=eq.${org}&tool_id=eq.${outil.id}`,
      { enabled },
    );

  for (const org of [orgs.a, orgs.b]) {
    await creer("organization_tools", {
      organization_id: org.id,
      tool_id: outil.id,
      enabled: true,
    });
  }

  const jetonA = par(await connecter(mailA));
  const jetonB = par(await connecter(mailB));

  // ------------------------- 1. Ce que A peut faire -------------------------

  console.log("== 1. Le membre écrit chez lui ==");

  const boiteA = await jetonA("POST", "sas_boxes?select=id,name", {
    organization_id: orgs.a.id,
    name: "Jonathan",
    created_by: comptes.a,
  });
  verifie(
    "A crée une boîte",
    boiteA.status < 300 && boiteA.data?.[0]?.name === "Jonathan",
    `statut ${boiteA.status}, ${JSON.stringify(boiteA.data)}`,
  );
  const boiteAId = boiteA.data?.[0]?.id;

  const doublon = await jetonA("POST", "sas_boxes?select=id", {
    organization_id: orgs.a.id,
    name: "Jonathan",
    created_by: comptes.a,
  });
  verifie(
    "deux boîtes du même nom dans la même organisation sont refusées",
    doublon.status >= 400,
    `statut ${doublon.status}`,
  );

  const memeNomChezB = await jetonB("POST", "sas_boxes?select=id", {
    organization_id: orgs.b.id,
    name: "Jonathan",
    created_by: comptes.b,
  });
  verifie(
    "le même nom de boîte reste libre dans une autre organisation",
    memeNomChezB.status < 300,
    `statut ${memeNomChezB.status}, ${JSON.stringify(memeNomChezB.data)}`,
  );
  const boiteBId = memeNomChezB.data?.[0]?.id;

  const notePro = await jetonA("POST", "sas_notes?select=id,realm,box_id", {
    organization_id: orgs.a.id,
    box_id: boiteAId,
    realm: "pro",
    content: "finir le SEO de Jonathan",
    created_by: comptes.a,
  });
  verifie(
    "A range une idée pro dans sa boîte",
    notePro.status < 300 && notePro.data?.[0]?.box_id === boiteAId,
    `statut ${notePro.status}, ${JSON.stringify(notePro.data)}`,
  );
  const noteProId = notePro.data?.[0]?.id;

  const notePerso = await jetonA("POST", "sas_notes?select=id", {
    organization_id: orgs.a.id,
    realm: "perso",
    content: "racheter des lentilles",
    created_by: comptes.a,
  });
  verifie(
    "A écrit une idée perso",
    notePerso.status < 300,
    `statut ${notePerso.status}, ${JSON.stringify(notePerso.data)}`,
  );

  const aRanger = await jetonA("POST", "sas_notes?select=id", {
    organization_id: orgs.a.id,
    realm: "pro",
    content: "analyser résultats campagne",
    created_by: comptes.a,
  });
  verifie(
    "une idée pro sans boîte est acceptée (« À ranger »)",
    aRanger.status < 300,
    `statut ${aRanger.status}, ${JSON.stringify(aRanger.data)}`,
  );

  // ------------------------ 2. Les contraintes de table ---------------------

  console.log("\n== 2. Ce que la base refuse ==");

  const persoAvecBoite = await jetonA("POST", "sas_notes?select=id", {
    organization_id: orgs.a.id,
    box_id: boiteAId,
    realm: "perso",
    content: "une perso rangée dans une boîte",
    created_by: comptes.a,
  });
  verifie(
    "une note perso avec une boîte est refusée",
    persoAvecBoite.status >= 400,
    `statut ${persoAvecBoite.status}, ${JSON.stringify(persoAvecBoite.data)}`,
  );

  const persoParDeplacement = await jetonA(
    "PATCH",
    `sas_notes?id=eq.${noteProId}&select=id`,
    { realm: "perso" },
  );
  verifie(
    "faire passer une note en perso sans la sortir de sa boîte est refusé",
    persoParDeplacement.status >= 400,
    `statut ${persoParDeplacement.status}`,
  );

  const contenuVide = await jetonA("POST", "sas_notes?select=id", {
    organization_id: orgs.a.id,
    realm: "pro",
    content: "",
    created_by: comptes.a,
  });
  verifie(
    "une idée vide est refusée",
    contenuVide.status >= 400,
    `statut ${contenuVide.status}`,
  );

  const tropLong = await jetonA("POST", "sas_notes?select=id", {
    organization_id: orgs.a.id,
    realm: "pro",
    content: "x".repeat(2001),
    created_by: comptes.a,
  });
  verifie(
    "une idée de plus de 2000 caractères est refusée",
    tropLong.status >= 400,
    `statut ${tropLong.status}`,
  );

  const signatureVolee = await jetonA("POST", "sas_notes?select=id", {
    organization_id: orgs.a.id,
    realm: "pro",
    content: "écrite sous le nom de B",
    created_by: comptes.b,
  });
  verifie(
    "on n'écrit pas une idée sous le nom d'un autre",
    refuse(signatureVolee),
    `statut ${signatureVolee.status}`,
  );

  const boiteVolee = await jetonA("POST", "sas_boxes?select=id", {
    organization_id: orgs.a.id,
    name: "Boîte signée B",
    created_by: comptes.b,
  });
  verifie(
    "on ne crée pas une boîte sous le nom d'un autre",
    refuse(boiteVolee),
    `statut ${boiteVolee.status}`,
  );

  // ---------------------------- 3. L'isolation ------------------------------

  console.log("\n== 3. B ne touche à rien chez A ==");

  const lectureNotes = await jetonB(
    "GET",
    `sas_notes?select=id,content&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "B ne lit aucune idée de A",
    vide(lectureNotes),
    `statut ${lectureNotes.status}, ${JSON.stringify(lectureNotes.data)}`,
  );

  const lectureBoites = await jetonB(
    "GET",
    `sas_boxes?select=id,name&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "B ne lit aucune boîte de A",
    vide(lectureBoites),
    `statut ${lectureBoites.status}, ${JSON.stringify(lectureBoites.data)}`,
  );

  const ecritureChezA = await jetonB("POST", "sas_notes?select=id", {
    organization_id: orgs.a.id,
    realm: "pro",
    content: "intrusion",
    created_by: comptes.b,
  });
  verifie(
    "B n'écrit pas d'idée chez A",
    refuse(ecritureChezA),
    `statut ${ecritureChezA.status}`,
  );

  const boiteChezA = await jetonB("POST", "sas_boxes?select=id", {
    organization_id: orgs.a.id,
    name: "Intruse",
    created_by: comptes.b,
  });
  verifie(
    "B ne crée pas de boîte chez A",
    refuse(boiteChezA),
    `statut ${boiteChezA.status}`,
  );

  const modifChezA = await jetonB("PATCH", `sas_notes?id=eq.${noteProId}&select=id`, {
    content: "réécrite par B",
  });
  verifie(
    "B ne modifie pas une idée de A",
    refuse(modifChezA),
    `statut ${modifChezA.status}`,
  );

  const renommeChezA = await jetonB("PATCH", `sas_boxes?id=eq.${boiteAId}&select=id`, {
    name: "Renommée par B",
  });
  verifie(
    "B ne renomme pas une boîte de A",
    refuse(renommeChezA),
    `statut ${renommeChezA.status}`,
  );

  const deplaceChezB = await jetonB("PATCH", `sas_notes?id=eq.${noteProId}&select=id`, {
    box_id: boiteBId,
  });
  verifie(
    "B n'attire pas une idée de A dans sa propre boîte",
    refuse(deplaceChezB),
    `statut ${deplaceChezB.status}`,
  );

  const effaceChezA = await jetonB("DELETE", `sas_notes?id=eq.${noteProId}&select=id`);
  verifie(
    "B n'efface pas une idée de A",
    refuse(effaceChezA),
    `statut ${effaceChezA.status}`,
  );

  const effaceBoiteA = await jetonB("DELETE", `sas_boxes?id=eq.${boiteAId}&select=id`);
  verifie(
    "B n'efface pas une boîte de A",
    refuse(effaceBoiteA),
    `statut ${effaceBoiteA.status}`,
  );

  const resteA = await srv(
    "GET",
    `sas_notes?select=id,content&organization_id=eq.${orgs.a.id}&order=created_at`,
  );
  verifie(
    "après les tentatives de B, A a toujours ses trois idées, intactes",
    resteA.data.length === 3 &&
      resteA.data[0].content === "finir le SEO de Jonathan",
    JSON.stringify(resteA.data),
  );

  const porteB = await jetonB("POST", "rpc/can_access_sas", { org: orgs.a.id });
  verifie(
    "`can_access_sas` dit non à B pour l'organisation de A",
    porteB.data === false,
    JSON.stringify(porteB.data),
  );

  // ----------------------------- 4. Outil coupé -----------------------------

  console.log("\n== 4. Outil coupé ==");

  await allumer(orgs.a.id, false);

  const porteCoupee = await jetonA("POST", "rpc/can_access_sas", { org: orgs.a.id });
  verifie(
    "`can_access_sas` dit non dès que l'outil est coupé",
    porteCoupee.data === false,
    JSON.stringify(porteCoupee.data),
  );

  const notesCoupees = await jetonA("GET", "sas_notes?select=id");
  verifie(
    "outil coupé, A ne voit plus aucune idée",
    vide(notesCoupees),
    `statut ${notesCoupees.status}, ${JSON.stringify(notesCoupees.data)}`,
  );

  const boitesCoupees = await jetonA("GET", "sas_boxes?select=id");
  verifie(
    "outil coupé, A ne voit plus aucune boîte",
    vide(boitesCoupees),
    `statut ${boitesCoupees.status}, ${JSON.stringify(boitesCoupees.data)}`,
  );

  const ecritureCoupee = await jetonA("POST", "sas_notes?select=id", {
    organization_id: orgs.a.id,
    realm: "pro",
    content: "écrite alors que l'outil est coupé",
    created_by: comptes.a,
  });
  verifie(
    "outil coupé, A n'écrit plus rien",
    refuse(ecritureCoupee),
    `statut ${ecritureCoupee.status}`,
  );

  await allumer(orgs.a.id, true);

  const retour = await jetonA("GET", "sas_notes?select=id");
  verifie(
    "outil rallumé, les trois idées de A sont revenues",
    retour.data?.length === 3,
    `${retour.data?.length} idée(s)`,
  );

  // ------------------- 5. Supprimer une boîte, pas ses idées -----------------

  console.log("\n== 5. Suppression d'une boîte ==");

  const suppression = await jetonA("DELETE", `sas_boxes?id=eq.${boiteAId}&select=id`);
  verifie(
    "A supprime sa boîte",
    suppression.status < 300 && suppression.data?.length === 1,
    `statut ${suppression.status}, ${JSON.stringify(suppression.data)}`,
  );

  const orpheline = await jetonA(
    "GET",
    `sas_notes?select=id,box_id,realm,content&id=eq.${noteProId}`,
  );
  verifie(
    "son idée survit et revient à « À ranger »",
    orpheline.data?.[0]?.box_id === null &&
      orpheline.data?.[0]?.realm === "pro" &&
      orpheline.data?.[0]?.content === "finir le SEO de Jonathan",
    JSON.stringify(orpheline.data),
  );

  const total = await jetonA("GET", "sas_notes?select=id");
  verifie(
    "aucune idée n'a été emportée par la suppression",
    total.data?.length === 3,
    `${total.data?.length} idée(s)`,
  );
} finally {
  // ------------------------------ Nettoyage --------------------------------

  console.log("\n== Nettoyage ==");

  for (const org of Object.values(orgs)) {
    if (org?.id) await srv("DELETE", `organizations?id=eq.${org.id}`);
  }
  for (const compte of Object.values(comptes)) {
    if (compte) await supprimerCompte(compte);
  }

  const restes = (await srv("GET", "organizations?select=slug&slug=like.zz-qa-*")).data;
  verifie(
    "aucune organisation de test ne reste",
    restes.length === 0,
    `${restes.length} restante(s)`,
  );

  const notesRestantes = (
    await srv("GET", "sas_notes?select=id,content&content=like.*Jonathan*")
  ).data;
  verifie(
    "les idées du décor sont parties avec leur organisation",
    notesRestantes.length === 0,
    `${notesRestantes.length} restante(s)`,
  );

  bilan();
}
