/**
 * Banc de QA — Sonde : isolation, porte d'entrée, et le sel.
 *
 * Sonde est le seul outil du hub dont la promesse est une **absence** : aucune
 * ligne ne doit pouvoir désigner quelqu'un. Ce banc éprouve les trois murs qui
 * la tiennent :
 *
 * 1. `sonde_salt` est hors de portée d'une session. Ce n'est pas une
 *    précaution de plus, c'est celle qui compte : qui lit le sel du jour peut,
 *    en devinant une IP et un user-agent, retrouver le visiteur derrière une
 *    `visitor_key`. La table porte la RLS sans aucune politique, et il faut
 *    vérifier que ce choix tient — y compris pour Louis.
 * 2. `sonde_events` ne s'écrit pas depuis une session. Seule la route de
 *    collecte, avec la clé de service, a le droit de fabriquer une visite.
 * 3. L'isolation habituelle : un membre de B ne lit ni n'écrit rien chez A,
 *    et couper l'outil referme tout immédiatement.
 *
 * S'y ajoutent les trois fonctions de nuit, qui ne se vérifient qu'en les
 * appelant : la rotation du sel détruit-elle vraiment les anciens, l'agrégation
 * est-elle rejouable sans doubler les chiffres, la purge n'emporte-t-elle que
 * ce qu'elle doit.
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

annoncerCible("QA — Sonde");

const { verifie, bilan } = journal();
const marque = Math.random().toString(36).slice(2, 8);

const comptes = {};
const orgs = {};

const mailA = `zz-qa-sonde-a-${marque}@comete-qa.test`;
const mailB = `zz-qa-sonde-b-${marque}@comete-qa.test`;

/** Appel d'une fonction avec la clé de service, comme le fera `cron`. */
const rpc = (nom, corps = {}) => srv("POST", `rpc/${nom}`, corps);

/** Un instant dans le passé, en ISO. */
const ilYA = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString();

/** Le jour parisien d'un instant, comme le fait `sonde_agreger_jour`. */
const jourParis = (iso) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/* Le sel de production ne doit pas être emporté par le ménage du banc : on
   note ce qu'il y avait avant, et on vérifie à la fin qu'on l'a rendu tel quel. */
const selAvant = (await srv("GET", "sonde_salt?select=day")).data;

