/**
 * Banc de l'outil Radar — socle (phase 4, chantier 1).
 *
 *   npm run qa:radar
 *
 * Deux clients, deux comptes. On vérifie que le membre d'un client ne voit ni
 * ne touche rien de l'autre, que la vue de lecture respecte la RLS au lieu de
 * la contourner, que les deux fonctions d'action tiennent leurs garde-fous, et
 * que les secrets du Vault sont hors de portée d'une session.
 *
 * Ce dernier point est le plus important du fichier : le sel permet de
 * retrouver qui se cache derrière une `invitee_key` en testant des emails. Un
 * membre qui pourrait le lire ferait tomber toute la pseudonymisation.
 *
 * Chantier 1 : le socle. Les webhooks, l'attribution et les relevés
 * s'ajouteront ici aux chantiers 2 et 7.
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

const { verifie, bilan } = journal();
annoncerCible("QA — outil Radar (socle)");

const marque = Math.random().toString(36).slice(2, 8);
const emails = {
  a1: `zz-qa-r1-${marque}@comete-qa.test`,
  b1: `zz-qa-r2-${marque}@comete-qa.test`,
};
const comptes = {};
const orgs = {};

/*
 * Les rendez-vous présents avant le décor. On vérifie qu'on rend la table
 * telle qu'on l'a trouvée, pas qu'elle est vide : un vrai client en aura.
 */
const rdvAvant = (await srv("GET", "radar_bookings?select=id&limit=1000")).data.length;

/** Une date décalée de `jours` par rapport à maintenant. */
const jours = (n) => new Date(Date.now() + n * 86400000).toISOString();

/** Le message d'une erreur PostgREST, pour lire ce que la base a répondu. */
const motif = (resultat) =>
  typeof resultat.data === "object" && resultat.data
    ? (resultat.data.message ?? JSON.stringify(resultat.data))
    : String(resultat.data);

