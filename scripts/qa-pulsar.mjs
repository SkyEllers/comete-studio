/**
 * Banc de QA — Pulsar : isolation, chronomètres en parallèle, quarts d'heure,
 * et l'histoire qu'on ne réécrit pas.
 *
 * Pulsar est un carnet personnel : qui y accède lit, écrit, corrige et efface
 * sans limite de temps. Presque tout repose donc sur une seule fonction,
 * `can_access_temps` — et sur le petit nombre de vérités que la base défend
 * elle-même, parce qu'une interface ne suffit pas à les tenir :
 *
 * 1. Deux organisations, deux membres. B ne lit, n'écrit, ne modifie et
 *    n'efface rien chez A — ni les clients, ni les entrées, ni les seuils.
 * 2. Outil coupé pour A : son propre carnet disparaît à ses yeux, y compris
 *    par l'API. Rallumé, il revient entier.
 * 3. Plusieurs chronomètres en marche, quatre au plus par personne dans un
 *    espace : le cinquième est refusé, même lancé au même instant qu'un autre,
 *    et même en remettant en marche une entrée terminée. Corriger le début
 *    d'un chronomètre, ou l'arrêter à la durée choisie, ne se heurte pas au
 *    plafond.
 * 4. Les durées sont des quarts d'heure, au minimum quinze minutes ; une
 *    entrée d'un autre jour se corrige en début, fin et durée.
 * 5. On ne supprime pas un client dont on a compté les heures — et supprimer
 *    l'organisation entière, elle, reste possible. C'est le cas que `restrict`
 *    aurait cassé, et la raison du `no action` de la migration.
 * 6. « Comète » ne se renomme pas, ne s'efface pas, et n'a pas de jumeau.
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

annoncerCible("QA — Pulsar");

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);

const comptes = {};
const orgs = {};

const mailA = `zz-qa-pulsar-a-${marque}@comete-qa.test`;
const mailB = `zz-qa-pulsar-b-${marque}@comete-qa.test`;

/** Une heure passée, pour les entrées déjà terminées : elles ne courent pas. */
const hier = (heures) =>
  new Date(Date.now() - heures * 3600 * 1000).toISOString();

/**
 * Les entrées que A a réussi à écrire. Les sections suivantes comptent ce qui
 * reste chez A : on compare à ce registre plutôt qu'à un nombre écrit en dur,
 * qui deviendrait faux au premier chronomètre ajouté au banc.
 */
const heuresDeA = new Set();
const noter = (reponse) => {
  const id = reponse.status < 300 ? reponse.data?.[0]?.id : null;
  if (id) heuresDeA.add(id);
  return id;
};