try {
  // ------------------------------- Décor -----------------------------------

  comptes.a = await creerCompte(mailA);
  comptes.b = await creerCompte(mailB);

  orgs.a = await creer("organizations", {
    name: "ZZ QA Sonde A",
    slug: `zz-qa-sonde-a-${marque}`,
  });
  orgs.b = await creer("organizations", {
    name: "ZZ QA Sonde B",
    slug: `zz-qa-sonde-b-${marque}`,
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

  const outil = (await srv("GET", "tools?select=id,name,sort_order&slug=eq.sonde")).data[0];
  verifie(
    "l'outil `sonde` est au catalogue",
    Boolean(outil?.id) && outil.name === "Sonde" && outil.sort_order === 50,
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

  // Un site chez chacun. Le jeton est laissé au défaut : c'est lui qu'on
  // éprouve ici, puisque l'administration s'appuiera dessus.
  const siteA = await creer("sonde_sites", {
    organization_id: orgs.a.id,
    name: "Landing A",
    domains: ["exemple-a.test"],
  });
  const siteB = await creer("sonde_sites", {
    organization_id: orgs.b.id,
    name: "Landing B",
    domains: ["exemple-b.test"],
  });

  verifie(
    "un site créé sans jeton en reçoit un, aléatoire et long",
    typeof siteA.token === "string" && siteA.token.length === 32,
    JSON.stringify(siteA.token),
  );
  verifie(
    "et deux sites ne partagent pas le même",
    siteA.token !== siteB.token,
    `${siteA.token} / ${siteB.token}`,
  );

  const jetonA = par(await connecter(mailA));
  const jetonB = par(await connecter(mailB));

  // ------------------------------ 1. Le sel ---------------------------------

  console.log("== 1. Le sel est hors de portée ==");

  const tour = await rpc("sonde_tourner_sel");
  verifie(
    "la rotation rend le jour parisien courant",
    tour.data === jourParis(new Date().toISOString()),
    JSON.stringify(tour.data),
  );

  const selApres = await srv("GET", "sonde_salt?select=day,salt");
  verifie(
    "il n'y a qu'un sel en base, celui du jour",
    selApres.data.length === 1 && selApres.data[0].day === tour.data,
    JSON.stringify(selApres.data.map((l) => l.day)),
  );
  verifie(
    "et il fait bien 32 octets",
    selApres.data[0]?.salt?.length === 64,
    `${selApres.data[0]?.salt?.length} caractères`,
  );

  // Un sel d'hier, posé à la main, doit disparaître à la rotation suivante.
  await srv("POST", "sonde_salt", { day: jourParis(ilYA(1)), salt: "vieuxsel" });
  const avantRotation = (await srv("GET", "sonde_salt?select=day")).data.length;
  await rpc("sonde_tourner_sel");
  const restant = await srv("GET", "sonde_salt?select=day,salt");
  verifie(
    "la rotation détruit les sels des jours passés",
    avantRotation === 2 && restant.data.length === 1 && restant.data[0].day === tour.data,
    JSON.stringify(restant.data.map((l) => l.day)),
  );
  verifie(
    "sans réécrire celui du jour",
    restant.data[0].salt === selApres.data[0].salt,
    "le sel du jour a changé alors qu'il existait déjà",
  );

  const lectureSelA = await jetonA("GET", "sonde_salt?select=day,salt");
  verifie(
    "un membre ne lit pas le sel",
    vide(lectureSelA) || lectureSelA.status >= 400,
    `statut ${lectureSelA.status}, ${JSON.stringify(lectureSelA.data)}`,
  );

  const ecritureSelA = await jetonA("POST", "sonde_salt", {
    day: "2020-01-01",
    salt: "intrusion",
  });
  verifie(
    "et il n'en pose pas",
    refuse(ecritureSelA),
    `statut ${ecritureSelA.status}`,
  );

  const rotationParMembre = await jetonA("POST", "rpc/sonde_tourner_sel", {});
  verifie(
    "il ne déclenche pas la rotation lui-même",
    rotationParMembre.status >= 400,
    `statut ${rotationParMembre.status}`,
  );

  // ------------------------ 2. Les événements ne s'écrivent pas -------------

  console.log("\n== 2. Personne ne fabrique une visite ==");

  const evenement = (site, org, extra = {}) => ({
    site_id: site.id,
    organization_id: org.id,
    kind: "pageview",
    path: "/",
    visitor_key: `cle-${Math.random().toString(36).slice(2)}`,
    channel_bucket: "direct",
    ...extra,
  });

  const insertionMembre = await jetonA("POST", "sonde_events?select=id", evenement(siteA, orgs.a));
  verifie(
    "un membre n'insère pas d'événement chez lui",
    refuse(insertionMembre),
    `statut ${insertionMembre.status}`,
  );

  const insertionDaily = await jetonA("POST", "sonde_daily?select=day", {
    site_id: siteA.id,
    organization_id: orgs.a.id,
    day: jourParis(new Date().toISOString()),
    channel_bucket: "direct",
    pageviews: 9999,
    visitors: 9999,
    cta_clicks: 9999,
  });
  verifie(
    "ni de ligne d'agrégat",
    refuse(insertionDaily),
    `statut ${insertionDaily.status}`,
  );

  const siteParMembre = await jetonA("POST", "sonde_sites?select=id", {
    organization_id: orgs.a.id,
    name: "Site clandestin",
  });
  verifie(
    "ni de site : c'est Louis qui les déclare",
    refuse(siteParMembre),
    `statut ${siteParMembre.status}`,
  );

  /*
   * Et pour Louis ?
   *
   * `sonde_salt` n'a aucune politique, `sonde_events` aucune politique
   * d'écriture : ni l'une ni l'autre ne fait d'exception pour `is_admin()`.
   * C'est délibéré — Louis n'a aucune raison de fabriquer une visite, ni de
   * lire un sel qui ne sert qu'à la route de collecte — et une intention qui
   * ne se vérifie pas finit par s'oublier. On promeut donc B le temps de trois
   * requêtes.
   */
  await srv("PATCH", `profiles?id=eq.${comptes.b}`, { is_admin: true });

  const selParLouis = await jetonB("GET", "sonde_salt?select=day,salt");
  verifie(
    "même Louis ne lit pas le sel",
    vide(selParLouis) || selParLouis.status >= 400,
    `statut ${selParLouis.status}, ${JSON.stringify(selParLouis.data)}`,
  );

  const evenementParLouis = await jetonB(
    "POST",
    "sonde_events?select=id",
    evenement(siteB, orgs.b),
  );
  verifie(
    "même Louis n'insère pas d'événement",
    refuse(evenementParLouis),
    `statut ${evenementParLouis.status}`,
  );

  const siteParLouis = await jetonB("POST", "sonde_sites?select=id,name", {
    organization_id: orgs.b.id,
    name: "Site déclaré par Louis",
    domains: ["exemple-louis.test"],
  });
  verifie(
    "mais il déclare bien un site",
    siteParLouis.status < 300 && siteParLouis.data?.[0]?.name === "Site déclaré par Louis",
    `statut ${siteParLouis.status}, ${JSON.stringify(siteParLouis.data)}`,
  );

  await srv("PATCH", `profiles?id=eq.${comptes.b}`, { is_admin: false });

  const selApresDegradation = await jetonB("GET", "sonde_salt?select=day");
  verifie(
    "B redevenu simple membre ne lit toujours rien",
    vide(selApresDegradation) || selApresDegradation.status >= 400,
    `statut ${selApresDegradation.status}`,
  );

  // ---------------------------- 3. L'isolation ------------------------------

  console.log("\n== 3. B ne voit rien chez A ==");

  // Le décor de lecture est posé avec la clé de service, comme le fera la
  // route de collecte.
  const hier = jourParis(ilYA(1));
  await creer("sonde_events", [
    evenement(siteA, orgs.a, { occurred_at: ilYA(1), visitor_key: "cle-a-1" }),
    evenement(siteA, orgs.a, { occurred_at: ilYA(1), visitor_key: "cle-a-1" }),
    evenement(siteA, orgs.a, { occurred_at: ilYA(1), visitor_key: "cle-a-2" }),
    evenement(siteA, orgs.a, { occurred_at: ilYA(1), visitor_key: "cle-a-2", kind: "cta" }),
  ]);
  await creer("sonde_events", [
    evenement(siteB, orgs.b, { occurred_at: ilYA(1), visitor_key: "cle-b-1" }),
  ]);

  const lectureA = await jetonA("GET", `sonde_events?select=id&site_id=eq.${siteA.id}`);
  verifie(
    "A lit ses propres événements",
    lectureA.data?.length === 4,
    `${lectureA.data?.length} événement(s)`,
  );

  const lectureBchezA = await jetonB(
    "GET",
    `sonde_events?select=id,visitor_key&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "B ne lit aucun événement de A",
    vide(lectureBchezA),
    `statut ${lectureBchezA.status}, ${JSON.stringify(lectureBchezA.data)}`,
  );

  const sitesBchezA = await jetonB(
    "GET",
    `sonde_sites?select=id,token&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "B ne lit aucun site de A, ni son jeton",
    vide(sitesBchezA),
    `statut ${sitesBchezA.status}, ${JSON.stringify(sitesBchezA.data)}`,
  );

  const porteB = await jetonB("POST", "rpc/can_access_sonde", { org: orgs.a.id });
  verifie(
    "`can_access_sonde` dit non à B pour l'organisation de A",
    porteB.data === false,
    JSON.stringify(porteB.data),
  );

  // --------------------------- 4. L'agrégation ------------------------------

  console.log("\n== 4. L'agrégation de la veille ==");

  const premier = await rpc("sonde_agreger_jour", { cible: hier });
  verifie(
    "elle rend le nombre de lignes écrites",
    Number(premier.data) >= 2,
    JSON.stringify(premier.data),
  );

  const agregatA = (
    await srv(
      "GET",
      `sonde_daily?select=pageviews,visitors,cta_clicks&site_id=eq.${siteA.id}&day=eq.${hier}`,
    )
  ).data[0];
  verifie(
    "trois pages vues, deux visiteurs, un clic",
    agregatA?.pageviews === 3 && agregatA?.visitors === 2 && agregatA?.cta_clicks === 1,
    JSON.stringify(agregatA),
  );

  // Rejouée, elle doit rendre exactement la même chose : c'est ce qui permet
  // de rattraper une nuit ratée sans doubler les chiffres.
  await rpc("sonde_agreger_jour", { cible: hier });
  await rpc("sonde_agreger_jour", { cible: hier });
  const apresTroisFois = (
    await srv(
      "GET",
      `sonde_daily?select=pageviews,visitors,cta_clicks&site_id=eq.${siteA.id}&day=eq.${hier}`,
    )
  ).data;
  verifie(
    "trois passages ne font qu'une ligne, aux mêmes chiffres",
    apresTroisFois.length === 1 &&
      apresTroisFois[0].pageviews === 3 &&
      apresTroisFois[0].visitors === 2,
    JSON.stringify(apresTroisFois),
  );

  const agregatVisibleA = await jetonA(
    "GET",
    `sonde_daily?select=pageviews&site_id=eq.${siteA.id}&day=eq.${hier}`,
  );
  verifie(
    "A lit son agrégat",
    agregatVisibleA.data?.length === 1,
    JSON.stringify(agregatVisibleA.data),
  );

  const agregatBchezA = await jetonB(
    "GET",
    `sonde_daily?select=pageviews&organization_id=eq.${orgs.a.id}`,
  );
  verifie(
    "B ne lit pas l'agrégat de A",
    vide(agregatBchezA),
    JSON.stringify(agregatBchezA.data),
  );

  // --------------------- 4 bis. Un canal Radar disparaît ---------------------

  console.log("\n== 4 bis. Suppression d'un canal Radar ==");

  /*
   * Le brief posait `primary key (site_id, day, channel_bucket, channel_id)`,
   * qui aurait rendu `channel_id` non nul et fait échouer `on delete set null`
   * au premier canal supprimé. La migration pose à la place un index unique
   * `nulls not distinct`. On vérifie ici que le remplacement fait ce qu'on
   * attend : la ligne d'agrégat survit à la disparition de son canal, détachée
   * plutôt qu'emportée.
   */
  const canal = await creer("radar_channels", {
    organization_id: orgs.a.id,
    key: "zz-qa-canal",
    label: "Canal QA",
    is_comete: true,
  });

  await creer("sonde_daily", {
    site_id: siteA.id,
    organization_id: orgs.a.id,
    day: hier,
    channel_id: canal.id,
    channel_bucket: "canal",
    pageviews: 12,
    visitors: 7,
    cta_clicks: 3,
  });

  const suppressionCanal = await srv("DELETE", `radar_channels?id=eq.${canal.id}`);
  verifie(
    "le canal se supprime sans que la contrainte s'y oppose",
    suppressionCanal.status < 300,
    `statut ${suppressionCanal.status}, ${JSON.stringify(suppressionCanal.data)}`,
  );

  const detachee = (
    await srv(
      "GET",
      `sonde_daily?select=channel_id,channel_bucket,pageviews&site_id=eq.${siteA.id}&day=eq.${hier}&channel_bucket=eq.canal`,
    )
  ).data;
  verifie(
    "et la ligne d'agrégat survit, détachée de son canal",
    detachee.length === 1 && detachee[0].channel_id === null && detachee[0].pageviews === 12,
    JSON.stringify(detachee),
  );

  // ------------------------------ 5. La purge -------------------------------

  console.log("\n== 5. La purge des bruts ==");

  await creer("sonde_events", [
    evenement(siteA, orgs.a, { occurred_at: ilYA(500), visitor_key: "cle-vieille" }),
  ]);

  const avantPurge = (await srv("GET", `sonde_events?select=id&site_id=eq.${siteA.id}`))
    .data.length;
  const purge = await rpc("sonde_purger_evenements");
  const apresPurge = (await srv("GET", `sonde_events?select=id&site_id=eq.${siteA.id}`))
    .data.length;

  verifie(
    "elle emporte l'événement de plus de treize mois, et lui seul",
    Number(purge.data) >= 1 && apresPurge === avantPurge - 1,
    `${avantPurge} avant, ${apresPurge} après, ${purge.data} effacé(s)`,
  );
  const agregatIntact = (
    await srv(
      "GET",
      `sonde_daily?select=pageviews,visitors&site_id=eq.${siteA.id}&day=eq.${hier}&channel_bucket=eq.direct`,
    )
  ).data;
  verifie(
    "l'agrégat, lui, ne bouge pas",
    agregatIntact.length === 1 &&
      agregatIntact[0].pageviews === 3 &&
      agregatIntact[0].visitors === 2,
    JSON.stringify(agregatIntact),
  );

  // ---------------------------- 6. Outil coupé ------------------------------

  console.log("\n== 6. Outil coupé ==");

  await allumer(orgs.a.id, false);

  const porteCoupee = await jetonA("POST", "rpc/can_access_sonde", { org: orgs.a.id });
  verifie(
    "`can_access_sonde` dit non dès que l'outil est coupé",
    porteCoupee.data === false,
    JSON.stringify(porteCoupee.data),
  );

  for (const [table, libelle] of [
    ["sonde_sites", "ses sites"],
    ["sonde_events", "ses événements"],
    ["sonde_daily", "ses agrégats"],
  ]) {
    const lecture = await jetonA("GET", `${table}?select=*`);
    verifie(
      `outil coupé, A ne voit plus ${libelle}`,
      vide(lecture),
      `statut ${lecture.status}, ${JSON.stringify(lecture.data)?.slice(0, 120)}`,
    );
  }

  await allumer(orgs.a.id, true);
  const retour = await jetonA("GET", `sonde_sites?select=id&organization_id=eq.${orgs.a.id}`);
  verifie(
    "outil rallumé, son site est revenu",
    retour.data?.length === 1,
    `${retour.data?.length} site(s)`,
  );

  // ------------------- 7. Aucune trace d'une personne -----------------------

  console.log("\n== 7. Rien qui désigne quelqu'un ==");

  /*
   * La vérification de fond : on relit tout ce que le banc a écrit et on
   * cherche une IP ou un user-agent. Ils n'ont pas de colonne où aller, et
   * c'est justement ce qu'on veut constater plutôt que de le supposer.
   */
  /*
   * La racine de l'API REST rend le schéma OpenAPI du projet : c'est la seule
   * façon d'énumérer les colonnes depuis un banc qui ne parle que REST —
   * `information_schema` n'est pas exposé, et c'est très bien ainsi.
   */
  const schema = (await srv("GET", "")).data;
  const tables = Object.entries(schema?.definitions ?? {}).filter(([nom]) =>
    nom.startsWith("sonde_"),
  );

  verifie(
    "les quatre tables de Sonde sont bien là (contrôle de la lecture du schéma)",
    tables.length === 4,
    tables.map(([nom]) => nom).join(", ") || "aucune table lue",
  );

  const suspectes = tables.flatMap(([table, def]) =>
    Object.keys(def?.properties ?? {})
      .filter((col) => /(^|_)(ip|adresse|address|agent|ua)($|_)|user_agent|email/i.test(col))
      .map((col) => `${table}.${col}`),
  );
  verifie(
    "aucune colonne de Sonde ne porte une IP ni un user-agent",
    tables.length === 4 && suspectes.length === 0,
    JSON.stringify(suspectes),
  );

  const bruts = JSON.stringify(
    (await srv("GET", `sonde_events?select=*&organization_id=eq.${orgs.a.id}`)).data,
  );
  verifie(
    "et aucune ligne ne contient quoi que ce soit qui ressemble à une IP",
    !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(bruts) &&
      !/Mozilla|Chrome|Safari|Gecko/i.test(bruts),
    bruts.slice(0, 200),
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

  const sites = (await srv("GET", "sonde_sites?select=name")).data;
  const evenements = (await srv("GET", "sonde_events?select=id&limit=1")).data;
  verifie(
    "les sites et les événements sont partis avec leur organisation",
    sites.length === 0 && evenements.length === 0,
    `${sites.length} site(s), ${evenements.length} événement(s)`,
  );

  /*
   * Le sel : le banc en a fait tourner la rotation, ce qui est exactement ce
   * que fait `cron` chaque nuit. On vérifie qu'on laisse la table dans l'état
   * où on l'a trouvée — un seul sel, celui du jour.
   */
  const selFinal = (await srv("GET", "sonde_salt?select=day")).data;
  verifie(
    "le sel du jour est en place, et lui seul",
    selFinal.length === 1,
    `${selAvant.length} avant, ${selFinal.length} après`,
  );

  bilan();
}
