/**
 * Banc de la route d'export de Radar (phase 7, chantier inséré).
 *
 *   npx next start -p 3100   (dans un autre terminal)
 *   npm run qa:export
 *
 * Une route qui **sort** des données vers un tiers. Ce banc éprouve donc trois
 * choses dans cet ordre d'importance :
 *
 *   1. Le cloisonnement. Un jeton lit son organisation, et rien d'autre. On ne
 *      le vérifie pas en lisant le code mais en donnant le jeton de B et en
 *      cherchant, dans le corps rendu, les identifiants de A.
 *   2. Le silence sur les personnes. On cherche les noms et les clés d'invité
 *      des lignes de recette dans la réponse, plutôt que de relire la liste
 *      blanche — une liste se relit mal, un `grep` ne se trompe pas. Le même
 *      `grep` couvre la colonne `utm` : quatre de ses champs sortent à plat,
 *      le `utm_term` et l'identifiant de clic restent à la maison.
 *   3. La stabilité de la pagination, avec des insertions entre deux pages, et
 *      cent rendez-vous par horodatage pour que les frontières de page tombent
 *      au milieu d'une égalité.
 */
import { createHash } from "node:crypto";

import {
  annoncerCible,
  creer,
  journal,
  srv,
} from "./qa-commun.mjs";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:3100";
const ROUTE = `${BASE}/api/export/radar/rendez-vous`;

const { verifie, bilan } = journal();
annoncerCible(`QA — export Radar\nServeur visé : ${BASE}`);

if (!(await fetch(BASE, { redirect: "manual" }).catch(() => null))) {
  console.error(
    `${BASE} ne répond pas. Lance d'abord \`npm run build\`, puis \`npx next start -p 3100\`.`,
  );
  process.exit(1);
}

const marque = Math.random().toString(36).slice(2, 8);
const orgs = {};

/** Les valeurs qui ne doivent jamais apparaître dans une réponse. */
const NOM = "Camille";
const PRENOM_B = "Sacha";
const FAMILLE = "Dupont-Sorel";
const CLE_INVITE = `cle-secrete-${marque}`;
const NOTE_VENTE = `pack confidentiel ${marque}`;
const UTM_TERME = `terme-secret-${marque}`;
const GCLID = `clic-secret-${marque}`;

/**
 * Ce qu'une landing taguée dépose dans la colonne `utm`.
 *
 * Six champs, dont quatre sortent. Les deux autres sont là pour ça : ils
 * prouvent que la liste blanche est bien nommée champ par champ, et non
 * « l'objet `utm` moins ce qu'on n'aime pas » — la seule différence entre les
 * deux se voit le jour où une campagne colle un paramètre inattendu au lien.
 */
const UTM = {
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: `campagne-${marque}`,
  utm_content: `annonce-${marque}`,
  utm_term: UTM_TERME,
  gclid: GCLID,
};

const jetonClair = (suffixe) =>
  createHash("sha256").update(`graine-${marque}-${suffixe}`).digest("hex");
const empreinte = (jeton) => createHash("sha256").update(jeton).digest("hex");

const appel = (jeton, requete) =>
  fetch(`${ROUTE}${requete}`, {
    headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
  });

/** L'état des tables du client, pour prouver qu'aucune écriture n'a lieu. */
async function empreinteBase(orgId) {
  const tables = [
    `radar_bookings?select=id,status,updated_at,sale_amount_cents&organization_id=eq.${orgId}&order=id`,
    `radar_booking_activities?select=id,type&organization_id=eq.${orgId}&order=id`,
    `radar_channels?select=id,key,label&organization_id=eq.${orgId}&order=id`,
    `radar_settings?select=*&organization_id=eq.${orgId}`,
    `radar_statements?select=id,status&organization_id=eq.${orgId}&order=id`,
    // Le jeton, sans `last_used_at` : c'est la seule écriture permise.
    `radar_export_tokens?select=id,label,token_hash,revoked_at&organization_id=eq.${orgId}&order=id`,
  ];

  const morceaux = [];
  for (const table of tables) morceaux.push(JSON.stringify((await srv("GET", table)).data));
  return createHash("sha256").update(morceaux.join("|")).digest("hex");
}