try {
  // --------------------------------- Décor ---------------------------------

  comptes.a1 = await creerCompte(emails.a1);
  comptes.b1 = await creerCompte(emails.b1);

  orgs.a = await creer("organizations", { name: "ZZ QA RA", slug: `zz-qa-ra-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA RB", slug: `zz-qa-rb-${marque}` });

  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.a1, role: "owner" });
  await creer("memberships", { organization_id: orgs.b.id, user_id: comptes.b1, role: "owner" });

  const outilId = (await srv("GET", "tools?select=id&slug=eq.resultats")).data[0].id;
  const basculer = (orgId, enabled) =>
    srv("PATCH", `organization_tools?organization_id=eq.${orgId}&tool_id=eq.${outilId}`, {
      enabled,
    });

  await creer("organization_tools", { organization_id: orgs.a.id, tool_id: outilId, enabled: true });
  await creer("organization_tools", { organization_id: orgs.b.id, tool_id: outilId, enabled: true });

  await creer("radar_settings", { organization_id: orgs.a.id, commission_rate: 20, window_days: 90 });

  const canalComete = await creer("radar_channels", {
    organization_id: orgs.a.id,
    key: "google_ads",
    label: "Google Ads",
    is_comete: true,
    sort_order: 10,
  });
  const canalDirect = await creer("radar_channels", {
    organization_id: orgs.a.id,
    key: "direct",
    label: "Direct",
    is_comete: false,
    sort_order: 90,
  });

  const rdv = async (attributs) =>
    creer("radar_bookings", {
      organization_id: orgs.a.id,
      invitee_uri: `https://api.calendly.com/invitees/${crypto.randomUUID()}`,
      event_uri: `https://api.calendly.com/events/${crypto.randomUUID()}`,
      invitee_key: "cle-de-test",
      event_type_name: "Séance",
      currency: "EUR",
      ...attributs,
    });

  const passePaye = await rdv({
    scheduled_start: jours(-10),
    scheduled_end: jours(-10),
    channel_id: canalComete.id,
    amount_cents: 9000,
    payment_ok: true,
  });
  const passeGratuit = await rdv({
    scheduled_start: jours(-9),
    scheduled_end: jours(-9),
    channel_id: canalComete.id,
    amount_cents: 0,
    payment_ok: true,
  });
  const futur = await rdv({
    scheduled_start: jours(10),
    scheduled_end: jours(10),
    channel_id: canalComete.id,
    amount_cents: 9000,
    payment_ok: true,
  });
  const horsComete = await rdv({
    scheduled_start: jours(-8),
    scheduled_end: jours(-8),
    channel_id: canalDirect.id,
    amount_cents: 9000,
    payment_ok: true,
  });
  const annuleParCalendly = await rdv({
    scheduled_start: jours(-7),
    scheduled_end: jours(-7),
    channel_id: canalComete.id,
    amount_cents: 9000,
    payment_ok: true,
    status: "annule",
    status_origin: "calendly",
  });

  const a1 = par(await connecter(emails.a1));
  const b1 = par(await connecter(emails.b1));

  // ------------------------- 1. Le Vault, d'abord --------------------------

  console.log("== 1. Les secrets ==");

  const pose = await srv("POST", "rpc/radar_set_secret", {
    org: orgs.a.id,
    kind: "salt",
    value: "sel-de-recette-0123456789",
  });
  verifie(
    "service_role pose un secret",
    pose.status < 300,
    `statut ${pose.status} ${motif(pose)}`,
  );

  const relu = await srv("POST", "rpc/radar_get_secret", { org: orgs.a.id, kind: "salt" });
  verifie(
    "service_role le relit à l'identique",
    relu.data === "sel-de-recette-0123456789",
    `${relu.status} ${JSON.stringify(relu.data)}`,
  );

  // Le remplacer plutôt que d'en empiler un second : c'est ce que fera une
  // reconnexion Calendly.
  await srv("POST", "rpc/radar_set_secret", {
    org: orgs.a.id,
    kind: "salt",
    value: "sel-remplace",
  });
  const relu2 = await srv("POST", "rpc/radar_get_secret", { org: orgs.a.id, kind: "salt" });
  verifie("un secret reposé remplace l'ancien", relu2.data === "sel-remplace", JSON.stringify(relu2.data));

  const kindInconnu = await srv("POST", "rpc/radar_set_secret", {
    org: orgs.a.id,
    kind: "autre",
    value: "x",
  });
  verifie("un type de secret inconnu est refusé", refuse(kindInconnu), `statut ${kindInconnu.status}`);

  const lectureMembre = await a1("POST", "rpc/radar_get_secret", { org: orgs.a.id, kind: "salt" });
  verifie(
    "le membre de l'organisation ne lit aucun secret",
    refuse(lectureMembre),
    `statut ${lectureMembre.status} ${motif(lectureMembre)}`,
  );

  const ecritureMembre = await a1("POST", "rpc/radar_set_secret", {
    org: orgs.a.id,
    kind: "salt",
    value: "pirate",
  });
  verifie(
    "le membre ne pose aucun secret",
    refuse(ecritureMembre),
    `statut ${ecritureMembre.status}`,
  );

  const toujoursLa = await srv("POST", "rpc/radar_get_secret", { org: orgs.a.id, kind: "salt" });
  verifie("le secret est intact après ses tentatives", toujoursLa.data === "sel-remplace", JSON.stringify(toujoursLa.data));

  // ---------------------------- 2. Le mois ---------------------------------

  console.log("\n== 2. Le découpage des mois ==");

  const mois = async (quand) => (await a1("POST", "rpc/radar_mois", { quand })).data;

  verifie(
    "31 octobre 23 h 30 à Paris tombe en octobre",
    (await mois("2026-10-31T23:30:00+01:00")) === "2026-10-01",
    await mois("2026-10-31T23:30:00+01:00"),
  );
  verifie(
    "1er novembre 00 h 30 à Paris tombe en novembre (et non en octobre UTC)",
    (await mois("2026-11-01T00:30:00+01:00")) === "2026-11-01",
    await mois("2026-11-01T00:30:00+01:00"),
  );

  const moisParLaCle = await srv("POST", "rpc/radar_mois", { quand: "2026-11-01T00:30:00+01:00" });
  verifie(
    "service_role sait aussi découper les mois (chantier 5 en dépendra)",
    moisParLaCle.data === "2026-11-01",
    `statut ${moisParLaCle.status} ${JSON.stringify(moisParLaCle.data)}`,
  );

  // --------------------------- 3. La vue ------------------------------------

  console.log("\n== 3. La vue de lecture ==");

  const vue = await a1(
    "GET",
    `radar_bookings_effective?select=id,effective_status,counts_for_commission&organization_id=eq.${orgs.a.id}`,
  );
  const parId = Object.fromEntries((vue.data ?? []).map((l) => [l.id, l]));

  verifie("A1 lit ses cinq rendez-vous par la vue", (vue.data ?? []).length === 5, `${(vue.data ?? []).length}`);
  verifie(
    "une séance passée et confirmée est honorée",
    parId[passePaye.id]?.effective_status === "honore",
    JSON.stringify(parId[passePaye.id]),
  );
  verifie(
    "une séance à venir reste confirmée",
    parId[futur.id]?.effective_status === "confirme",
    JSON.stringify(parId[futur.id]),
  );
  verifie(
    "une séance honorée, payée, d'un canal Comète compte",
    parId[passePaye.id]?.counts_for_commission === true,
    JSON.stringify(parId[passePaye.id]),
  );
  verifie(
    "une séance gratuite ne compte pas",
    parId[passeGratuit.id]?.counts_for_commission === false,
    JSON.stringify(parId[passeGratuit.id]),
  );
  verifie(
    "une séance hors canal Comète ne compte pas",
    parId[horsComete.id]?.counts_for_commission === false,
    JSON.stringify(parId[horsComete.id]),
  );
  verifie(
    "une séance annulée ne compte pas",
    parId[annuleParCalendly.id]?.counts_for_commission === false,
    JSON.stringify(parId[annuleParCalendly.id]),
  );
  verifie(
    "une séance à venir ne compte pas encore",
    parId[futur.id]?.counts_for_commission === false,
    JSON.stringify(parId[futur.id]),
  );

  // Le point qui compte vraiment : une vue sans `security_invoker` lirait avec
  // les droits de son propriétaire et contournerait toute la RLS.
  const vueDeB = await b1(
    "GET",
    `radar_bookings_effective?select=id&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "B1 ne voit rien de A par la vue (security_invoker)",
    vide(vueDeB),
    `statut ${vueDeB.status} ${JSON.stringify(vueDeB.data)}`,
  );

  // ------------------- 4. Ce que le membre ne peut pas ----------------------

  console.log("\n== 4. Le membre de B ne touche à rien de A ==");

  verifie("B1 · réglages de A", vide(await b1("GET", `radar_settings?select=organization_id&organization_id=eq.${orgs.a.id}`)));
  verifie("B1 · canaux de A", vide(await b1("GET", `radar_channels?select=id&organization_id=eq.${orgs.a.id}`)));
  verifie("B1 · rendez-vous de A", vide(await b1("GET", `radar_bookings?select=id&organization_id=eq.${orgs.a.id}`)));
  verifie("B1 · activités de A", vide(await b1("GET", `radar_booking_activities?select=id&organization_id=eq.${orgs.a.id}`)));
  verifie("B1 · relevés de A", vide(await b1("GET", `radar_statements?select=id&organization_id=eq.${orgs.a.id}`)));

  const statutParB = await b1("POST", "rpc/radar_client_set_status", {
    booking_id: passePaye.id,
    new_status: "no_show",
  });
  verifie(
    "B1 ne change pas le statut d'un rendez-vous de A",
    refuse(statutParB),
    `statut ${statutParB.status} ${motif(statutParB)}`,
  );

  console.log("\n== 5. Le membre de A lit, mais n'écrit pas ==");

  verifie(
    "A1 · lit ses rendez-vous",
    (await a1("GET", `radar_bookings?select=id&organization_id=eq.${orgs.a.id}`)).data.length === 5,
  );

  const insertion = await a1("POST", "radar_bookings", {
    organization_id: orgs.a.id,
    invitee_uri: `https://api.calendly.com/invitees/${crypto.randomUUID()}`,
    event_uri: "https://api.calendly.com/events/x",
    invitee_key: "cle",
    scheduled_start: jours(1),
    scheduled_end: jours(1),
    event_type_name: "Séance inventée",
  });
  verifie("A1 · n'invente pas un rendez-vous", refuse(insertion), `statut ${insertion.status}`);

  const modification = await a1("PATCH", `radar_bookings?id=eq.${passePaye.id}&select=id`, {
    amount_cents: 999999,
  });
  verifie("A1 · ne change pas le montant d'une séance", refuse(modification), `statut ${modification.status}`);

  const suppression = await a1("DELETE", `radar_bookings?id=eq.${passePaye.id}&select=id`);
  verifie("A1 · ne supprime pas un rendez-vous", refuse(suppression), `statut ${suppression.status}`);

  const canalParA = await a1("PATCH", `radar_channels?id=eq.${canalDirect.id}&select=id`, {
    is_comete: true,
  });
  verifie("A1 · ne se déclare pas un canal Comète de plus", refuse(canalParA), `statut ${canalParA.status}`);

  verifie(
    "A1 · ne lit pas les dépenses de Louis",
    vide(await a1("GET", `radar_channel_entries?select=id&organization_id=eq.${orgs.a.id}`)),
  );
  verifie(
    "A1 · ne lit pas le journal des webhooks",
    vide(await a1("GET", `radar_webhook_log?select=id&organization_id=eq.${orgs.a.id}`)),
  );

  // --------------------- 6. La fonction de statut ---------------------------

  console.log("\n== 6. radar_client_set_status ==");

  const marqueNonVenu = await a1("POST", "rpc/radar_client_set_status", {
    booking_id: passePaye.id,
    new_status: "no_show",
    note: "elle n'est pas venue",
  });
  verifie(
    "A1 marque une séance non venue",
    marqueNonVenu.status < 300,
    `statut ${marqueNonVenu.status} ${motif(marqueNonVenu)}`,
  );

  const apres = (await srv("GET", `radar_bookings?select=status,status_origin,status_note&id=eq.${passePaye.id}`)).data[0];
  verifie(
    "le statut, son origine et le motif sont écrits",
    apres.status === "no_show" && apres.status_origin === "client" && apres.status_note === "elle n'est pas venue",
    JSON.stringify(apres),
  );

  const activite = (await srv("GET", `radar_booking_activities?select=type,user_id,payload&booking_id=eq.${passePaye.id}`)).data;
  verifie(
    "une activité est déposée, signée du membre",
    activite.length === 1 && activite[0].type === "status.changed" && activite[0].user_id === comptes.a1,
    JSON.stringify(activite),
  );
  verifie(
    "A1 relit son activité",
    (await a1("GET", `radar_booking_activities?select=id&booking_id=eq.${passePaye.id}`)).data.length === 1,
  );

  const retablit = await a1("POST", "rpc/radar_client_set_status", {
    booking_id: passePaye.id,
    new_status: "confirme",
  });
  verifie("A1 revient en arrière", retablit.status < 300, `statut ${retablit.status} ${motif(retablit)}`);

  const versHonore = await a1("POST", "rpc/radar_client_set_status", {
    booking_id: passePaye.id,
    new_status: "honore",
  });
  verifie(
    "A1 ne pose pas « honoré » lui-même (il se calcule)",
    refuse(versHonore),
    `statut ${versHonore.status} ${motif(versHonore)}`,
  );

  const rouvreCalendly = await a1("POST", "rpc/radar_client_set_status", {
    booking_id: annuleParCalendly.id,
    new_status: "confirme",
  });
  verifie(
    "A1 ne rouvre pas une annulation venue de Calendly",
    refuse(rouvreCalendly),
    `statut ${rouvreCalendly.status} ${motif(rouvreCalendly)}`,
  );

  // Un relevé sur le mois de la séance ferme la porte.
  const moisDeLaSeance = (await srv("POST", "rpc/radar_mois", { quand: futur.scheduled_start })).data;
  await creer("radar_statements", {
    organization_id: orgs.a.id,
    month: moisDeLaSeance,
    commission_rate: 20,
    window_days: 90,
  });

  const moisCloture = await a1("POST", "rpc/radar_client_set_status", {
    booking_id: futur.id,
    new_status: "annule",
  });
  verifie(
    "un rendez-vous d'un mois clôturé ne change plus",
    refuse(moisCloture),
    `statut ${moisCloture.status} ${motif(moisCloture)}`,
  );

  // ------------------- 7. La réponse au relevé ------------------------------

  console.log("\n== 7. radar_review_statement ==");

  const releve = (await srv("GET", `radar_statements?select=id&organization_id=eq.${orgs.a.id}`)).data[0];

  const contesteSansMotif = await a1("POST", "rpc/radar_review_statement", {
    statement_id: releve.id,
    decision: "conteste",
  });
  verifie(
    "contester sans rien dire est refusé",
    refuse(contesteSansMotif),
    `statut ${contesteSansMotif.status} ${motif(contesteSansMotif)}`,
  );

  const decisionInterdite = await a1("POST", "rpc/radar_review_statement", {
    statement_id: releve.id,
    decision: "paye",
  });
  verifie(
    "le client ne se déclare pas payé",
    refuse(decisionInterdite),
    `statut ${decisionInterdite.status} ${motif(decisionInterdite)}`,
  );

  const releveDeB = await b1("POST", "rpc/radar_review_statement", {
    statement_id: releve.id,
    decision: "valide",
  });
  verifie("B1 ne répond pas au relevé de A", refuse(releveDeB), `statut ${releveDeB.status}`);

  const conteste = await a1("POST", "rpc/radar_review_statement", {
    statement_id: releve.id,
    decision: "conteste",
    comment: "il manque la séance du 12",
  });
  verifie("A1 conteste avec un motif", conteste.status < 300, `statut ${conteste.status} ${motif(conteste)}`);

  const releveApres = (await srv("GET", `radar_statements?select=status,review_comment,reviewed_by&id=eq.${releve.id}`)).data[0];
  verifie(
    "la contestation est enregistrée et signée",
    releveApres.status === "conteste" &&
      releveApres.review_comment === "il manque la séance du 12" &&
      releveApres.reviewed_by === comptes.a1,
    JSON.stringify(releveApres),
  );

  const deuxiemeFois = await a1("POST", "rpc/radar_review_statement", {
    statement_id: releve.id,
    decision: "valide",
  });
  verifie(
    "on ne répond pas deux fois au même relevé",
    refuse(deuxiemeFois),
    `statut ${deuxiemeFois.status} ${motif(deuxiemeFois)}`,
  );

  // --------------------------- 8. Outil coupé -------------------------------

  console.log("\n== 8. Radar coupé pour A ==");

  await basculer(orgs.a.id, false);

  verifie("outil coupé · A1 ne voit plus ses rendez-vous", vide(await a1("GET", `radar_bookings?select=id&organization_id=eq.${orgs.a.id}`)));
  verifie("outil coupé · la vue ne montre plus rien", vide(await a1("GET", `radar_bookings_effective?select=id&organization_id=eq.${orgs.a.id}`)));
  verifie("outil coupé · ni les réglages", vide(await a1("GET", `radar_settings?select=organization_id&organization_id=eq.${orgs.a.id}`)));
  verifie(
    "outil coupé · can_access_radar répond faux",
    (await a1("POST", "rpc/can_access_radar", { org: orgs.a.id })).data === false,
  );

  const statutCoupe = await a1("POST", "rpc/radar_client_set_status", {
    booking_id: horsComete.id,
    new_status: "no_show",
  });
  verifie(
    "outil coupé · A1 ne change plus aucun statut",
    refuse(statutCoupe),
    `statut ${statutCoupe.status} ${motif(statutCoupe)}`,
  );

  await basculer(orgs.a.id, true);
  verifie(
    "outil rendu · A1 revoit ses rendez-vous",
    (await a1("GET", `radar_bookings?select=id&organization_id=eq.${orgs.a.id}`)).data.length === 5,
  );

  // ---------------------------- 9. Les purges -------------------------------

  console.log("\n== 9. Effacer les secrets ==");

  const secretsEfface = await srv("POST", "rpc/radar_clear_secrets", { org: orgs.a.id });
  verifie(
    "radar_clear_secrets efface les secrets du client",
    secretsEfface.status < 300 && Number(secretsEfface.data) >= 1,
    `statut ${secretsEfface.status} ${JSON.stringify(secretsEfface.data)}`,
  );
  const apresEffacement = await srv("POST", "rpc/radar_get_secret", { org: orgs.a.id, kind: "salt" });
  verifie(
    "le secret effacé ne se relit plus",
    apresEffacement.data === null,
    JSON.stringify(apresEffacement.data),
  );
} finally {
  console.log("\n== Nettoyage ==");

  for (const org of Object.values(orgs)) {
    if (!org?.id) continue;
    await srv("POST", "rpc/radar_clear_secrets", { org: org.id });
    await srv("DELETE", `organizations?id=eq.${org.id}`);
  }
  for (const id of Object.values(comptes)) {
    if (id) await supprimerCompte(id);
  }

  const orgsRestantes = (await srv("GET", "organizations?select=slug&slug=like.zz-qa-*")).data;
  const profilsRestants = (await srv("GET", "profiles?select=email&email=like.zz-qa-*")).data;
  verifie("aucune organisation de test ne subsiste", orgsRestantes.length === 0, JSON.stringify(orgsRestantes));
  verifie("aucun compte de test ne subsiste", profilsRestants.length === 0, JSON.stringify(profilsRestants));

  const rdvApres = (await srv("GET", "radar_bookings?select=id&limit=1000")).data.length;
  verifie(
    "aucun rendez-vous de test ne subsiste",
    rdvApres === rdvAvant,
    `${rdvAvant} avant, ${rdvApres} après`,
  );

  bilan();
}
