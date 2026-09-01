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
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { CANAUX_PAR_DEFAUT } from "../src/tools/resultats/attribution.ts";
import {
  construireLignes,
  construireLignesVentes,
  peutChangerDeBase,
  totaux,
  versCsv,
} from "../src/tools/resultats/releve.ts";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:3100";

const { verifie, bilan } = journal();
annoncerCible(`QA — outil Radar\nServeur visé : ${BASE}`);

/*
 * Avant toute écriture : la section du webhook poste sur une vraie route. Si
 * le serveur ne répond pas, on s'arrête ici plutôt que d'annoncer « 0 en
 * échec » après avoir posé un décor et sauté la moitié du banc.
 */
if (!(await fetch(BASE, { redirect: "manual" }).catch(() => null))) {
  console.error(
    BASE +
      " ne répond pas. Lance d'abord `npm run build`, puis `npx next start -p 3100` dans un autre terminal.",
  );
  process.exit(1);
}

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

  /*
   * Le plus tentant de tous : le taux est ce que le client paie. S'il pouvait
   * l'écrire, Radar ne servirait plus à rien.
   */
  const tauxParA = await a1(
    "PATCH",
    `radar_settings?organization_id=eq.${orgs.a.id}&select=commission_rate`,
    { commission_rate: 1 },
  );
  verifie(
    "A1 · ne baisse pas son propre taux de commission",
    refuse(tauxParA),
    `statut ${tauxParA.status}`,
  );
  verifie(
    "… et le taux est intact",
    Number(
      (await srv("GET", `radar_settings?select=commission_rate&organization_id=eq.${orgs.a.id}`))
        .data[0].commission_rate,
    ) === 20,
  );

  const fenetreParA = await a1(
    "PATCH",
    `radar_settings?organization_id=eq.${orgs.a.id}&select=window_days`,
    { window_days: 0 },
  );
  verifie("A1 · ne raccourcit pas la fenêtre de récurrence", refuse(fenetreParA));

  const canalInvente = await a1("POST", "radar_channels", {
    organization_id: orgs.a.id,
    key: "invente",
    label: "Canal inventé",
    is_comete: false,
  });
  verifie("A1 · n'ajoute pas de canal", refuse(canalInvente), `statut ${canalInvente.status}`);

  const canalEfface = await a1("DELETE", `radar_channels?id=eq.${canalComete.id}&select=id`);
  verifie("A1 · ne supprime pas un canal", refuse(canalEfface));

  const saisieParA = await a1("POST", "radar_channel_entries", {
    organization_id: orgs.a.id,
    month: "2026-01-01",
    channel_id: canalComete.id,
    spend_cents: 999999,
  });
  verifie(
    "A1 · n'invente pas une dépense pour gonfler le coût de Louis",
    refuse(saisieParA),
    `statut ${saisieParA.status}`,
  );

  const journalParA = await a1("POST", "radar_webhook_log", {
    organization_id: orgs.a.id,
    outcome: "accepted",
  });
  verifie("A1 · n'écrit pas dans le journal des webhooks", refuse(journalParA));

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

  /*
   * Les deux écritures qu'un client aurait intérêt à tenter : se déclarer payé
   * sans l'être, ou inventer un relevé à zéro.
   */
  const payeParA = await a1("PATCH", `radar_statements?id=eq.${releve.id}&select=id`, {
    status: "paye",
    paid_at: new Date().toISOString(),
  });
  verifie("A1 · ne se déclare pas payé", refuse(payeParA), `statut ${payeParA.status}`);

  const baisseParA = await a1("PATCH", `radar_statements?id=eq.${releve.id}&select=id`, {
    commission_cents: 0,
  });
  verifie("A1 · ne remet pas sa commission à zéro", refuse(baisseParA));

  const releveInvente = await a1("POST", "radar_statements", {
    organization_id: orgs.a.id,
    month: "2025-01-01",
    commission_rate: 0,
    window_days: 90,
  });
  verifie("A1 · n'invente pas un relevé", refuse(releveInvente), `statut ${releveInvente.status}`);

  const releveEfface = await a1("DELETE", `radar_statements?id=eq.${releve.id}&select=id`);
  verifie("A1 · ne supprime pas un relevé", refuse(releveEfface));

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
  // --------------------- 10. Le webhook Calendly ---------------------------

  console.log("\n== 10. Le webhook Calendly ==");

  const orgC = await creer("organizations", {
    name: "ZZ QA RC",
    slug: `zz-qa-rc-${marque}`,
  });
  orgs.c = orgC;

  await creer("organization_tools", {
    organization_id: orgC.id,
    tool_id: outilId,
    enabled: true,
  });
  await creer("radar_settings", {
    organization_id: orgC.id,
    window_days: 90,
    currency: "EUR",
    connected_at: new Date().toISOString(),
  });

  // Les canaux du catalogue, ceux que le chantier 3 posera à l'activation.
  for (const canal of CANAUX_PAR_DEFAUT) {
    await creer("radar_channels", { organization_id: orgC.id, ...canal });
  }
  const canaux = Object.fromEntries(
    (
      await srv("GET", `radar_channels?select=id,key&organization_id=eq.${orgC.id}`)
    ).data.map((canal) => [canal.key, canal.id]),
  );

  const CLE_SIGNATURE = "cle-de-signature-de-recette-0123456789abcdef";
  const SEL = "sel-de-recette-fedcba9876543210";
  await srv("POST", "rpc/radar_set_secret", {
    org: orgC.id,
    kind: "signing_key",
    value: CLE_SIGNATURE,
  });
  await srv("POST", "rpc/radar_set_secret", { org: orgC.id, kind: "salt", value: SEL });

  const EMAIL_1 = `camille-${marque}@example.com`;
  const EMAIL_2 = `dominique-${marque}@example.com`;
  const EMAIL_3 = `sacha-${marque}@example.com`;
  const NOM = "Camille Dupont";

  const uri = (suffixe) => `https://api.calendly.com/scheduled_events/zz-${marque}-${suffixe}`;
  const invitee = (suffixe) =>
    `https://api.calendly.com/scheduled_events/zz-${marque}/invitees/${suffixe}`;

  /* Le banc signe de son côté, avec node:crypto : réutiliser la fonction du
   * code éprouvé ne prouverait rien — un bug partagé resterait invisible. */
  const signature = (corps, cle, horodatage) =>
    `t=${horodatage},v1=${createHmac("sha256", cle).update(`${horodatage}.${corps}`).digest("hex")}`;

  const gabarit = (fichier, remplacements = {}) => {
    let texte = readFileSync(
      new URL(`../src/tools/resultats/fixtures/${fichier}`, import.meta.url),
      "utf8",
    );
    for (const [cle, valeur] of Object.entries(remplacements)) {
      texte = texte.split(`{{${cle}}}`).join(valeur);
    }
    return texte;
  };

  const poster = async (
    corps,
    { cle = CLE_SIGNATURE, decalage = 0, entete, org = orgC.id } = {},
  ) => {
    const t = Math.floor(Date.now() / 1000) + decalage;
    const valeur = entete === undefined ? signature(corps, cle, t) : entete;
    const reponse = await fetch(`${BASE}/api/webhooks/calendly/${org}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(valeur === null ? {} : { "Calendly-Webhook-Signature": valeur }),
      },
      body: corps,
    });
    return reponse.status;
  };

  const lignes = async (invitee_uri) =>
    (
      await srv(
        "GET",
        `radar_bookings?select=*&organization_id=eq.${orgC.id}` +
          (invitee_uri ? `&invitee_uri=eq.${encodeURIComponent(invitee_uri)}` : ""),
      )
    ).data;

  const journaux = async () =>
    (
      await srv(
        "GET",
        `radar_webhook_log?select=outcome,event_kind,message,received_at&organization_id=eq.${orgC.id}&order=received_at.asc,id.asc&limit=200`,
      )
    ).data;

  const combien = (liste, outcome) => liste.filter((l) => l.outcome === outcome).length;

  const dans = (n) => new Date(Date.now() + n * 86400000).toISOString();

  // ------------------------- La porte d'entrée ------------------------------

  const u1 = invitee("u1");
  const corpsPaye = gabarit("cree-paye.json", {
    EMAIL: EMAIL_1,
    INVITEE_URI: u1,
    EVENT_URI: uri("e1"),
    START: dans(5),
    END: dans(5),
  });

  verifie(
    "signature fausse → 401",
    (await poster(corpsPaye, { cle: "mauvaise-cle" })) === 401,
  );
  verifie(
    "horodatage vieux de dix minutes → 401",
    (await poster(corpsPaye, { decalage: -600 })) === 401,
  );
  verifie("en-tête de signature absent → 401", (await poster(corpsPaye, { entete: null })) === 401);
  verifie(
    "en-tête mal formé → 401",
    (await poster(corpsPaye, { entete: "n'importe quoi" })) === 401,
  );
  verifie(
    "organisation inconnue → 404",
    (await poster(corpsPaye, { org: crypto.randomUUID() })) === 404,
  );
  verifie(
    "adresse qui n'est pas un identifiant → 404",
    (await poster(corpsPaye, { org: "pas-un-uuid" })) === 404,
  );
  verifie(
    "client sans connexion Calendly → 404",
    (await poster(corpsPaye, { org: orgs.a.id })) === 404,
  );
  verifie(
    "aucun rendez-vous n'a été créé par ces tentatives",
    (await lignes()).length === 0,
    `${(await lignes()).length}`,
  );

  // ---------------------------- Une création --------------------------------

  verifie("création payée → 200", (await poster(corpsPaye)) === 200);

  const creees = await lignes(u1);
  verifie("une ligne, une seule", creees.length === 1, `${creees.length}`);

  const paye = creees[0];
  verifie(
    "attribuée aux annonces par ses utm",
    paye?.channel_id === canaux.google_ads && paye?.attribution === "utm",
    JSON.stringify({ canal: paye?.channel_id, attribution: paye?.attribution }),
  );
  verifie("montant en centimes", paye?.amount_cents === 9000, `${paye?.amount_cents}`);
  verifie("paiement réussi et sa référence", paye?.payment_ok === true && paye?.payment_ref === "ch_3PtestStripe0001", JSON.stringify(paye?.payment_ref));
  verifie("statut confirmé, venu de Calendly", paye?.status === "confirme" && paye?.status_origin === "calendly");
  verifie("réponse déclarée conservée", paye?.declared_source === "Google", JSON.stringify(paye?.declared_source));
  verifie(
    "seuls les utm sont retenus, pas le salesforce_uuid",
    JSON.stringify(Object.keys(paye?.utm ?? {}).sort()) ===
      JSON.stringify(["utm_campaign", "utm_medium", "utm_source"]),
    JSON.stringify(paye?.utm),
  );

  const activitesCreation = (
    await srv("GET", `radar_booking_activities?select=type&booking_id=eq.${paye.id}`)
  ).data;
  verifie(
    "une activité booking.created",
    activitesCreation.length === 1 && activitesCreation[0].type === "booking.created",
    JSON.stringify(activitesCreation),
  );

  const reglagesApres = (
    await srv("GET", `radar_settings?select=last_webhook_at&organization_id=eq.${orgC.id}`)
  ).data[0];
  verifie("last_webhook_at a avancé", Boolean(reglagesApres?.last_webhook_at));

  // ----------------------- Ce qui ne doit pas passer ------------------------

  verifie("le même message rejoué → 200", (await poster(corpsPaye)) === 200);
  verifie("toujours une seule ligne", (await lignes(u1)).length === 1);

  const enveloppeSale = JSON.stringify({
    ...JSON.parse(corpsPaye),
    zz_champ_inattendu: "surprise",
  });
  verifie("champ inattendu dans l'enveloppe → 200", (await poster(enveloppeSale)) === 200);

  const autreEvenement = JSON.stringify({
    ...JSON.parse(corpsPaye),
    event: "invitee_no_show.created",
  });
  verifie("événement d'un autre type → 200", (await poster(autreEvenement)) === 200);

  verifie("JSON illisible → 200", (await poster("{ceci n'est pas du json")) === 200);

  verifie(
    "aucune ligne de plus après ces trois-là",
    (await lignes()).length === 1,
    `${(await lignes()).length}`,
  );

  // -------------------- Gratuit, et paiement échoué -------------------------

  const u2 = invitee("u2");
  verifie(
    "création gratuite → 200",
    (await poster(
      gabarit("cree-gratuit.json", {
        EMAIL: EMAIL_2,
        INVITEE_URI: u2,
        EVENT_URI: uri("e2"),
        START: dans(6),
        END: dans(6),
      }),
    )) === 200,
  );
  const gratuit = (await lignes(u2))[0];
  verifie(
    "une séance gratuite vaut zéro et n'est pas payée",
    gratuit?.amount_cents === 0 && gratuit?.payment_ok === false,
    JSON.stringify({ montant: gratuit?.amount_cents, paye: gratuit?.payment_ok }),
  );
  verifie(
    "sans campagne ni précédent, elle est directe",
    gratuit?.channel_id === canaux.direct && gratuit?.attribution === "direct",
    JSON.stringify({ canal: gratuit?.channel_id, attribution: gratuit?.attribution }),
  );

  const u3 = invitee("u3");
  await poster(
    gabarit("cree-paiement-echoue.json", {
      EMAIL: EMAIL_3,
      INVITEE_URI: u3,
      EVENT_URI: uri("e3"),
      START: dans(7),
      END: dans(7),
    }),
  );
  const echoue = (await lignes(u3))[0];
  verifie(
    "un paiement échoué garde son montant mais n'est pas payé",
    echoue?.amount_cents === 9000 && echoue?.payment_ok === false,
    JSON.stringify({ montant: echoue?.amount_cents, paye: echoue?.payment_ok }),
  );

  // ------------------------------ Annulation --------------------------------

  const corpsAnnule = gabarit("annule.json", {
    EMAIL: EMAIL_1,
    INVITEE_URI: u1,
    EVENT_URI: uri("e1"),
    START: dans(5),
    END: dans(5),
  });
  verifie("annulation → 200", (await poster(corpsAnnule)) === 200);

  const annulee = (await lignes(u1))[0];
  verifie(
    "la séance est annulée, par Calendly",
    annulee?.status === "annule" && annulee?.status_origin === "calendly",
    JSON.stringify({ statut: annulee?.status, origine: annulee?.status_origin }),
  );
  verifie(
    "le motif est une catégorie, pas le texte de la personne",
    annulee?.status_note === "Annulée dans Calendly",
    JSON.stringify(annulee?.status_note),
  );
  verifie("la date d'annulation est posée", Boolean(annulee?.canceled_at));

  const activitesAnnulation = (
    await srv("GET", `radar_booking_activities?select=type&booking_id=eq.${paye.id}&type=eq.booking.canceled`)
  ).data;
  verifie("une activité booking.canceled", activitesAnnulation.length === 1);

  const inconnu = gabarit("annule.json", {
    EMAIL: EMAIL_1,
    INVITEE_URI: invitee("jamais-vu"),
    EVENT_URI: uri("e9"),
    START: dans(5),
    END: dans(5),
  });
  verifie("annulation d'un invité inconnu → 200", (await poster(inconnu)) === 200);

  // ---------------------------- Reprogrammation -----------------------------

  const u4 = invitee("u4");
  verifie(
    "reprogrammation → 200",
    (await poster(
      gabarit("cree-reprogramme.json", {
        EMAIL: EMAIL_1,
        INVITEE_URI: u4,
        EVENT_URI: uri("e4"),
        START: dans(12),
        END: dans(12),
        OLD_INVITEE: u1,
      }),
    )) === 200,
  );

  const deplacee = (await lignes(u4))[0];
  verifie(
    "elle pointe sur celle qu'elle remplace",
    deplacee?.rescheduled_from === paye.id,
    JSON.stringify(deplacee?.rescheduled_from),
  );
  verifie(
    "elle hérite du canal et de l'attribution, sans repasser par le moteur",
    deplacee?.channel_id === canaux.google_ads && deplacee?.attribution === "utm",
    JSON.stringify({ canal: deplacee?.channel_id, attribution: deplacee?.attribution }),
  );
  const activiteDeplacement = (
    await srv("GET", `radar_booking_activities?select=type&booking_id=eq.${deplacee.id}`)
  ).data;
  verifie(
    "une activité booking.rescheduled",
    activiteDeplacement.length === 1 && activiteDeplacement[0].type === "booking.rescheduled",
    JSON.stringify(activiteDeplacement),
  );

  // ------------------------------ Récurrence --------------------------------

  const u5 = invitee("u5");
  await poster(
    gabarit("cree-gratuit.json", {
      EMAIL: EMAIL_1,
      INVITEE_URI: u5,
      EVENT_URI: uri("e5"),
      START: dans(40),
      END: dans(40),
    }),
  );
  const revenue = (await lignes(u5))[0];
  verifie(
    "la même personne qui revient sans annonce garde son canal",
    revenue?.channel_id === canaux.google_ads && revenue?.attribution === "recurrence",
    JSON.stringify({ canal: revenue?.channel_id, attribution: revenue?.attribution }),
  );
  verifie(
    "et sa réponse déclarée diverge sans rien changer au calcul",
    revenue?.declared_source === "Bouche à oreille",
    JSON.stringify(revenue?.declared_source),
  );

  // ------------------------- Le journal, et l'oubli -------------------------

  const journal = await journaux();
  verifie("le journal a compté les signatures refusées", combien(journal, "invalid_signature") === 4, `${combien(journal, "invalid_signature")}`);
  verifie("… les doublons", combien(journal, "duplicate") === 1, `${combien(journal, "duplicate")}`);
  verifie("… les payloads refusés", combien(journal, "invalid_payload") === 2, `${combien(journal, "invalid_payload")}`);
  verifie("… les messages ignorés", combien(journal, "ignored") === 2, `${combien(journal, "ignored")}`);
  verifie("… et les acceptés", combien(journal, "accepted") === 6, `${combien(journal, "accepted")}`);
  verifie("aucune erreur interne", combien(journal, "error") === 0, JSON.stringify(journal.filter((l) => l.outcome === "error")));

  /*
   * Le contrat de Radar, vérifié plutôt que promis.
   *
   * Depuis la phase 7, ce contrat a deux versants et non plus un seul. Le nom
   * de la personne **doit** être en base — sans lui l'outil est inutilisable —
   * mais uniquement sur la ligne du rendez-vous, d'où il partira avec elle.
   * L'email, lui, n'existe toujours nulle part, sous aucune forme.
   *
   * D'où deux périmètres au lieu d'un. Les confondre ferait passer pour un
   * succès le jour où le nom se mettrait à fuir dans le journal.
   */
  const toutesLesLignes = JSON.stringify(await lignes());
  const toutLeJournal = JSON.stringify(journal);
  const activitesToutes = JSON.stringify(
    (await srv("GET", `radar_booking_activities?select=*&organization_id=eq.${orgC.id}`)).data,
  );
  const relevesTous = JSON.stringify(
    (await srv("GET", `radar_statements?select=*&organization_id=eq.${orgC.id}`)).data,
  );

  /** Partout : ce qui n'a le droit d'exister à aucun endroit. */
  const partout = toutesLesLignes + toutLeJournal + activitesToutes + relevesTous;
  /** Hors du rendez-vous : ce que le nom n'a pas le droit de traverser. */
  const horsRendezVous = toutLeJournal + activitesToutes + relevesTous;

  for (const [quoi, valeur] of [
    ["l'email", EMAIL_1],
    ["le deuxième email", EMAIL_2],
    ["le motif écrit à la main", "imprévu de dernière minute"],
    ["le numéro Salesforce", "0031t00000AbCdEf"],
  ]) {
    verifie(`${quoi} n'apparaît nulle part`, !partout.includes(valeur));
  }

  /*
   * L'inversion de la phase 7 : ce contrôle vérifiait l'absence du nom, il
   * vérifie maintenant sa présence — et son confinement.
   *
   * Les fixtures portent `first_name: null`, `last_name: null` et
   * `name: "Camille Dupont"` : c'est donc le repli de la décision 8 qui est
   * éprouvé ici, celui qui découpe le nom complet au premier espace. C'est la
   * forme la plus fragile des deux, et celle qu'un vrai formulaire Calendly en
   * un seul champ nous enverra.
   */
  const [PRENOM, NOM_FAMILLE] = NOM.split(" ");

  verifie(
    "le prénom de la personne est bien en base, sur le rendez-vous",
    (await lignes()).every((l) => l.invitee_first_name === PRENOM),
    JSON.stringify((await lignes()).map((l) => l.invitee_first_name)),
  );
  verifie(
    "… son nom aussi, découpé au premier espace",
    (await lignes()).every((l) => l.invitee_last_name === NOM_FAMILLE),
    JSON.stringify((await lignes()).map((l) => l.invitee_last_name)),
  );
  verifie(
    "… et il ne sort pas du rendez-vous : ni journal, ni activités, ni relevés",
    !horsRendezVous.includes(PRENOM) && !horsRendezVous.includes(NOM_FAMILLE),
  );

  const vueNommee = (
    await srv(
      "GET",
      `radar_bookings_effective?select=invitee_display&organization_id=eq.${orgC.id}&limit=1`,
    )
  ).data[0];
  verifie(
    "la vue abrège le nom pour les listes",
    vueNommee?.invitee_display === `${PRENOM} ${NOM_FAMILLE[0]}.`,
    JSON.stringify(vueNommee),
  );

  verifie(
    "la clé d'invité est bien un HMAC, la même pour la même personne",
    revenue?.invitee_key === deplacee?.invitee_key &&
      /^[0-9a-f]{64}$/.test(revenue?.invitee_key ?? ""),
    JSON.stringify(revenue?.invitee_key),
  );
  verifie(
    "deux personnes différentes ont deux clés différentes",
    gratuit?.invitee_key !== revenue?.invitee_key,
  );

  // ------------------- Le relevé des champs de Calendly ---------------------

  const accepte = (await journaux()).filter((l) => l.outcome === "accepted");
  // Celui de la séance payée : on le désigne par son contenu, pas par son rang.
  const releveChamps =
    accepte.find((l) => (l.message ?? "").includes("payment : amount"))?.message ?? "";

  verifie(
    "un appel accepté relève les champs reçus",
    releveChamps.includes("tracking :") && releveChamps.includes("payment :"),
    JSON.stringify(releveChamps),
  );
  verifie(
    "les noms de champs du tracking y sont, renseignés et vides séparés",
    releveChamps.includes("utm_medium") &&
      releveChamps.includes("utm_source") &&
      releveChamps.includes("vides :") &&
      releveChamps.includes("utm_term"),
    JSON.stringify(releveChamps),
  );
  verifie(
    "salesforce_uuid est relevé comme présent, sans sa valeur",
    releveChamps.includes("salesforce_uuid"),
    JSON.stringify(releveChamps),
  );
  verifie(
    "les champs de paiement y sont",
    releveChamps.includes("external_id") && releveChamps.includes("successful") && releveChamps.includes("amount"),
    JSON.stringify(releveChamps),
  );

  /*
   * Le point qui compte : ce relevé nomme des champs, il n'en montre aucune
   * valeur. Le journal doit rester lisible par Louis sans porter la moindre
   * donnée du client de son client.
   */
  const tousLesReleves = accepte.map((l) => l.message ?? "").join(" ");
  for (const [quoi, valeur] of [
    ["la source", "google"],
    ["le medium", "cpc"],
    ["la campagne", "lancement-printemps"],
    ["la référence Stripe", "ch_3PtestStripe"],
    ["le numéro Salesforce", "0031t00000AbCdEf"],
    ["le montant", "90"],
    ["la devise", "EUR"],
  ]) {
    verifie(`${quoi} n'apparaît pas dans le relevé`, !tousLesReleves.includes(valeur));
  }

  verifie(
    "une séance gratuite relève un paiement absent",
    accepte.some((l) => (l.message ?? "").includes("payment : absent")),
    JSON.stringify(accepte.map((l) => l.message)),
  );

  // Au-delà de cinquante appels acceptés, le relevé s'arrête : on sait ce que
  // ce client envoie, et le journal n'a pas à le répéter pour toujours.
  const dejaAcceptes = accepte.length;
  const bouchon = [];
  for (let n = dejaAcceptes; n < 49; n += 1) {
    bouchon.push({
      organization_id: orgC.id,
      outcome: "accepted",
      event_kind: "invitee.created",
      message: "bouchon",
    });
  }
  if (bouchon.length > 0) await srv("POST", "radar_webhook_log", bouchon);

  const u6 = invitee("u6");
  await poster(
    gabarit("cree-paye.json", {
      EMAIL: `dernier-${marque}@example.com`,
      INVITEE_URI: u6,
      EVENT_URI: uri("e6"),
      START: dans(50),
      END: dans(50),
    }),
  );
  const cinquantieme = (await journaux())
    .filter((l) => l.outcome === "accepted" && l.message !== "bouchon")
    .at(-1);
  verifie(
    "le cinquantième appel relève encore",
    (cinquantieme?.message ?? "").includes("tracking :"),
    JSON.stringify(cinquantieme?.message),
  );

  const u7 = invitee("u7");
  await poster(
    gabarit("cree-paye.json", {
      EMAIL: `apres-${marque}@example.com`,
      INVITEE_URI: u7,
      EVENT_URI: uri("e7"),
      START: dans(55),
      END: dans(55),
    }),
  );
  const rdvApresCinquante = (await lignes(u7))[0];
  const journalApres = (await journaux()).filter(
    (l) => l.outcome === "accepted" && l.message !== "bouchon",
  );
  verifie(
    "le cinquante-et-unième n'apprend plus rien et ne relève plus",
    journalApres.at(-1)?.message === null,
    JSON.stringify(journalApres.at(-1)),
  );
  verifie(
    "… mais le rendez-vous est bien enregistré",
    Boolean(rdvApresCinquante?.id),
    JSON.stringify(rdvApresCinquante?.id),
  );


  // ---------------------------- 11. Les purges ------------------------------

  console.log("\n== 11. Les purges ==");

  /*
   * Un ménage se juge à ce qu'il laisse autant qu'à ce qu'il emporte. On pose
   * donc les deux : ce qui doit partir, et ce qui doit rester à côté.
   */
  const ilYA = (jours) => new Date(Date.now() - jours * 86400000).toISOString();

  await srv("POST", "radar_webhook_log", [
    { organization_id: orgC.id, outcome: "accepted", received_at: ilYA(120) },
    { organization_id: orgC.id, outcome: "accepted", received_at: ilYA(95) },
    { organization_id: orgC.id, outcome: "accepted", received_at: ilYA(80) },
  ]);

  const avantJournal = (
    await srv("GET", `radar_webhook_log?select=id&organization_id=eq.${orgC.id}&limit=500`)
  ).data.length;

  const purgeJournal = await srv("POST", "rpc/radar_purger_journal", {});
  verifie(
    "le journal purge les lignes de plus de quatre-vingt-dix jours",
    Number(purgeJournal.data) === 2,
    `${purgeJournal.data} ligne(s) effacée(s)`,
  );

  const restants = (
    await srv(
      "GET",
      `radar_webhook_log?select=received_at&organization_id=eq.${orgC.id}&limit=500`,
    )
  ).data;
  verifie(
    "… et laisse tout le reste",
    restants.length === avantJournal - 2,
    `${avantJournal} avant, ${restants.length} après`,
  );
  verifie(
    "aucune ligne de plus de quatre-vingt-dix jours ne subsiste",
    restants.every((l) => Date.parse(l.received_at) > Date.now() - 90 * 86400000),
  );

  // Trois relevés : un payé et vieux, un payé mais récent, un contesté et vieux.
  const relevePaye = await creer("radar_statements", {
    organization_id: orgC.id,
    month: "2024-01-01",
    status: "paye",
    commission_rate: 20,
    window_days: 90,
    closed_at: ilYA(500),
  });
  const releveRecent = await creer("radar_statements", {
    organization_id: orgC.id,
    month: "2026-01-01",
    status: "paye",
    commission_rate: 20,
    window_days: 90,
    closed_at: ilYA(60),
  });
  const releveConteste = await creer("radar_statements", {
    organization_id: orgC.id,
    month: "2024-02-01",
    status: "conteste",
    commission_rate: 20,
    window_days: 90,
    closed_at: ilYA(500),
  });

  const rdvDe = async (releve, suffixe) =>
    creer("radar_bookings", {
      organization_id: orgC.id,
      invitee_uri: `https://api.calendly.com/invitees/purge-${marque}-${suffixe}`,
      event_uri: `https://api.calendly.com/events/purge-${suffixe}`,
      invitee_key: "cle-de-purge",
      scheduled_start: ilYA(500),
      scheduled_end: ilYA(500),
      event_type_name: "Séance ancienne",
      statement_id: releve.id,
    });

  const aPurger = await rdvDe(relevePaye, "vieux");
  const aGarderRecent = await rdvDe(releveRecent, "recent");
  const aGarderConteste = await rdvDe(releveConteste, "conteste");
  const aGarderLibre = await creer("radar_bookings", {
    organization_id: orgC.id,
    invitee_uri: `https://api.calendly.com/invitees/purge-${marque}-libre`,
    event_uri: "https://api.calendly.com/events/purge-libre",
    invitee_key: "cle-de-purge",
    scheduled_start: ilYA(500),
    scheduled_end: ilYA(500),
    event_type_name: "Séance sans relevé",
  });

  const purgeRdv = await srv("POST", "rpc/radar_purger_rendezvous", {});
  verifie(
    "un rendez-vous d'un relevé payé depuis plus de treize mois est purgé",
    Number(purgeRdv.data) === 1,
    `${purgeRdv.data} ligne(s) effacée(s)`,
  );

  const survivants = (
    await srv(
      "GET",
      `radar_bookings?select=id,event_type_name&organization_id=eq.${orgC.id}&invitee_key=eq.cle-de-purge`,
    )
  ).data.map((l) => l.id);

  verifie("… celui-là précisément", !survivants.includes(aPurger.id));
  verifie(
    "un relevé payé mais récent garde ses lignes",
    survivants.includes(aGarderRecent.id),
  );
  verifie(
    "un relevé contesté garde les siennes, si vieux soit-il",
    survivants.includes(aGarderConteste.id),
  );
  verifie(
    "un rendez-vous sans relevé n'est jamais purgé",
    survivants.includes(aGarderLibre.id),
  );

  const relevesApres = (
    await srv("GET", `radar_statements?select=id&organization_id=eq.${orgC.id}`)
  ).data;
  verifie(
    "les relevés, eux, restent : c'est la trace comptable",
    relevesApres.length === 3,
    `${relevesApres.length} relevé(s)`,
  );

  const purgeMembre = await a1("POST", "rpc/radar_purger_journal", {});
  verifie(
    "un membre ne déclenche aucune purge",
    refuse(purgeMembre),
    `statut ${purgeMembre.status} ${motif(purgeMembre)}`,
  );


  // ======================================================================
  //  12. La phase 7 : la vente, le mode, et le relevé qui en découle
  // ======================================================================
  console.log("\n== 12. La vente et le mode ventes ==");

  /*
   * Un client à part, en mode `ventes`, avec un mois volontairement mixte :
   * une séance de juillet vendue en août, une séance d'août vendue en août,
   * une honorée sans vente, une vendue le mois suivant, et une vente sur un
   * canal hors Comète. C'est l'ensemble des cas que la clôture doit trier.
   */
  const orgV = await creer("organizations", {
    name: "ZZ QA RV",
    slug: `zz-qa-rv-${marque}`,
  });
  orgs.v = orgV;

  comptes.v1 = await creerCompte(`zz-qa-r4-${marque}@comete-qa.test`);
  await creer("memberships", { organization_id: orgV.id, user_id: comptes.v1, role: "owner" });
  await creer("organization_tools", { organization_id: orgV.id, tool_id: outilId, enabled: true });
  await creer("radar_settings", {
    organization_id: orgV.id,
    commission_rate: 20,
    window_days: 90,
    commission_basis: "ventes",
  });

  const cometeV = await creer("radar_channels", {
    organization_id: orgV.id, key: "google_ads", label: "Google Ads", is_comete: true, sort_order: 10,
  });
  const horsV = await creer("radar_channels", {
    organization_id: orgV.id, key: "direct", label: "Direct", is_comete: false, sort_order: 90,
  });

  const v1 = par(await connecter(`zz-qa-r4-${marque}@comete-qa.test`));

  const rdvV = (attributs) =>
    creer("radar_bookings", {
      organization_id: orgV.id,
      invitee_uri: `https://api.calendly.com/invitees/${crypto.randomUUID()}`,
      event_uri: `https://api.calendly.com/events/${crypto.randomUUID()}`,
      invitee_key: `cle-v-${crypto.randomUUID()}`,
      event_type_name: "Diagnostic offert",
      currency: "EUR",
      channel_id: cometeV.id,
      invitee_first_name: "Camille",
      invitee_last_name: "Dupont",
      ...attributs,
    });

  const vJuillet = await rdvV({
    scheduled_start: "2026-07-20T08:00:00Z", scheduled_end: "2026-07-20T09:00:00Z",
    sale_amount_cents: 120000, sale_date: "2026-08-05", sale_note: "pack confidentiel",
  });
  const vAout = await rdvV({
    scheduled_start: "2026-08-10T08:00:00Z", scheduled_end: "2026-08-10T09:00:00Z",
    sale_amount_cents: 80000, sale_date: "2026-08-20",
  });
  const vSansVente = await rdvV({
    scheduled_start: "2026-08-12T08:00:00Z", scheduled_end: "2026-08-12T09:00:00Z",
  });
  const vAilleurs = await rdvV({
    scheduled_start: "2026-08-14T08:00:00Z", scheduled_end: "2026-08-14T09:00:00Z",
    sale_amount_cents: 50000, sale_date: "2026-09-02",
  });
  const vHorsCanal = await rdvV({
    scheduled_start: "2026-08-16T08:00:00Z", scheduled_end: "2026-08-16T09:00:00Z",
    channel_id: horsV.id, sale_amount_cents: 50000, sale_date: "2026-08-18",
  });

  // ------------------------------ radar_set_sale ---------------------------

  /*
   * Volontairement hors du mois mixte clôturé plus bas : cette séance sert aux
   * gardes de `radar_set_sale`, et si elle tombait en août elle s'ajouterait
   * aux lignes du relevé qu'on y compte.
   */
  const aVendre = await rdvV({
    scheduled_start: jours(-45), scheduled_end: jours(-45),
  });

  const aujourdHui = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(),
  );

  const posee = await v1("POST", "rpc/radar_set_sale", {
    booking_id: aVendre.id, amount_cents: 45000, sale_date: aujourdHui, note: "pack 3 séances",
  });
  verifie("le membre déclare une vente", posee.status < 300, motif(posee));

  const apresVente = (
    await srv("GET", `radar_bookings?select=sale_amount_cents,sale_recorded_by,sale_note&id=eq.${aVendre.id}`)
  ).data[0];
  verifie("… le montant est en base", apresVente.sale_amount_cents === 45000);
  verifie("… signée de son auteur", apresVente.sale_recorded_by === comptes.v1);

  const acteVente = (
    await srv("GET", `radar_booking_activities?select=type,payload&booking_id=eq.${aVendre.id}&order=created_at.desc`)
  ).data[0];
  verifie("… et journalisée", acteVente?.type === "sale.recorded");
  verifie(
    "… sans recopier la note, que la purge d'identité ne toucherait pas",
    !JSON.stringify(acteVente?.payload).includes("pack 3 séances") &&
      acteVente?.payload?.note_presente === true,
    JSON.stringify(acteVente?.payload),
  );

  const venteChezB = await b1("POST", "rpc/radar_set_sale", {
    booking_id: aVendre.id, amount_cents: 1000, sale_date: aujourdHui,
  });
  verifie(
    "B ne déclare pas de vente chez V",
    venteChezB.status >= 400 && motif(venteChezB).includes("accessible"),
    motif(venteChezB),
  );

  const jourFutur = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(Date.now() + 3 * 86400000),
  );
  const dansLeFutur = await v1("POST", "rpc/radar_set_sale", {
    booking_id: aVendre.id, amount_cents: 1000, sale_date: jourFutur,
  });
  verifie("une vente ne se date pas dans le jourFutur", refuse(dansLeFutur), motif(dansLeFutur));

  const avantSeance = await v1("POST", "rpc/radar_set_sale", {
    booking_id: aVendre.id, amount_cents: 1000, sale_date: "2020-01-01",
  });
  verifie("… ni avant le rendez-vous", refuse(avantSeance), motif(avantSeance));

  /*
   * Une séance à venir n'a aucune date de vente possible : toute date après
   * elle est dans le futur, toute date avant elle précède le rendez-vous. Les
   * deux bornes de `radar_set_sale` se referment l'une sur l'autre, et c'est
   * pour ça que l'écran ne propose plus rien — il affiche « La vente pourra
   * être déclarée après la séance » au lieu d'un formulaire impossible à
   * remplir. Le banc éprouve le versant base de cette règle.
   */
  const aVenir = await rdvV({
    scheduled_start: jours(15), scheduled_end: jours(15),
  });

  const jourDeLaSeance = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(Date.now() + 15 * 86400000),
  );

  const venteAujourdHui = await v1("POST", "rpc/radar_set_sale", {
    booking_id: aVenir.id, amount_cents: 1000, sale_date: aujourdHui,
  });
  verifie(
    "une séance à venir refuse une vente datée d'aujourd'hui",
    venteAujourdHui.status >= 400 && motif(venteAujourdHui).includes("précède"),
    motif(venteAujourdHui),
  );

  const venteLeJourJ = await v1("POST", "rpc/radar_set_sale", {
    booking_id: aVenir.id, amount_cents: 1000, sale_date: jourDeLaSeance,
  });
  verifie(
    "… et une vente datée du jour de la séance, qui est dans le futur",
    venteLeJourJ.status >= 400 && motif(venteLeJourJ).includes("futur"),
    motif(venteLeJourJ),
  );

  verifie(
    "… si bien qu'aucune vente n'est possible avant qu'elle ait lieu",
    (await srv("GET", `radar_bookings?select=sale_amount_cents&id=eq.${aVenir.id}`)).data[0]
      .sale_amount_cents === null,
  );

  const annuleAvecVente = await v1("POST", "rpc/radar_client_set_status", {
    booking_id: aVendre.id, new_status: "annule",
  });
  verifie(
    "une séance vendue ne s'annule pas",
    annuleAvecVente.status >= 400 && motif(annuleAvecVente).includes("Retire-la d'abord"),
    motif(annuleAvecVente),
  );

  const refusApresVente = await v1("POST", "rpc/radar_decline_sale", { booking_id: aVendre.id });
  verifie("… et ne se dit pas « sans vente »", refuse(refusApresVente), motif(refusApresVente));

  const retiree = await v1("POST", "rpc/radar_set_sale", { booking_id: aVendre.id });
  verifie("la vente se retire", retiree.status < 300, motif(retiree));
  verifie(
    "… tout revient à nul",
    (await srv("GET", `radar_bookings?select=sale_amount_cents,sale_date,sale_note,sale_recorded_by&id=eq.${aVendre.id}`))
      .data[0].sale_amount_cents === null,
  );

  const refuse1 = await v1("POST", "rpc/radar_decline_sale", { booking_id: aVendre.id });
  const refuse2 = await v1("POST", "rpc/radar_decline_sale", { booking_id: aVendre.id });
  verifie("« pas de vente » se dit une fois", refuse1.data === true && refuse2.data === false);
  verifie(
    "… sans inventer une vente à zéro euro",
    (await srv("GET", `radar_bookings?select=sale_amount_cents&id=eq.${aVendre.id}`)).data[0]
      .sale_amount_cents === null,
  );

  // --------------------------- Le mois mixte -------------------------------

  const COLONNES_RELEVE =
    "id,scheduled_start,event_type_name,channel_id,effective_status,counts_for_commission,amount_cents,currency,payment_ok,sale_amount_cents,sale_date,has_sale";

  const seancesAout = (
    await srv("GET", `radar_bookings_effective?select=${COLONNES_RELEVE}&organization_id=eq.${orgV.id}&mois=eq.2026-08-01`)
  ).data;
  const ventesAout = (
    await srv("GET", `radar_bookings_effective?select=${COLONNES_RELEVE}&organization_id=eq.${orgV.id}&commission_month=eq.2026-08-01&sale_amount_cents=not.is.null`)
  ).data;
  const canauxV = (
    await srv("GET", `radar_channels?select=id,label,is_comete&organization_id=eq.${orgV.id}`)
  ).data;

  verifie("les ventes d'août incluent la séance de juillet", ventesAout.some((v) => v.id === vJuillet.id));
  verifie("… et excluent celle vendue en septembre", !ventesAout.some((v) => v.id === vAilleurs.id));

  const lignesV = construireLignesVentes(ventesAout, seancesAout, canauxV);
  const totalV = totaux(lignesV, 20);

  verifie("le relevé d'août porte cinq lignes", lignesV.length === 5, `${lignesV.length}`);
  verifie(
    "… la base ne compte que les ventes sur canal Comète",
    totalV.base_cents === 200000,
    JSON.stringify(totalV),
  );
  verifie("… la commission suit le taux", totalV.commission_cents === 40000);
  verifie(
    "… la vente de juillet porte ses deux dates",
    lignesV.find((l) => l.id === vJuillet.id)?.date_vente === "2026-08-05",
  );
  verifie(
    "… la séance sans vente le dit",
    lignesV.find((l) => l.id === vSansVente.id)?.raison === "Pas de vente déclarée",
  );
  verifie(
    "… celle vendue en septembre renvoie à son relevé",
    lignesV.find((l) => l.id === vAilleurs.id)?.raison ===
      "Vendue en septembre, facturée sur le relevé de septembre",
    JSON.stringify(lignesV.find((l) => l.id === vAilleurs.id)?.raison),
  );
  verifie(
    "… et celle hors Comète dit son canal",
    lignesV.find((l) => l.id === vHorsCanal.id)?.raison === "Canal hors Comète : Direct",
  );

  const corpsReleve = JSON.stringify(lignesV) + versCsv(lignesV, "ventes");
  for (const [quoi, valeur] of [
    ["le prénom", "Camille"],
    ["le nom", "Dupont"],
    ["la note de vente", "pack confidentiel"],
    ["la clé d'invité", "cle-v-"],
  ]) {
    verifie(`${quoi} n'entre ni dans le relevé ni dans son CSV`, !corpsReleve.includes(valeur));
  }

  verifie(
    "le CSV en mode ventes porte la date de vente",
    versCsv(lignesV, "ventes").split("\r\n")[0] ===
      "Date;Date de vente;Séance;Canal;Statut;Montant;Comptée;Raison",
  );

  // ------------------- Un client en encaissement ne bouge pas --------------

  const lignesEncaissement = construireLignes(seancesAout, canauxV);
  verifie(
    "en encaissement, ces mêmes séances ne facturent rien",
    totaux(lignesEncaissement, 20).base_cents === 0,
    JSON.stringify(totaux(lignesEncaissement, 20)),
  );
  verifie(
    "… et le CSV reste celui d'avant la phase 7",
    versCsv(lignesEncaissement).split("\r\n")[0] ===
      "Date;Séance;Canal;Statut;Montant;Comptée;Raison",
  );

  // ------------------------- Le verrou du relevé ---------------------------

  const releveAout = await creer("radar_statements", {
    organization_id: orgV.id, month: "2026-08-01", commission_rate: 20, window_days: 90,
    commission_basis: "ventes", base_cents: totalV.base_cents,
    commission_cents: totalV.commission_cents, lines: lignesV,
  });

  verifie("le relevé retient sa base de commission", releveAout.commission_basis === "ventes");

  const venteVerrouillee = await v1("POST", "rpc/radar_set_sale", {
    booking_id: vAout.id, amount_cents: 99000, sale_date: "2026-08-21",
  });
  verifie(
    "une vente d'un mois clôturé ne change plus",
    venteVerrouillee.status >= 400 && motif(venteVerrouillee).includes("clôturé"),
    motif(venteVerrouillee),
  );

  const retraitVerrouille = await v1("POST", "rpc/radar_set_sale", { booking_id: vAout.id });
  verifie("… ni ne se retire", refuse(retraitVerrouille), motif(retraitVerrouille));

  // --------------------- La bascule de mode et son garde-fou ---------------

  const ouverts = (
    await srv("GET", `radar_statements?select=month,status&organization_id=eq.${orgV.id}&status=neq.paye&order=month`)
  ).data;
  verifie("un relevé non réglé est vu", ouverts.length === 1, JSON.stringify(ouverts));
  verifie("… et la bascule de mode est refusée", peutChangerDeBase(ouverts).ok === false);

  await srv("PATCH", `radar_statements?id=eq.${releveAout.id}`, {
    status: "paye", paid_at: new Date().toISOString(),
  });
  const apresReglement = (
    await srv("GET", `radar_statements?select=month,status&organization_id=eq.${orgV.id}&status=neq.paye`)
  ).data;
  verifie("une fois réglé, la bascule est permise", peutChangerDeBase(apresReglement).ok === true);

  // -------------------- Le journal des réglages est à Louis ----------------

  await creer("radar_settings_log", {
    organization_id: orgV.id, user_id: comptes.v1, type: "basis.changed",
    payload: { base_avant: "encaissement", base_apres: "ventes" },
  });
  verifie(
    "le membre ne lit pas le journal des réglages",
    vide(await v1("GET", `radar_settings_log?select=id&organization_id=eq.${orgV.id}`)),
  );
  verifie(
    "… ni n'y écrit",
    refuse(await v1("POST", "radar_settings_log?select=id", {
      organization_id: orgV.id, type: "basis.changed", payload: {},
    })),
  );
  verifie(
    "… mais il lit sa propre base de commission",
    (await v1("GET", `radar_settings?select=commission_basis&organization_id=eq.${orgV.id}`))
      .data[0]?.commission_basis === "ventes",
  );

  // ------------------- Annulée et non venue, jamais additionnées ------------

  /*
   * Aucun contrôle du banc ne les sommait — la seule addition vivait dans
   * `bilan()`, sous le libellé « annulés ou non venus ». Ces vérifications
   * posent le garde-fou qui manquait : sur un mois qui porte les deux, la vue
   * doit rendre deux comptes de un, et non un compte de deux.
   */
  const uneAnnulee = await rdvV({
    scheduled_start: "2026-08-22T08:00:00Z", scheduled_end: "2026-08-22T09:00:00Z",
    status: "annule", status_origin: "calendly",
  });
  const uneNonVenue = await rdvV({
    scheduled_start: "2026-08-24T08:00:00Z", scheduled_end: "2026-08-24T09:00:00Z",
    status: "no_show", status_origin: "client",
  });

  const aout = (
    await srv("GET", `radar_bookings_effective?select=id,effective_status&organization_id=eq.${orgV.id}&mois=eq.2026-08-01`)
  ).data;

  const compte = (statut) => aout.filter((l) => l.effective_status === statut).length;

  verifie("une annulée se compte seule", compte("annule") === 1, `${compte("annule")}`);
  verifie("une non venue aussi", compte("no_show") === 1, `${compte("no_show")}`);
  verifie(
    "… et rien ne les additionne : deux comptes de un, pas un compte de deux",
    compte("annule") + compte("no_show") === 2 && compte("annule") !== 2 && compte("no_show") !== 2,
  );
  verifie(
    "la vue les distingue au statut brut aussi",
    aout.find((l) => l.id === uneAnnulee.id)?.effective_status === "annule" &&
      aout.find((l) => l.id === uneNonVenue.id)?.effective_status === "no_show",
  );

  const relevePerdues = construireLignes(
    (
      await srv("GET", `radar_bookings_effective?select=${COLONNES_RELEVE}&organization_id=eq.${orgV.id}&mois=eq.2026-08-01`)
    ).data.filter((l) => [uneAnnulee.id, uneNonVenue.id].includes(l.id)),
    canauxV,
  );
  verifie(
    "le relevé donne deux raisons différentes",
    new Set(relevePerdues.map((l) => l.raison)).size === 2 &&
      relevePerdues.some((l) => l.raison === "Séance annulée") &&
      relevePerdues.some((l) => l.raison === "Personne n'est venue"),
    JSON.stringify(relevePerdues.map((l) => l.raison)),
  );

  // ------------------------ La purge de l'identité -------------------------
  console.log("\n== 13. L'oubli de l'identité ==");

  const vieuxSansVente = await rdvV({
    scheduled_start: jours(-220), scheduled_end: jours(-220),
    invitee_first_name: "Alex", invitee_last_name: "Ancien",
  });
  const vieuxAvecVente = await rdvV({
    scheduled_start: jours(-220), scheduled_end: jours(-220),
    invitee_first_name: "Rene", invitee_last_name: "Vendu",
    sale_amount_cents: 50000, sale_date: "2026-03-01",
  });
  const tresVieux = await rdvV({
    scheduled_start: jours(-430), scheduled_end: jours(-430),
    invitee_first_name: "Yann", invitee_last_name: "Tresvieux",
    sale_amount_cents: 50000, sale_date: "2025-08-01",
  });
  const recent = await rdvV({
    scheduled_start: jours(-5), scheduled_end: jours(-5),
    invitee_first_name: "Neuve", invitee_last_name: "Recente",
  });

  const purge = await srv("POST", "rpc/radar_purger_identite", {});
  verifie("la purge rend un compte", typeof purge.data === "number", JSON.stringify(purge.data));

  const nomDe = async (id) =>
    (await srv("GET", `radar_bookings?select=invitee_first_name&id=eq.${id}`)).data[0]
      .invitee_first_name;

  verifie("sans vente, sept mois : le nom part", (await nomDe(vieuxSansVente.id)) === "");
  verifie("avec vente, sept mois : le nom reste", (await nomDe(vieuxAvecVente.id)) === "Rene");
  verifie("avec vente, quatorze mois : le nom part", (await nomDe(tresVieux.id)) === "");
  verifie("une séance récente n'est pas touchée", (await nomDe(recent.id)) === "Neuve");
  verifie(
    "rejouée, la purge n'efface plus rien",
    (await srv("POST", "rpc/radar_purger_identite", {})).data === 0,
  );
  verifie(
    "un membre ne déclenche pas la purge d'identité",
    refuse(await v1("POST", "rpc/radar_purger_identite", {})),
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