try {
  // --------------------------------- Décor ---------------------------------

  orgs.a = await creer("organizations", { name: "ZZ QA EXA", slug: `zz-qa-exa-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA EXB", slug: `zz-qa-exb-${marque}` });

  const outilId = (await srv("GET", "tools?select=id&slug=eq.resultats")).data[0].id;
  for (const org of [orgs.a, orgs.b]) {
    await creer("organization_tools", { organization_id: org.id, tool_id: outilId, enabled: true });
    await creer("radar_settings", { organization_id: org.id, commission_rate: 20, window_days: 90 });
  }

  const canalA = await creer("radar_channels", {
    organization_id: orgs.a.id, key: "google_ads", label: "Google Ads", is_comete: true, sort_order: 10,
  });
  const canalB = await creer("radar_channels", {
    organization_id: orgs.b.id, key: "meta", label: "Meta", is_comete: true, sort_order: 10,
  });

  const JETON_A = jetonClair("a");
  const JETON_B = jetonClair("b");
  const JETON_MORT = jetonClair("mort");

  await creer("radar_export_tokens", {
    organization_id: orgs.a.id, token_hash: empreinte(JETON_A), label: "Rapport A",
  });
  await creer("radar_export_tokens", {
    organization_id: orgs.b.id, token_hash: empreinte(JETON_B), label: "Rapport B",
  });
  const mort = await creer("radar_export_tokens", {
    organization_id: orgs.a.id, token_hash: empreinte(JETON_MORT), label: "Rapport révoqué",
    revoked_at: new Date().toISOString(),
  });

  /*
   * Onze horodatages, cent rendez-vous chacun : les frontières de page
   * tombent ainsi au milieu d'une égalité de `scheduled_start`, là où une
   * pagination qui ne trierait que sur la date perdrait ou doublerait des
   * lignes.
   */
  const JOUR_ZERO = Date.parse("2026-04-01T09:00:00Z");
  const instant = (n) => new Date(JOUR_ZERO + (n % 11) * 86_400_000).toISOString();

  const rendezVous = (n, extra = {}) => ({
    organization_id: orgs.a.id,
    invitee_uri: `https://api.calendly.com/invitees/zz-${marque}-${String(n).padStart(5, "0")}`,
    event_uri: `https://api.calendly.com/events/zz-${marque}-${n}`,
    invitee_key: CLE_INVITE,
    event_type_name: "Diagnostic offert",
    scheduled_start: instant(n),
    scheduled_end: instant(n),
    channel_id: canalA.id,
    currency: "EUR",
    invitee_first_name: NOM,
    invitee_last_name: FAMILLE,
    ...extra,
  });

  const TOTAL = 1100;
  for (let debut = 0; debut < TOTAL; debut += 250) {
    const lot = [];
    for (let n = debut; n < Math.min(debut + 250, TOTAL); n += 1) lot.push(rendezVous(n));
    const pose = await srv("POST", "radar_bookings", lot);
    if (pose.status >= 300) throw new Error(`insertion : ${JSON.stringify(pose.data)}`);
  }

  // Une vente, pour vérifier que ses champs sortent et que sa note reste.
  await srv(
    "PATCH",
    `radar_bookings?organization_id=eq.${orgs.a.id}&invitee_uri=eq.${encodeURIComponent(
      `https://api.calendly.com/invitees/zz-${marque}-00000`,
    )}`,
    { sale_amount_cents: 120000, sale_date: "2026-04-02", sale_note: NOTE_VENTE },
  );

  /*
   * Une landing taguée, et une qui ne l'est pas.
   *
   * Les deux tombent dans la première page — le décor range cent rendez-vous
   * par jour sur onze jours, et cinq jours tiennent dans une page. Le second
   * n'est pas modifié : sa colonne `utm` reste au `'{}'` par défaut, ce qui
   * est exactement l'état d'une campagne qu'on a oublié de taguer.
   */
  const uriDe = (n) =>
    `https://api.calendly.com/invitees/zz-${marque}-${String(n).padStart(5, "0")}`;

  await srv(
    "PATCH",
    `radar_bookings?organization_id=eq.${orgs.a.id}&invitee_uri=eq.${encodeURIComponent(uriDe(1))}`,
    { utm: UTM, attribution: "utm" },
  );

  /*
   * Une séance reprogrammée, et l'origine qu'elle remplace.
   *
   * L'origine est la fixture taguée, et la reprogrammée est posée **sans**
   * `utm` : c'est ce que le webhook produit. Une séance déplacée hérite du
   * canal et de l'attribution de celle qu'elle remplace, mais pas de son
   * taguage — la personne a cliqué un lien de report, pas une annonce. Sans
   * `rescheduled_from`, un rapport lirait une ligne attribuée à `utm` sans
   * campagne et conclurait à un trou dans le taguage.
   *
   * Elle porte le même prénom, le même nom et la même clé d'invité que les
   * autres : le `grep` d'absence de la section 4 la couvre donc sans qu'on
   * ait à y toucher.
   */
  const origine = (
    await srv(
      "GET",
      `radar_bookings?select=id&organization_id=eq.${orgs.a.id}&invitee_uri=eq.${encodeURIComponent(uriDe(1))}`,
    )
  ).data[0];

  const URI_REPORT = `https://api.calendly.com/invitees/zz-report-${marque}`;
  await creer("radar_bookings", rendezVous(1, {
    invitee_uri: URI_REPORT,
    event_uri: `https://api.calendly.com/events/zz-report-${marque}`,
    attribution: "utm",
    rescheduled_from: origine.id,
  }));

  // Hors plage : ils ne doivent jamais sortir.
  await creer("radar_bookings", rendezVous(9001, {
    scheduled_start: "2025-01-05T09:00:00Z", scheduled_end: "2025-01-05T10:00:00Z",
  }));
  await creer("radar_bookings", rendezVous(9002, {
    scheduled_start: "2027-01-05T09:00:00Z", scheduled_end: "2027-01-05T10:00:00Z",
  }));

  // Chez B, avec des valeurs à soi.
  await creer("radar_bookings", {
    organization_id: orgs.b.id,
    invitee_uri: `https://api.calendly.com/invitees/zz-b-${marque}`,
    event_uri: `https://api.calendly.com/events/zz-b-${marque}`,
    invitee_key: `cle-de-b-${marque}`,
    event_type_name: "Séance chez B",
    scheduled_start: instant(3),
    scheduled_end: instant(3),
    channel_id: canalB.id,
    currency: "EUR",
    invitee_first_name: PRENOM_B,
    invitee_last_name: "Bernard",
  });

  const PLAGE = "depuis=2026-04-01&jusqua=2026-04-30";

  // ---------------------------- 1. Authentification -------------------------
  console.log("\n== 1. Le jeton ==");

  verifie("sans en-tête : 401", (await appel(null, `?${PLAGE}`)).status === 401);
  verifie(
    "jeton inconnu : 401",
    (await appel("f".repeat(64), `?${PLAGE}`)).status === 401,
  );
  verifie(
    "jeton de mauvaise forme : 401",
    (await appel("pas-un-jeton", `?${PLAGE}`)).status === 401,
  );
  const revoque = await appel(JETON_MORT, `?${PLAGE}`);
  verifie("jeton révoqué : 401", revoque.status === 401, `statut ${revoque.status}`);
  verifie("… et sans corps", (await revoque.text()).length === 0);

  const bonne = await appel(JETON_A, `?${PLAGE}`);
  verifie("jeton valide : 200", bonne.status === 200, `statut ${bonne.status}`);

  // ------------------------------ 2. La plage -------------------------------
  console.log("\n== 2. La plage ==");

  for (const [quoi, requete] of [
    ["sans dates", ""],
    ["depuis seul", "?depuis=2026-04-01"],
    ["jusqua seul", "?jusqua=2026-04-30"],
    ["forme fautive", "?depuis=01/04/2026&jusqua=2026-04-30"],
    ["date inexistante", "?depuis=2026-02-30&jusqua=2026-03-01"],
    ["ordre inversé", "?depuis=2026-04-30&jusqua=2026-04-01"],
    ["plus de 366 jours", "?depuis=2026-01-01&jusqua=2027-01-02"],
    ["curseur illisible", `?${PLAGE}&curseur=nimportequoi`],
  ]) {
    const reponse = await appel(JETON_A, requete);
    verifie(`${quoi} : 400`, reponse.status === 400, `statut ${reponse.status}`);
  }

  verifie(
    "exactement 366 jours : accepté",
    (await appel(JETON_A, "?depuis=2026-01-01&jusqua=2027-01-01")).status === 200,
  );

  // ---------------------------- 3. Le cloisonnement -------------------------
  console.log("\n== 3. Le cloisonnement ==");

  const corpsA = await (await appel(JETON_A, `?${PLAGE}`)).json();
  const corpsB = await (await appel(JETON_B, `?${PLAGE}`)).json();

  verifie("A voit ses lignes", corpsA.lignes.length === 500, `${corpsA.lignes.length}`);
  verifie("B ne voit que la sienne", corpsB.lignes.length === 1, `${corpsB.lignes.length}`);
  verifie(
    "B ne voit aucune ligne de A",
    !JSON.stringify(corpsB).includes(`zz-${marque}-`),
  );
  verifie(
    "A ne voit aucune ligne de B",
    !JSON.stringify(corpsA).includes(`zz-b-${marque}`),
  );
  verifie("la séance de B est bien la sienne", corpsB.lignes[0].event_type_name === "Séance chez B");
  verifie("le canal sort par sa clé", corpsB.lignes[0].channel === "meta", corpsB.lignes[0].channel);
  verifie("… avec son libellé", corpsB.lignes[0].channel_label === "Meta");

  // -------------------------- 4. Aucune identité ----------------------------
  console.log("\n== 4. Ce qui ne sort pas ==");

  const toutLeCorps = JSON.stringify(corpsA) + JSON.stringify(corpsB);
  for (const [quoi, valeur] of [
    ["le prénom", NOM],
    ["le nom", FAMILLE],
    ["le prénom de B", PRENOM_B],
    ["la clé d'invité", CLE_INVITE],
    ["la clé d'invité de B", `cle-de-b-${marque}`],
    ["la note de vente", NOTE_VENTE],
    ["le terme de recherche", UTM_TERME],
    ["l'identifiant de clic", GCLID],
  ]) {
    verifie(`${quoi} n'apparaît nulle part`, !toutLeCorps.includes(valeur));
  }

  const champs = Object.keys(corpsA.lignes[0]).sort();
  verifie(
    "une ligne porte exactement les champs convenus",
    JSON.stringify(champs) ===
      JSON.stringify([
        "attribution", "canceled_at", "channel", "channel_label", "currency",
        "effective_status", "event_type_name", "event_uri", "invitee_uri",
        "rescheduled_from", "sale_amount_cents", "sale_date", "sale_recorded_at",
        "scheduled_end", "scheduled_start", "status", "updated_at", "utm_campaign",
        "utm_content", "utm_medium", "utm_source",
      ]),
    JSON.stringify(champs),
  );

  verifie(
    "le préambule dit le fuseau et la purge",
    corpsA.meta.fuseau_de_reference === "Europe/Paris" &&
      corpsA.meta.horodatages === "ISO 8601 avec décalage" &&
      corpsA.meta.purge.includes("identité jamais servie") &&
      corpsA.meta.purge.includes("13 mois") &&
      corpsA.meta.purge.includes("pas une archive"),
    JSON.stringify(corpsA.meta),
  );

  // ------------------------------ 5. Les UTM --------------------------------
  console.log("\n== 5. Les UTM ==");

  const taguee = corpsA.lignes.find((l) => l.invitee_uri === uriDe(1));
  const nue = corpsA.lignes.find((l) => l.invitee_uri === uriDe(2));

  verifie("les deux fixtures sont bien dans la page", Boolean(taguee) && Boolean(nue));

  verifie(
    "la fixture taguée sert ses quatre UTM, à plat",
    taguee?.utm_source === "google" &&
      taguee?.utm_medium === "cpc" &&
      taguee?.utm_campaign === `campagne-${marque}` &&
      taguee?.utm_content === `annonce-${marque}`,
    JSON.stringify({
      utm_source: taguee?.utm_source,
      utm_medium: taguee?.utm_medium,
      utm_campaign: taguee?.utm_campaign,
      utm_content: taguee?.utm_content,
    }),
  );

  verifie(
    "la fixture sans taguage les porte à null, sans les omettre",
    nue?.utm_source === null &&
      nue?.utm_medium === null &&
      nue?.utm_campaign === null &&
      nue?.utm_content === null &&
      ["utm_source", "utm_medium", "utm_campaign", "utm_content"].every((champ) =>
        Object.hasOwn(nue, champ),
      ),
    JSON.stringify(nue),
  );

  /*
   * L'objet lui-même ne sort pas, et le `utm_term` non plus alors qu'il est
   * dans la même colonne : c'est ce qui distingue une liste blanche nommée
   * champ par champ d'un `select *` amputé de deux champs.
   */
  verifie(
    "l'objet `utm` n'apparaît dans aucune ligne",
    corpsA.lignes.every((l) => !Object.hasOwn(l, "utm")) &&
      !JSON.stringify(corpsA).includes('"utm_term"'),
  );

  // -------------------------- 6. La reprogrammation -------------------------
  console.log("\n== 6. La reprogrammation ==");

  const reportee = corpsA.lignes.find((l) => l.invitee_uri === URI_REPORT);

  verifie("la séance reprogrammée est dans la page", Boolean(reportee));

  verifie(
    "elle pointe la ligne qu'elle remplace",
    reportee?.rescheduled_from === origine.id,
    `${reportee?.rescheduled_from} au lieu de ${origine.id}`,
  );

  const pointeuses = corpsA.lignes.filter((l) => l.rescheduled_from !== null);
  verifie(
    "les autres lignes le portent à null, sans l'omettre",
    corpsA.lignes.every((l) => Object.hasOwn(l, "rescheduled_from")) &&
      pointeuses.length === 1,
    JSON.stringify(pointeuses.map((l) => l.invitee_uri)),
  );

  verifie(
    "l'origine, elle, ne pointe rien",
    taguee?.rescheduled_from === null,
    JSON.stringify(taguee?.rescheduled_from),
  );

  /*
   * Le champ ne dit pas seulement « cette ligne a été déplacée » : il dit où
   * la campagne se lit. La reprogrammée n'a pas d'UTM, l'origine les a, et
   * les deux portent la même attribution — sans le pointeur, un rapport
   * verrait une ligne `utm` sans campagne et croirait à un taguage manquant.
   */
  verifie(
    "… et c'est sur elle que la campagne se lit",
    reportee?.utm_campaign === null &&
      reportee?.attribution === "utm" &&
      taguee?.utm_campaign === `campagne-${marque}`,
    JSON.stringify({ deplacee: reportee?.utm_campaign, origine: taguee?.utm_campaign }),
  );

  verifie(
    "chez B, aucune ligne ne pointe une ligne de A",
    corpsB.lignes.every((l) => l.rescheduled_from === null),
    JSON.stringify(corpsB.lignes.map((l) => l.rescheduled_from)),
  );

  // ------------------------------ 7. La plage sert --------------------------
  const horsPlage = JSON.stringify(corpsA);
  verifie("un rendez-vous de 2025 ne sort pas", !horsPlage.includes("-09001"));
  verifie("un rendez-vous de 2027 non plus", !horsPlage.includes("-09002"));

  // ---------------------------- 8. La pagination ----------------------------
  console.log("\n== 7. La pagination ==");

  const page1 = corpsA;
  verifie("la première page annonce une suite", typeof page1.meta.suivant === "string");

  /*
   * L'insertion entre deux pages, le cœur du test. L'une tombe avant le
   * curseur, l'autre après : la première ne doit jamais apparaître — c'est la
   * propriété d'une pagination par clé — la seconde doit apparaître, et aucune
   * ligne d'origine ne doit être perdue ni servie deux fois.
   */
  await creer("radar_bookings", rendezVous(7001, {
    scheduled_start: "2026-04-01T09:00:00Z", scheduled_end: "2026-04-01T09:00:00Z",
    invitee_uri: `https://api.calendly.com/invitees/zz-avant-${marque}`,
  }));
  await creer("radar_bookings", rendezVous(7002, {
    scheduled_start: "2026-04-30T09:00:00Z", scheduled_end: "2026-04-30T09:00:00Z",
    invitee_uri: `https://api.calendly.com/invitees/zz-apres-${marque}`,
  }));

  const page2 = await (await appel(JETON_A, `?${PLAGE}&curseur=${encodeURIComponent(page1.meta.suivant)}`)).json();
  const page3 = await (await appel(JETON_A, `?${PLAGE}&curseur=${encodeURIComponent(page2.meta.suivant)}`)).json();

  verifie("la deuxième page est pleine", page2.lignes.length === 500, `${page2.lignes.length}`);
  verifie("la troisième close la marche", page3.meta.suivant === null, JSON.stringify(page3.meta.suivant));

  const vues = [...page1.lignes, ...page2.lignes, ...page3.lignes].map((l) => l.invitee_uri);
  verifie("aucune ligne n'est servie deux fois", new Set(vues).size === vues.length,
    `${vues.length} lignes, ${new Set(vues).size} distinctes`);

  const attendues = new Set(
    Array.from({ length: TOTAL }, (_, n) =>
      `https://api.calendly.com/invitees/zz-${marque}-${String(n).padStart(5, "0")}`),
  );
  const manquantes = [...attendues].filter((uri) => !vues.includes(uri));
  verifie("aucune ligne d'origine n'est perdue", manquantes.length === 0, `${manquantes.length} manquantes`);

  verifie(
    "une ligne insérée après le curseur apparaît",
    vues.includes(`https://api.calendly.com/invitees/zz-apres-${marque}`),
  );
  verifie(
    "une ligne insérée avant le curseur n'apparaît pas — c'est la pagination par clé",
    !vues.includes(`https://api.calendly.com/invitees/zz-avant-${marque}`),
  );

  verifie(
    "le tri est croissant et stable",
    vues.length > 1 &&
      [...page1.lignes, ...page2.lignes, ...page3.lignes].every(
        (ligne, i, toutes) =>
          i === 0 || Date.parse(toutes[i - 1].scheduled_start) <= Date.parse(ligne.scheduled_start),
      ),
  );

  // --------------------------- 9. Aucune écriture ---------------------------
  console.log("\n== 8. Ce que la route écrit ==");

  /*
   * L'empreinte se prend ici, et non au début du banc : les sections
   * précédentes ont elles-mêmes inséré des lignes pour éprouver la
   * pagination. Ce qu'on veut mesurer est l'effet de la route, pas celui du
   * banc — on encadre donc une série d'appels, et rien d'autre.
   */
  const avant = await empreinteBase(orgs.a.id);

  await appel(JETON_A, `?${PLAGE}`);
  await appel(JETON_A, `?${PLAGE}&curseur=${encodeURIComponent(page1.meta.suivant)}`);
  await appel(JETON_A, "?depuis=2026-04-30&jusqua=2026-04-01");
  await appel(JETON_MORT, `?${PLAGE}`);
  await appel(null, `?${PLAGE}`);

  const apres = await empreinteBase(orgs.a.id);
  verifie("rien n'a bougé en base, hors last_used_at", apres === avant, `${avant} → ${apres}`);

  const jetons = (
    await srv("GET", `radar_export_tokens?select=label,last_used_at,revoked_at&organization_id=eq.${orgs.a.id}&order=label`)
  ).data;
  const actif = jetons.find((j) => j.label === "Rapport A");
  const revoqueLigne = jetons.find((j) => j.id === mort.id) ?? jetons.find((j) => j.label === "Rapport révoqué");
  verifie("le jeton qui a servi porte une date de lecture", Boolean(actif?.last_used_at));
  verifie("le jeton révoqué n'en porte pas", !revoqueLigne?.last_used_at, JSON.stringify(revoqueLigne));
} finally {
  console.log("\n== Nettoyage ==");
  for (const org of Object.values(orgs)) {
    if (org?.id) await srv("DELETE", `organizations?id=eq.${org.id}`);
  }
  const restes = (await srv("GET", "organizations?select=slug&slug=like.zz-qa-ex*")).data;
  verifie("aucune organisation de recette ne reste", restes.length === 0, JSON.stringify(restes));
  bilan();
}
