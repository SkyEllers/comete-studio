/**
 * Banc de QA — registre des notifications et compteurs.
 *
 * Deux questions, et rien d'autre :
 *
 * 1. `notification_batches` est-il hors de portée d'une session ? La table
 *    porte la RLS sans aucune politique : c'est un choix, pas un oubli, et il
 *    faut vérifier qu'il tient. Un membre capable d'y écrire pourrait étouffer
 *    ses propres notifications en posant des lignes de retenue à la chaîne.
 *
 * 2. `stats_fichiers()` respecte-t-il la RLS ? Elle est `security invoker`
 *    justement pour ça : chacun ne totalise que ce qu'il voit. Une erreur ici
 *    ferait fuiter le poids des fichiers d'un client vers un autre.
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

annoncerCible("QA — notifications et compteurs");

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);

const comptes = {};
const orgs = {};

/*
 * Le nombre de retenues avant le décor : la table porte les vraies
 * notifications de Louis. On vérifie qu'on la rend telle qu'on l'a trouvée,
 * pas qu'elle est vide.
 */
const retenuesAvant = (await srv("GET", "notification_batches?select=id&limit=1000"))
  .data.length;

try {
  // ------------------------------- Décor -----------------------------------

  comptes.a = await creerCompte(`zz-qa-notif-a-${marque}@comete-qa.test`);
  comptes.b = await creerCompte(`zz-qa-notif-b-${marque}@comete-qa.test`);

  orgs.a = await creer("organizations", {
    name: "ZZ QA Notif A",
    slug: `zz-qa-notif-a-${marque}`,
  });
  orgs.b = await creer("organizations", {
    name: "ZZ QA Notif B",
    slug: `zz-qa-notif-b-${marque}`,
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

  const outil = (await srv("GET", "tools?select=id&slug=eq.fichiers")).data[0];
  await creer("organization_tools", {
    organization_id: orgs.a.id,
    tool_id: outil.id,
    enabled: true,
  });
  await creer("organization_tools", {
    organization_id: orgs.b.id,
    tool_id: outil.id,
    enabled: true,
  });

  // Deux fichiers chez A, un chez B : des totaux distincts et vérifiables.
  await creer("files", {
    organization_id: orgs.a.id,
    name: "a1.jpg",
    size_bytes: 1000,
    uploaded_by: comptes.a,
    status: "ready",
  });
  await creer("files", {
    organization_id: orgs.a.id,
    name: "a2.jpg",
    size_bytes: 2000,
    uploaded_by: comptes.a,
    status: "ready",
  });
  await creer("files", {
    organization_id: orgs.b.id,
    name: "b1.jpg",
    size_bytes: 500,
    uploaded_by: comptes.b,
    status: "ready",
  });
  // Un envoi en cours : il ne doit compter nulle part.
  await creer("files", {
    organization_id: orgs.a.id,
    name: "a3-en-cours.jpg",
    size_bytes: 9_000_000,
    uploaded_by: comptes.a,
    status: "uploading",
  });

  const jetonA = par(await connecter(`zz-qa-notif-a-${marque}@comete-qa.test`));
  const jetonB = par(await connecter(`zz-qa-notif-b-${marque}@comete-qa.test`));

  // ------------------- 1. Le registre est hors de portée --------------------

  console.log("== 1. notification_batches, sans politique ==");

  // Une ligne posée avec la clé secrète : elle existe bel et bien.
  await creer("notification_batches", {
    organization_id: orgs.a.id,
    user_id: comptes.a,
  });

  const parLaCle = await srv(
    "GET",
    `notification_batches?select=id&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "la clé secrète voit la ligne (contrôle : la table n'est pas vide)",
    parLaCle.data.length === 1,
    `${parLaCle.data.length} ligne(s)`,
  );

  const lecture = await jetonA(
    "GET",
    `notification_batches?select=id&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "le membre de l'organisation ne lit rien",
    vide(lecture) || lecture.status >= 400,
    `statut ${lecture.status}, ${JSON.stringify(lecture.data)}`,
  );

  const ecriture = await jetonA("POST", "notification_batches", {
    organization_id: orgs.a.id,
    user_id: comptes.a,
  });
  verifie(
    "le membre ne peut pas poser de retenue",
    refuse(ecriture),
    `statut ${ecriture.status}`,
  );

  const suppression = await jetonA(
    "DELETE",
    `notification_batches?organization_id=eq.${orgs.a.id}&select=id`,
  );
  verifie(
    "le membre ne peut pas effacer de retenue",
    refuse(suppression),
    `statut ${suppression.status}`,
  );

  const apres = await srv(
    "GET",
    `notification_batches?select=id&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "la ligne est toujours là après les tentatives",
    apres.data.length === 1,
    `${apres.data.length} ligne(s)`,
  );

  // ---------------------- 2. stats_fichiers et la RLS -----------------------

  console.log("\n== 2. stats_fichiers ==");

  const statsA = await jetonA("POST", "rpc/stats_fichiers", { org: orgs.a.id });
  verifie(
    "A totalise ses deux fichiers prêts",
    statsA.data?.[0]?.fichiers === 2,
    JSON.stringify(statsA.data),
  );
  verifie(
    "A totalise leur poids, sans l'envoi en cours",
    Number(statsA.data?.[0]?.octets) === 3000,
    JSON.stringify(statsA.data),
  );

  const statsAversB = await jetonA("POST", "rpc/stats_fichiers", {
    org: orgs.b.id,
  });
  verifie(
    "A ne voit rien du stock de B",
    Number(statsAversB.data?.[0]?.fichiers) === 0 &&
      Number(statsAversB.data?.[0]?.octets) === 0,
    JSON.stringify(statsAversB.data),
  );

  const statsBglobal = await jetonB("POST", "rpc/stats_fichiers", {});
  verifie(
    "sans argument, B ne totalise que le sien",
    Number(statsBglobal.data?.[0]?.fichiers) === 1 &&
      Number(statsBglobal.data?.[0]?.octets) === 500,
    JSON.stringify(statsBglobal.data),
  );

  // Outil coupé : les fichiers disparaissent, donc les compteurs aussi.
  await srv(
    "PATCH",
    `organization_tools?organization_id=eq.${orgs.a.id}&tool_id=eq.${outil.id}`,
    { enabled: false },
  );
  const statsCoupe = await jetonA("POST", "rpc/stats_fichiers", {
    org: orgs.a.id,
  });
  verifie(
    "outil coupé, A ne totalise plus rien",
    Number(statsCoupe.data?.[0]?.fichiers) === 0,
    JSON.stringify(statsCoupe.data),
  );
  await srv(
    "PATCH",
    `organization_tools?organization_id=eq.${orgs.a.id}&tool_id=eq.${outil.id}`,
    { enabled: true },
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

  const restes = (await srv("GET", "organizations?select=slug&slug=like.zz-qa-*"))
    .data;
  verifie(
    "aucune organisation de test ne reste",
    restes.length === 0,
    `${restes.length} restante(s)`,
  );

  const retenuesApres = (
    await srv("GET", "notification_batches?select=id&limit=1000")
  ).data.length;
  verifie(
    "le décor n'a laissé aucune retenue derrière lui",
    retenuesApres === retenuesAvant,
    `${retenuesAvant} avant, ${retenuesApres} après`,
  );

  bilan();
}