try {
  // ------------------------------- Décor -----------------------------------

  comptes.a = await creerCompte(mailA);
  comptes.b = await creerCompte(mailB);

  orgs.a = await creer("organizations", {
    name: "ZZ QA Pulsar A",
    slug: `zz-qa-pulsar-a-${marque}`,
  });
  orgs.b = await creer("organizations", {
    name: "ZZ QA Pulsar B",
    slug: `zz-qa-pulsar-b-${marque}`,
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

  const outil = (
    await srv("GET", "tools?select=id,name,kind,sort_order&slug=eq.temps")
  ).data[0];
  verifie(
    "l'outil `temps` est au catalogue, sous le nom Pulsar",
    Boolean(outil?.id) &&
      outil.name === "Pulsar" &&
      outil.kind === "internal" &&
      outil.sort_order === 60,
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
    // Ce que pose l'amorçage à l'activation (`preparerPulsar`), reproduit ici
    // à la clé de service : les seuils, et le client interne.
    await creer("pulsar_settings", { organization_id: org.id });
    await creer("pulsar_clients", {
      organization_id: org.id,
      name: "Comète",
      is_internal: true,
    });
  }

  const interneA = (
    await srv(
      "GET",
      `pulsar_clients?select=id,name&organization_id=eq.${orgs.a.id}&is_internal=eq.true`,
    )
  ).data[0];
  const interneB = (
    await srv(
      "GET",
      `pulsar_clients?select=id&organization_id=eq.${orgs.b.id}&is_internal=eq.true`,
    )
  ).data[0];
  verifie(
    "chaque organisation a son « Comète », et le nom reste libre chez l'autre",
    Boolean(interneA?.id) && Boolean(interneB?.id) && interneA.id !== interneB.id,
    JSON.stringify({ a: interneA?.id, b: interneB?.id }),
  );

  const jetonA = par(await connecter(mailA));
  const jetonB = par(await connecter(mailB));

  // --------------------------- 1. Le carnet de A ----------------------------

  console.log("== 1. A tient son carnet ==");

  const peggy = await jetonA(
    "POST",
    "pulsar_clients?select=id,name,modele,statut",
    {
      organization_id: orgs.a.id,
      name: "Peggy",
      modele: "recurrent",
      montant_cents: 55000,
      date_debut: "2026-01-01",
      statut: "setup",
      profil: "p1",
    },
  );
  verifie(
    "A crée une fiche client",
    peggy.status < 300 && peggy.data?.[0]?.name === "Peggy",
    `statut ${peggy.status}, ${JSON.stringify(peggy.data)}`,
  );
  const peggyId = peggy.data?.[0]?.id;

  const doublon = await jetonA("POST", "pulsar_clients?select=id", {
    organization_id: orgs.a.id,
    name: "Peggy",
  });
  verifie(
    "deux clients du même nom dans la même organisation sont refusés",
    doublon.status >= 400,
    `statut ${doublon.status}`,
  );

  const memeNomChezB = await jetonB("POST", "pulsar_clients?select=id", {
    organization_id: orgs.b.id,
    name: "Peggy",
  });
  verifie(
    "le même nom reste libre dans une autre organisation",
    memeNomChezB.status < 300,
    `statut ${memeNomChezB.status}, ${JSON.stringify(memeNomChezB.data)}`,
  );
  const peggyChezB = memeNomChezB.data?.[0]?.id;

  const engagementInverse = await jetonA("POST", "pulsar_clients?select=id", {
    organization_id: orgs.a.id,
    name: "Engagement à l'envers",
    date_debut: "2026-06-01",
    fin_engagement: "2026-02-01",
  });
  verifie(
    "un engagement qui finit avant de commencer est refusé",
    engagementInverse.status >= 400,
    `statut ${engagementInverse.status}`,
  );

  const montantNegatif = await jetonA("POST", "pulsar_clients?select=id", {
    organization_id: orgs.a.id,
    name: "Montant négatif",
    montant_cents: -100,
  });
  verifie(
    "un montant négatif est refusé",
    montantNegatif.status >= 400,
    `statut ${montantNegatif.status}`,
  );

  const demarrage = await jetonA(
    "POST",
    "pulsar_entries?select=id,task,phase,ended_at",
    {
      organization_id: orgs.a.id,
      client_id: peggyId,
      task: "emails",
      phase: "setup",
      started_at: new Date().toISOString(),
      created_by: comptes.a,
    },
  );
  verifie(
    "A démarre un chronomètre",
    demarrage.status < 300 && demarrage.data?.[0]?.ended_at === null,
    `statut ${demarrage.status}, ${JSON.stringify(demarrage.data)}`,
  );
  const enCoursId = noter(demarrage);

  // --------------------- 2. Plusieurs chronomètres --------------------------

  console.log("\n== 2. Plusieurs chronomètres, quatre au plus ==");

  /** Un chronomètre de plus pour A, lancé maintenant. */
  const lancerA = (task = "admin", client = interneA.id, phase = "interne") =>
    jetonA("POST", "pulsar_entries?select=id,ended_at", {
      organization_id: orgs.a.id,
      client_id: client,
      task,
      phase,
      started_at: new Date().toISOString(),
      created_by: comptes.a,
    });

  /** Ce qui tourne chez A, vu par la clé de service : la vérité, pas l'écran. */
  const enMarcheChezA = async () =>
    (
      await srv(
        "GET",
        `pulsar_entries?select=id&organization_id=eq.${orgs.a.id}&created_by=eq.${comptes.a}&ended_at=is.null`,
      )
    ).data;

  const arreterA = (id, minutes = 15) =>
    jetonA("PATCH", `pulsar_entries?id=eq.${id}&select=id,duration_minutes`, {
      ended_at: new Date().toISOString(),
      duration_minutes: minutes,
    });

  /*
   * Le même client, la même tâche, le même instant : deux chronomètres sur le
   * même créneau sont un choix. La base ne compare pas les créneaux, et ce
   * banc vérifie qu'elle ne s'y met pas.
   */
  const second = await lancerA("emails", peggyId, "setup");
  verifie(
    "un second chronomètre en marche est accepté, même client et même tâche",
    second.status < 300 && second.data?.[0]?.ended_at === null,
    `statut ${second.status}, ${JSON.stringify(second.data)?.slice(0, 160)}`,
  );
  noter(second);

  const troisieme = await lancerA("admin");
  const quatrieme = await lancerA("prospection");
  verifie(
    "un troisième et un quatrième aussi",
    troisieme.status < 300 && quatrieme.status < 300,
    `statuts ${troisieme.status}, ${quatrieme.status}`,
  );
  const troisiemeId = noter(troisieme);
  noter(quatrieme);

  const cinquieme = await lancerA("site", peggyId, "setup");
  verifie(
    "le cinquième est refusé",
    cinquieme.status >= 400,
    `statut ${cinquieme.status}, ${JSON.stringify(cinquieme.data)?.slice(0, 160)}`,
  );
  noter(cinquieme);
  verifie(
    "et le refus dit quoi faire, en français",
    typeof cinquieme.data?.message === "string" &&
      cinquieme.data.message.includes("Arrête-en un d'abord"),
    JSON.stringify(cinquieme.data?.message),
  );

  const quatreEnMarche = await enMarcheChezA();
  verifie(
    "après le refus, quatre tournent, pas un de plus",
    quatreEnMarche.length === 4,
    `${quatreEnMarche.length} en marche`,
  );

  const chezB = await jetonB("POST", "pulsar_entries?select=id", {
    organization_id: orgs.b.id,
    client_id: interneB.id,
    task: "admin",
    phase: "interne",
    started_at: new Date().toISOString(),
    created_by: comptes.b,
  });
  verifie(
    "les quatre de A ne pèsent rien sur B",
    chezB.status < 300,
    `statut ${chezB.status}, ${JSON.stringify(chezB.data)?.slice(0, 160)}`,
  );
  if (chezB.data?.[0]?.id) {
    await jetonB("PATCH", `pulsar_entries?id=eq.${chezB.data[0].id}`, {
      ended_at: new Date().toISOString(),
      duration_minutes: 15,
    });
  }

  /*
   * Corriger un chronomètre quand quatre tournent : reculer son début ne
   * touche pas `ended_at`, le trigger ne se déclenche pas, et c'est voulu —
   * « en vrai j'ai commencé à 14 h » ne doit jamais buter sur le plafond.
   */
  const recale = await jetonA(
    "PATCH",
    `pulsar_entries?id=eq.${troisiemeId}&select=id,started_at,ended_at`,
    { started_at: hier(3), note: "Parti plus tôt qu'annoncé" },
  );
  verifie(
    "à quatre, le début d'un chronomètre se corrige et il continue de tourner",
    recale.status < 300 &&
      recale.data?.[0]?.ended_at === null &&
      Date.parse(recale.data?.[0]?.started_at) < Date.now() - 2.5 * 3600 * 1000,
    `statut ${recale.status}, ${JSON.stringify(recale.data)?.slice(0, 200)}`,
  );

  /*
   * Oublié sur pause : trois heures au compteur, quarante-cinq minutes de
   * travail. Il s'arrête à la durée choisie — sa fin, c'est son début plus
   * ce qu'on a choisi — et la ligne reste la même : rien à supprimer, rien à
   * ressaisir.
   */
  const debutOubli = Date.parse(recale.data?.[0]?.started_at ?? hier(3));
  const coupe = await jetonA(
    "PATCH",
    `pulsar_entries?id=eq.${troisiemeId}&select=id,started_at,ended_at,duration_minutes`,
    {
      ended_at: new Date(debutOubli + 45 * 60 * 1000).toISOString(),
      duration_minutes: 45,
    },
  );
  verifie(
    "un chronomètre oublié s'arrête à la durée choisie, sans être supprimé",
    coupe.status < 300 &&
      coupe.data?.[0]?.id === troisiemeId &&
      coupe.data?.[0]?.duration_minutes === 45 &&
      Date.parse(coupe.data?.[0]?.ended_at) - Date.parse(coupe.data?.[0]?.started_at) ===
        45 * 60 * 1000,
    `statut ${coupe.status}, ${JSON.stringify(coupe.data)?.slice(0, 200)}`,
  );

  const relance = await lancerA("seo", peggyId, "setup");
  const quatreDeNouveau = noter(relance);
  const remiseEnMarche = await jetonA(
    "PATCH",
    `pulsar_entries?id=eq.${troisiemeId}&select=id`,
    { ended_at: null, duration_minutes: null },
  );
  verifie(
    "à quatre, une entrée terminée ne se remet pas en marche",
    relance.status < 300 && remiseEnMarche.status >= 400,
    `relance ${relance.status}, remise en marche ${remiseEnMarche.status}`,
  );

  /*
   * Le téléphone et l'ordinateur au même instant, à trois chronomètres : le
   * verrou de la migration fait attendre le second, qui compte alors quatre et
   * s'arrête là. Sans lui, les deux compteraient trois et passeraient.
   */
  await arreterA(quatreDeNouveau);
  const simultanes = await Promise.all([
    lancerA("ads", peggyId, "setup"),
    lancerA("tracking", peggyId, "setup"),
  ]);
  simultanes.forEach(noter);
  const passes = simultanes.filter((reponse) => reponse.status < 300).length;
  const apresSimultanes = await enMarcheChezA();
  verifie(
    "deux démarrages simultanés au quatrième n'en font pas cinq",
    passes === 1 && apresSimultanes.length === 4,
    `${passes} accepté(s), ${apresSimultanes.length} en marche — statuts ${simultanes.map((r) => r.status).join(", ")}`,
  );

  const arret = await arreterA(enCoursId);
  verifie(
    "A arrête l'un d'eux, arrondi au quart d'heure, et les autres tournent",
    arret.status < 300 &&
      arret.data?.[0]?.duration_minutes === 15 &&
      (await enMarcheChezA()).length === 3,
    `statut ${arret.status}, ${JSON.stringify(arret.data)}`,
  );

  for (const { id } of await enMarcheChezA()) {
    await arreterA(id, 30);
  }
  verifie(
    "tous arrêtés, plus rien ne tourne chez A",
    (await enMarcheChezA()).length === 0,
  );

  // -------------------------- 3. Le quart d'heure ---------------------------

  console.log("\n== 3. Les durées ==");

  const saisie = (minutes, extra = {}) =>
    jetonA("POST", "pulsar_entries?select=id,duration_minutes", {
      organization_id: orgs.a.id,
      client_id: peggyId,
      task: "site",
      phase: "setup",
      started_at: hier(5),
      ended_at: hier(4),
      duration_minutes: minutes,
      is_manual: true,
      created_by: comptes.a,
      ...extra,
    });

  const vingt = await saisie(20);
  verifie(
    "20 minutes sont refusées",
    vingt.status >= 400,
    `statut ${vingt.status}`,
  );

  const dix = await saisie(10);
  verifie("10 minutes sont refusées", dix.status >= 400, `statut ${dix.status}`);

  const zero = await saisie(0);
  verifie("0 minute est refusée", zero.status >= 400, `statut ${zero.status}`);

  const quinze = await saisie(15);
  verifie(
    "15 minutes passent",
    quinze.status < 300 && quinze.data?.[0]?.duration_minutes === 15,
    `statut ${quinze.status}, ${JSON.stringify(quinze.data)}`,
  );
  noter(quinze);

  const quaranteCinq = await saisie(45);
  verifie(
    "45 minutes passent",
    quaranteCinq.status < 300,
    `statut ${quaranteCinq.status}`,
  );
  const entreeManuelleId = noter(quaranteCinq);

  const finieSansDuree = await jetonA("POST", "pulsar_entries?select=id", {
    organization_id: orgs.a.id,
    client_id: peggyId,
    task: "seo",
    phase: "setup",
    started_at: hier(5),
    ended_at: hier(4),
    created_by: comptes.a,
  });
  verifie(
    "une entrée terminée sans durée est refusée",
    finieSansDuree.status >= 400,
    `statut ${finieSansDuree.status}`,
  );

  const dureeSansFin = await jetonA("POST", "pulsar_entries?select=id", {
    organization_id: orgs.a.id,
    client_id: peggyId,
    task: "seo",
    phase: "setup",
    started_at: hier(5),
    duration_minutes: 30,
    created_by: comptes.a,
  });
  verifie(
    "une durée sans fin est refusée",
    dureeSansFin.status >= 400,
    `statut ${dureeSansFin.status}`,
  );

  const finAvantDebut = await saisie(15, { started_at: hier(4), ended_at: hier(5) });
  verifie(
    "une entrée qui finit avant de commencer est refusée",
    finAvantDebut.status >= 400,
    `statut ${finAvantDebut.status}`,
  );

  /*
   * Ce que `corriger` écrit pour une entrée d'un autre jour : son début, sa fin
   * et sa durée ensemble — et jamais sa phase.
   */
  const debutCorrige = hier(50);
  const finCorrigee = hier(49);
  const correction = await jetonA(
    "PATCH",
    `pulsar_entries?id=eq.${entreeManuelleId}&select=id,started_at,ended_at,duration_minutes,phase,is_manual`,
    {
      started_at: debutCorrige,
      ended_at: finCorrigee,
      duration_minutes: 60,
      is_manual: false,
    },
  );
  verifie(
    "une entrée d'un autre jour se corrige en début, fin et durée, et garde sa phase",
    correction.status < 300 &&
      Date.parse(correction.data?.[0]?.started_at) === Date.parse(debutCorrige) &&
      Date.parse(correction.data?.[0]?.ended_at) === Date.parse(finCorrigee) &&
      correction.data?.[0]?.duration_minutes === 60 &&
      correction.data?.[0]?.phase === "setup",
    `statut ${correction.status}, ${JSON.stringify(correction.data)}`,
  );

  const correctionAvantDebut = await jetonA(
    "PATCH",
    `pulsar_entries?id=eq.${entreeManuelleId}&select=id`,
    { ended_at: hier(51) },
  );
  verifie(
    "une correction qui ferait finir l'entrée avant son début est refusée",
    correctionAvantDebut.status >= 400,
    `statut ${correctionAvantDebut.status}`,
  );

  const correctionBancale = await jetonA(
    "PATCH",
    `pulsar_entries?id=eq.${entreeManuelleId}&select=id`,
    { duration_minutes: 25 },
  );
  verifie(
    "et une correction hors quart d'heure est refusée elle aussi",
    correctionBancale.status >= 400,
    `statut ${correctionBancale.status}`,
  );

  /*
   * Ce que `modifier` écrit quand on corrige le client d'une entrée : le
   * client, la tâche, la durée, la note — jamais la phase. Une entrée passée
   * du client Peggy au client interne garde donc son `setup`, parce qu'elle
   * dit ce qu'était le dossier au moment où l'on a travaillé, pas ce qu'il est
   * devenu. C'est la vérification du brief, faite là où elle se joue.
   */
  const changementDeClient = await jetonA(
    "PATCH",
    `pulsar_entries?id=eq.${entreeManuelleId}&select=id,client_id,phase`,
    { client_id: interneA.id, task: "admin" },
  );
  verifie(
    "corriger le client d'une entrée ne déplace pas sa phase d'origine",
    changementDeClient.status < 300 &&
      changementDeClient.data?.[0]?.client_id === interneA.id &&
      changementDeClient.data?.[0]?.phase === "setup",
    `statut ${changementDeClient.status}, ${JSON.stringify(changementDeClient.data)}`,
  );

  await jetonA("PATCH", `pulsar_entries?id=eq.${entreeManuelleId}`, {
    client_id: peggyId,
    task: "site",
  });

  // ---------------------------- 4. La signature -----------------------------

  console.log("\n== 4. La signature ==");

  const signatureVolee = await jetonA("POST", "pulsar_entries?select=id", {
    organization_id: orgs.a.id,
    client_id: peggyId,
    task: "admin",
    phase: "setup",
    started_at: hier(5),
    ended_at: hier(4),
    duration_minutes: 15,
    created_by: comptes.b,
  });
  verifie(
    "on ne compte pas une heure sous le nom d'un autre",
    refuse(signatureVolee),
    `statut ${signatureVolee.status}`,
  );

  // -------------------------- 5. Le client « Comète » -----------------------

  console.log("\n== 5. « Comète » ==");

  const secondInterne = await jetonA("POST", "pulsar_clients?select=id", {
    organization_id: orgs.a.id,
    name: "Comète bis",
    is_internal: true,
  });
  verifie(
    "un second client interne dans la même organisation est refusé",
    secondInterne.status >= 400,
    `statut ${secondInterne.status}`,
  );

  const renommage = await jetonA(
    "PATCH",
    `pulsar_clients?id=eq.${interneA.id}&select=id`,
    { name: "Comète Studio" },
  );
  verifie(
    "« Comète » ne se renomme pas",
    renommage.status >= 400,
    `statut ${renommage.status}, ${JSON.stringify(renommage.data)?.slice(0, 160)}`,
  );

  const sortieDuStatut = await jetonA(
    "PATCH",
    `pulsar_clients?id=eq.${interneA.id}&select=id`,
    { is_internal: false },
  );
  verifie(
    "et il ne sort pas de son statut",
    sortieDuStatut.status >= 400,
    `statut ${sortieDuStatut.status}`,
  );

  const promotion = await jetonA(
    "PATCH",
    `pulsar_clients?id=eq.${peggyId}&select=id`,
    { is_internal: true },
  );
  verifie(
    "aucun client ne devient interne après coup",
    promotion.status >= 400,
    `statut ${promotion.status}`,
  );

  const suppressionInterne = await jetonA(
    "DELETE",
    `pulsar_clients?id=eq.${interneA.id}&select=id`,
  );
  verifie(
    "et il ne se supprime pas",
    refuse(suppressionInterne),
    `statut ${suppressionInterne.status}, ${JSON.stringify(suppressionInterne.data)}`,
  );

  const interneTouJours = await srv(
    "GET",
    `pulsar_clients?select=id,name,is_internal&id=eq.${interneA.id}`,
  );
  verifie(
    "après ces tentatives, « Comète » est intact",
    interneTouJours.data?.[0]?.name === "Comète" &&
      interneTouJours.data?.[0]?.is_internal === true,
    JSON.stringify(interneTouJours.data),
  );

  // ------------------------------ 6. L'histoire -----------------------------

  console.log("\n== 6. On ne réécrit pas l'histoire ==");

  const suppressionPeggy = await jetonA(
    "DELETE",
    `pulsar_clients?id=eq.${peggyId}&select=id`,
  );
  verifie(
    "un client dont on a compté les heures ne se supprime pas",
    suppressionPeggy.status >= 400,
    `statut ${suppressionPeggy.status}, ${JSON.stringify(suppressionPeggy.data)?.slice(0, 160)}`,
  );

  const archivage = await jetonA(
    "PATCH",
    `pulsar_clients?id=eq.${peggyId}&select=id,statut`,
    { statut: "termine" },
  );
  verifie(
    "il se passe en « terminé », c'est le geste prévu",
    archivage.status < 300 && archivage.data?.[0]?.statut === "termine",
    `statut ${archivage.status}, ${JSON.stringify(archivage.data)}`,
  );

  const sansHeures = await jetonA("POST", "pulsar_clients?select=id", {
    organization_id: orgs.a.id,
    name: "Prospect sans suite",
  });
  const suppressionSansHeures = await jetonA(
    "DELETE",
    `pulsar_clients?id=eq.${sansHeures.data?.[0]?.id}&select=id`,
  );
  verifie(
    "un client sans la moindre heure, lui, s'efface",
    suppressionSansHeures.status < 300 &&
      suppressionSansHeures.data?.length === 1,
    `statut ${suppressionSansHeures.status}`,
  );

  const entreeCroisee = await jetonA("POST", "pulsar_entries?select=id", {
    organization_id: orgs.a.id,
    client_id: peggyChezB,
    task: "ads",
    phase: "setup",
    started_at: hier(5),
    ended_at: hier(4),
    duration_minutes: 15,
    created_by: comptes.a,
  });
  verifie(
    "une entrée ne se range pas sous le client d'une autre organisation",
    entreeCroisee.status >= 400,
    `statut ${entreeCroisee.status}, ${JSON.stringify(entreeCroisee.data)?.slice(0, 160)}`,
  );

  // ----------------------------- 7. L'isolation -----------------------------

  console.log("\n== 7. B ne touche à rien chez A ==");

  const lectureClients = await jetonB(
    "GET",
    `pulsar_clients?select=id,name&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "B ne lit aucun client de A",
    vide(lectureClients),
    `statut ${lectureClients.status}, ${JSON.stringify(lectureClients.data)}`,
  );

  const lectureEntrees = await jetonB(
    "GET",
    `pulsar_entries?select=id&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "B ne lit aucune heure de A",
    vide(lectureEntrees),
    `statut ${lectureEntrees.status}, ${JSON.stringify(lectureEntrees.data)}`,
  );

  const lectureSeuils = await jetonB(
    "GET",
    `pulsar_settings?select=organization_id&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "B ne lit pas les seuils de A",
    vide(lectureSeuils),
    `statut ${lectureSeuils.status}, ${JSON.stringify(lectureSeuils.data)}`,
  );

  const clientChezA = await jetonB("POST", "pulsar_clients?select=id", {
    organization_id: orgs.a.id,
    name: "Intrus",
  });
  verifie(
    "B ne crée pas de client chez A",
    refuse(clientChezA),
    `statut ${clientChezA.status}`,
  );

  const heureChezA = await jetonB("POST", "pulsar_entries?select=id", {
    organization_id: orgs.a.id,
    client_id: peggyId,
    task: "admin",
    phase: "setup",
    started_at: hier(5),
    ended_at: hier(4),
    duration_minutes: 15,
    created_by: comptes.b,
  });
  verifie(
    "B ne compte pas d'heure chez A",
    refuse(heureChezA),
    `statut ${heureChezA.status}`,
  );

  const modifChezA = await jetonB(
    "PATCH",
    `pulsar_entries?id=eq.${entreeManuelleId}&select=id`,
    { duration_minutes: 15 },
  );
  verifie(
    "B ne corrige pas une heure de A",
    refuse(modifChezA),
    `statut ${modifChezA.status}`,
  );

  const effaceChezA = await jetonB(
    "DELETE",
    `pulsar_entries?id=eq.${entreeManuelleId}&select=id`,
  );
  verifie(
    "B n'efface pas une heure de A",
    refuse(effaceChezA),
    `statut ${effaceChezA.status}`,
  );

  const seuilsChezA = await jetonB(
    "PATCH",
    `pulsar_settings?organization_id=eq.${orgs.a.id}&select=organization_id`,
    { taux_alerte_cents: 1 },
  );
  verifie(
    "B ne déplace pas les seuils de A",
    refuse(seuilsChezA),
    `statut ${seuilsChezA.status}`,
  );

  const porteB = await jetonB("POST", "rpc/can_access_temps", { org: orgs.a.id });
  verifie(
    "`can_access_temps` dit non à B pour l'organisation de A",
    porteB.data === false,
    JSON.stringify(porteB.data),
  );

  const resteA = await srv(
    "GET",
    `pulsar_entries?select=id&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    `après les tentatives de B, A a toujours ses ${heuresDeA.size} heures comptées`,
    resteA.data?.length === heuresDeA.size,
    `${resteA.data?.length} entrée(s)`,
  );

  const seuilsDeA = await jetonA(
    "PATCH",
    `pulsar_settings?organization_id=eq.${orgs.a.id}&select=taux_alerte_cents,heures_pilotage_alerte`,
    { taux_alerte_cents: 5000, heures_pilotage_alerte: 12 },
  );
  verifie(
    "A, lui, règle ses propres seuils",
    seuilsDeA.status < 300 && seuilsDeA.data?.[0]?.taux_alerte_cents === 5000,
    `statut ${seuilsDeA.status}, ${JSON.stringify(seuilsDeA.data)}`,
  );

  const seuilAbsurde = await jetonA(
    "PATCH",
    `pulsar_settings?organization_id=eq.${orgs.a.id}&select=organization_id`,
    { heures_pilotage_alerte: 0 },
  );
  verifie(
    "un plafond d'heures à zéro est refusé",
    seuilAbsurde.status >= 400,
    `statut ${seuilAbsurde.status}`,
  );

  // ---------------------------- 8. Outil coupé ------------------------------

  console.log("\n== 8. Outil coupé ==");

  await allumer(orgs.a.id, false);

  const porteCoupee = await jetonA("POST", "rpc/can_access_temps", {
    org: orgs.a.id,
  });
  verifie(
    "`can_access_temps` dit non dès que l'outil est coupé",
    porteCoupee.data === false,
    JSON.stringify(porteCoupee.data),
  );

  const clientsCoupes = await jetonA("GET", "pulsar_clients?select=id");
  verifie(
    "outil coupé, A ne voit plus aucun client",
    vide(clientsCoupes),
    `statut ${clientsCoupes.status}, ${JSON.stringify(clientsCoupes.data)}`,
  );

  const heuresCoupees = await jetonA("GET", "pulsar_entries?select=id");
  verifie(
    "ni aucune heure",
    vide(heuresCoupees),
    `statut ${heuresCoupees.status}, ${JSON.stringify(heuresCoupees.data)}`,
  );

  const seuilsCoupes = await jetonA("GET", "pulsar_settings?select=organization_id");
  verifie(
    "ni ses seuils",
    vide(seuilsCoupes),
    `statut ${seuilsCoupes.status}, ${JSON.stringify(seuilsCoupes.data)}`,
  );

  const ecritureCoupee = await jetonA("POST", "pulsar_entries?select=id", {
    organization_id: orgs.a.id,
    client_id: peggyId,
    task: "admin",
    phase: "setup",
    started_at: hier(5),
    ended_at: hier(4),
    duration_minutes: 15,
    created_by: comptes.a,
  });
  verifie(
    "outil coupé, A ne compte plus rien",
    refuse(ecritureCoupee),
    `statut ${ecritureCoupee.status}`,
  );

  await allumer(orgs.a.id, true);

  const retourClients = await jetonA("GET", "pulsar_clients?select=id");
  const retourHeures = await jetonA("GET", "pulsar_entries?select=id");
  verifie(
    "outil rallumé, le carnet de A revient entier",
    retourClients.data?.length === 2 && retourHeures.data?.length === heuresDeA.size,
    `${retourClients.data?.length} client(s), ${retourHeures.data?.length} entrée(s)`,
  );
} finally {
  // ------------------------------ Nettoyage --------------------------------

  console.log("\n== Nettoyage ==");

  /*
   * Ce ménage est aussi une vérification, et la plus importante du banc.
   *
   * Une organisation qu'on supprime emporte ses clients Pulsar *et* leurs
   * entrées, alors même qu'une entrée interdit la suppression de son client.
   * C'est exactement le cas que `on delete restrict` aurait fait échouer, en
   * rendant l'organisation indestructible ; `no action` laisse la cascade
   * finir son ordre avant de vérifier. Si ce banc laisse des restes, c'est là
   * qu'il faut regarder.
   */
  const cibles = Object.values(orgs)
    .map((org) => org?.id)
    .filter(Boolean);

  for (const org of Object.values(orgs)) {
    if (org?.id) {
      const suppression = await srv("DELETE", `organizations?id=eq.${org.id}`);
      verifie(
        `l'organisation ${org.slug} se supprime malgré ses heures comptées`,
        suppression.status < 300,
        `statut ${suppression.status}, ${JSON.stringify(suppression.data)?.slice(0, 200)}`,
      );
    }
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

  // Les restes se cherchent dans le décor du banc, jamais dans toute la table :
  // Louis se sert de Pulsar pour de bon, et un banc qui échoue parce que le
  // produit sert apprend à ne plus le croire.
  if (cibles.length > 0) {
    const dans = `in.(${cibles.join(",")})`;
    const clients = (
      await srv("GET", `pulsar_clients?select=id&organization_id=${dans}`)
    ).data;
    const entrees = (
      await srv("GET", `pulsar_entries?select=id&organization_id=${dans}`)
    ).data;
    const seuils = (
      await srv("GET", `pulsar_settings?select=organization_id&organization_id=${dans}`)
    ).data;

    verifie(
      "clients, heures et seuils du décor sont partis avec leur organisation",
      clients.length === 0 && entrees.length === 0 && seuils.length === 0,
      `${clients.length} client(s), ${entrees.length} entrée(s), ${seuils.length} réglage(s)`,
    );
  }

  bilan();
}
