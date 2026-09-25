/**
 * Banc de la closeuse (migrations 0035 à 0037).
 *
 *   npm run qa:closeuse
 *
 * Un client A avec sa responsable P et deux closeuses C1 et C2, et un autre
 * client B. On vérifie, contre la vraie base :
 * - qu'une closeuse ne voit que SES rendez-vous, leurs réponses et leurs
 *   incidents, et rien d'autre du client (outils, réglages, Horizon, canaux,
 *   relevés, types de séance, l'autre closeuse) ;
 * - qu'elle ne saisit que sur ses rendez-vous, et n'écrit rien en direct ;
 * - que la responsable garde exactement son Radar d'avant, sans les réponses ;
 * - que le client B ne voit rien ;
 * - que la purge efface les réponses au bout de 90 jours, sauf rappel promis.
 *
 * Tout est préfixé `zz-qa-` et supprimé à la fin, même en cas d'échec.
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

annoncerCible("Banc de la closeuse");

const { verifie, bilan } = journal();
const marque = Date.now().toString(36);
const mail = (qui) => `zz-qa-closeuse-${qui}-${marque}@cometestudio.fr`;
const comptes = {};
const orgs = {};

const jour = 86_400_000;
const iso = (decalage) => new Date(Date.now() + decalage).toISOString();

async function rdv(org, nom, debutDans, closeuse = null) {
  return creer("radar_bookings", {
    organization_id: org,
    invitee_uri: `https://api.calendly.com/zz-qa/${marque}/${nom}`,
    event_uri: `https://api.calendly.com/zz-qa/${marque}/ev-${nom}`,
    invitee_key: `zz-qa-${marque}-${nom}`,
    invitee_first_name: nom,
    scheduled_start: iso(debutDans),
    scheduled_end: iso(debutDans + 45 * 60_000),
    event_type_name: "ZZ QA diagnostic",
    closeuse_id: closeuse,
  });
}

const ids = (resultat) => (Array.isArray(resultat.data) ? resultat.data.map((l) => l.id ?? l.booking_id) : []);

try {
  // ------------------------------- Décor ------------------------------------

  for (const qui of ["p", "c1", "c2", "b"]) comptes[qui] = await creerCompte(mail(qui));

  orgs.a = await creer("organizations", { name: "ZZ QA Closeuse A", slug: `zz-qa-closeuse-a-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA Closeuse B", slug: `zz-qa-closeuse-b-${marque}` });

  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.p, role: "owner" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.c1, role: "closeuse" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.c2, role: "closeuse" });
  await creer("memberships", { organization_id: orgs.b.id, user_id: comptes.b, role: "owner" });
  await creer("radar_closeuses", { organization_id: orgs.a.id, user_id: comptes.c1 });
  await creer("radar_closeuses", { organization_id: orgs.a.id, user_id: comptes.c2 });

  const outils = (await srv("GET", "tools?select=id,slug&slug=in.(resultats,finances)")).data;
  for (const org of [orgs.a, orgs.b]) {
    for (const outil of outils) {
      await creer("organization_tools", { organization_id: org.id, tool_id: outil.id, enabled: true });
    }
  }
  await creer("radar_settings", { organization_id: orgs.a.id, commission_basis: "ventes" });
  await creer("radar_channels", { organization_id: orgs.a.id, key: `zz-${marque}`, label: "ZZ Meta", is_comete: true });
  await creer("radar_event_filters", {
    organization_id: orgs.a.id,
    event_type_uri: `https://api.calendly.com/event_types/zz-${marque}`,
    event_type_name: "ZZ QA",
    closeuse_id: comptes.c1,
  });
  await creer("horizon_releves", { organization_id: orgs.a.id, mois: "2026-09-01", publie: true, contenu: { resume: "zz" } });

  const b1 = await rdv(orgs.a.id, "c1-passe", -2 * jour, comptes.c1);
  const b2 = await rdv(orgs.a.id, "c1-avenir", 3 * jour, comptes.c1);
  const b3 = await rdv(orgs.a.id, "client-passe", -2 * jour);
  const b4 = await rdv(orgs.a.id, "c2-passe", -2 * jour, comptes.c2);
  const vieux = await rdv(orgs.a.id, "c1-vieux", -120 * jour, comptes.c1);
  const vieuxRappel = await rdv(orgs.a.id, "c1-vieux-rappel", -120 * jour, comptes.c1);
  const autre = await rdv(orgs.b.id, "b-passe", -2 * jour);

  for (const b of [b1, b3, b4, vieux, vieuxRappel]) {
    await creer("radar_booking_answers", {
      booking_id: b.id,
      organization_id: orgs.a.id,
      answers: [{ q: "Quel est ton numéro de téléphone ?", r: "06 00 00 00 00" }],
    });
  }
  await creer("radar_encaissement_incidents", { booking_id: b4.id, organization_id: orgs.a.id, numero: 1, type: "impaye" });

  const p = par(await connecter(mail("p")));
  const c1 = par(await connecter(mail("c1")));
  const b = par(await connecter(mail("b")));

  // --------------------------- 1. Ce qu'elle voit ---------------------------

  console.log("== 1. Lecture de la closeuse ==");

  const sesRdv = await c1("GET", "radar_bookings?select=id");
  verifie(
    "C1 voit ses deux rendez-vous récents et ses anciens, rien d'autre",
    sesRdv.status === 200 &&
      ids(sesRdv).includes(b1.id) &&
      ids(sesRdv).includes(b2.id) &&
      !ids(sesRdv).includes(b3.id) &&
      !ids(sesRdv).includes(b4.id) &&
      !ids(sesRdv).includes(autre.id),
    JSON.stringify(sesRdv.data),
  );

  const vue = await c1("GET", "radar_bookings_effective?select=id,closeuse_id");
  verifie(
    "la vue de lecture lui montre la même chose",
    vue.status === 200 && vue.data.every((l) => l.closeuse_id === comptes.c1) && ids(vue).includes(b1.id),
    JSON.stringify(vue.data),
  );

  const direct = await c1("GET", `radar_bookings?select=id&id=eq.${b3.id}`);
  verifie("C1 ne lit pas un rendez-vous du client, même par son identifiant", vide(direct), JSON.stringify(direct.data));

  const reponses = await c1("GET", "radar_booking_answers?select=booking_id");
  verifie(
    "C1 lit les réponses de ses rendez-vous seulement",
    reponses.status === 200 && ids(reponses).includes(b1.id) && !ids(reponses).includes(b4.id) && !ids(reponses).includes(b3.id),
    JSON.stringify(reponses.data),
  );

  const incidents = await c1("GET", "radar_encaissement_incidents?select=booking_id");
  verifie("C1 ne voit pas les incidents de C2", vide(incidents), JSON.stringify(incidents.data));

  for (const [table, nom] of [
    ["organization_tools?select=organization_id", "les outils du client"],
    ["radar_settings?select=organization_id", "les réglages Radar"],
    ["radar_channels?select=id", "les canaux"],
    ["radar_statements?select=id", "les relevés"],
    ["radar_event_filters?select=id", "les types de séance"],
    ["horizon_releves?select=id", "Horizon"],
  ]) {
    const r = await c1("GET", table);
    verifie(`C1 ne voit pas ${nom}`, vide(r), `${r.status} ${JSON.stringify(r.data)}`);
  }

  const grilles = await c1("GET", "radar_closeuses?select=user_id");
  verifie(
    "C1 voit sa grille, pas celle de C2",
    grilles.status === 200 && grilles.data.length === 1 && grilles.data[0].user_id === comptes.c1,
    JSON.stringify(grilles.data),
  );

  const organisations = await c1("GET", "organizations?select=id");
  verifie(
    "C1 voit le nom de son client, et d'aucun autre",
    organisations.status === 200 && organisations.data.length === 1 && organisations.data[0].id === orgs.a.id,
    JSON.stringify(organisations.data),
  );

  const adhesions = await c1("GET", "memberships?select=user_id");
  verifie(
    "C1 ne lit que sa propre adhésion",
    adhesions.status === 200 && adhesions.data.length === 1 && adhesions.data[0].user_id === comptes.c1,
    JSON.stringify(adhesions.data),
  );

  const outil = await c1("POST", "rpc/has_tool", { org: orgs.a.id, tool_slug: "resultats" });
  verifie("has_tool répond non pour C1", outil.status === 200 && outil.data === false, JSON.stringify(outil.data));
  const membre = await c1("POST", "rpc/is_member", { org: orgs.a.id });
  verifie("is_member répond non pour C1", membre.status === 200 && membre.data === false, JSON.stringify(membre.data));
  const closeuse = await c1("POST", "rpc/is_closeuse", { org: orgs.a.id });
  verifie("is_closeuse répond oui pour C1", closeuse.status === 200 && closeuse.data === true, JSON.stringify(closeuse.data));

  // --------------------------- 2. Ce qu'elle saisit -------------------------

  console.log("== 2. Saisie de la closeuse ==");

  const aujourdhui = new Date().toISOString().slice(0, 10);

  const vente = await c1("POST", "rpc/radar_set_sale", { booking_id: b1.id, amount_cents: 152000, sale_date: aujourdhui });
  verifie("C1 note une vente sur son rendez-vous", vente.status < 300, JSON.stringify(vente.data));

  const fois = await c1("POST", "rpc/radar_set_sale_fois", { booking_id: b1.id, fois: 7, premier_cents: 50000 });
  verifie("C1 note 7 paiements, 500 € le premier", fois.status < 300, JSON.stringify(fois.data));
  const lu = (await srv("GET", `radar_bookings?select=sale_fois,sale_premier_cents,sale_recorded_by&id=eq.${b1.id}`)).data[0];
  verifie(
    "la vente porte 7 fois, 500 €, et son autrice",
    lu?.sale_fois === 7 && lu?.sale_premier_cents === 50000 && lu?.sale_recorded_by === comptes.c1,
    JSON.stringify(lu),
  );

  const tropGrand = await c1("POST", "rpc/radar_set_sale_fois", { booking_id: b1.id, fois: 7, premier_cents: 200000 });
  verifie("un premier paiement plus grand que le total est refusé", tropGrand.status >= 400, JSON.stringify(tropGrand.data));

  for (const [cible, nom] of [[b3, "du client"], [b4, "de C2"], [autre, "d'un autre client"]]) {
    const r = await c1("POST", "rpc/radar_set_sale", { booking_id: cible.id, amount_cents: 1000, sale_date: aujourdhui });
    verifie(`C1 ne note pas de vente sur un rendez-vous ${nom}`, r.status >= 400, JSON.stringify(r.data));
  }

  const nonVente = await c1("POST", "rpc/radar_note_non_vente", { booking_id: b3.id, motif: "argent" });
  verifie("C1 ne note pas de non-vente chez le client", nonVente.status >= 400, JSON.stringify(nonVente.data));

  const absente = await c1("POST", "rpc/radar_client_set_status", { booking_id: b4.id, new_status: "no_show" });
  verifie("C1 ne marque pas absente une personne de C2", absente.status >= 400, JSON.stringify(absente.data));

  // 0038 : le jour exact où la rappeler.
  const dansDixJours = new Date(Date.now() + 10 * jour).toISOString().slice(0, 10);
  const avecDate = await c1("POST", "rpc/radar_note_non_vente", {
    booking_id: vieux.id,
    motif: "argent",
    recontacter_le: dansDixJours,
  });
  verifie("C1 note une date exacte où la rappeler", avecDate.status < 300, JSON.stringify(avecDate.data));
  const raisonLue = (
    await srv("GET", `radar_booking_activities?select=payload&booking_id=eq.${vieux.id}&type=eq.sale.reason`)
  ).data?.[0]?.payload;
  verifie(
    "la raison porte le jour exact et son mois",
    raisonLue?.recontacter_le === dansDixJours && raisonLue?.recontacter === `${dansDixJours.slice(0, 7)}-01`,
    JSON.stringify(raisonLue),
  );
  const datePassee = await c1("POST", "rpc/radar_note_non_vente", {
    booking_id: vieux.id,
    motif: "argent",
    recontacter_le: "2026-01-02",
  });
  verifie("une date déjà passée est refusée", datePassee.status >= 400, JSON.stringify(datePassee.data));

  const ecritureDirecte = await c1("PATCH", `radar_bookings?id=eq.${b3.id}&select=id`, { closeuse_id: comptes.c1 });
  verifie("C1 ne s'attribue pas un rendez-vous en direct", refuse(ecritureDirecte), `statut ${ecritureDirecte.status}`);

  const incidentDirect = await c1("POST", "radar_encaissement_incidents?select=booking_id", {
    booking_id: b1.id,
    organization_id: orgs.a.id,
    numero: 2,
    type: "impaye",
  });
  verifie("C1 n'écrit pas d'incident", refuse(incidentDirect), `statut ${incidentDirect.status}`);

  const grilleDirecte = await c1("PATCH", `radar_closeuses?user_id=eq.${comptes.c1}&select=user_id`, { taux: 50 });
  verifie("C1 ne change pas sa grille", refuse(grilleDirecte), `statut ${grilleDirecte.status}`);

  // ------------------------ 3. La responsable du client ---------------------

  console.log("== 3. La responsable ==");

  const tout = await p("GET", `radar_bookings?select=id&organization_id=eq.${orgs.a.id}`);
  verifie(
    "P voit tous les rendez-vous de son client, ceux des closeuses compris",
    tout.status === 200 && [b1, b2, b3, b4].every((x) => ids(tout).includes(x.id)),
    JSON.stringify(tout.data),
  );
  const pMembre = await p("POST", "rpc/is_member", { org: orgs.a.id });
  verifie("P reste membre", pMembre.data === true, JSON.stringify(pMembre.data));
  const pVente = await p("POST", "rpc/radar_set_sale", { booking_id: b3.id, amount_cents: 100000, sale_date: aujourdhui });
  verifie("P note toujours ses ventes", pVente.status < 300, JSON.stringify(pVente.data));
  const pReponses = await p("GET", "radar_booking_answers?select=booking_id");
  verifie("P ne lit pas les réponses gardées pour les closeuses", vide(pReponses), JSON.stringify(pReponses.data));
  const pHorizon = await p("GET", "horizon_releves?select=id");
  verifie("P lit toujours Horizon", pHorizon.status === 200 && pHorizon.data.length === 1, JSON.stringify(pHorizon.data));

  // ----------------------------- 4. L'autre client --------------------------

  console.log("== 4. L'autre client ==");

  for (const table of ["radar_bookings", "radar_booking_answers", "radar_closeuses", "radar_encaissement_incidents"]) {
    const r = await b("GET", `${table}?select=organization_id&organization_id=eq.${orgs.a.id}`);
    verifie(`B ne voit rien de ${table} chez A`, vide(r), `${r.status} ${JSON.stringify(r.data)}`);
  }

  // --------------------------------- 5. Purge -------------------------------

  console.log("== 5. Purge des réponses ==");

  const dansDeuxMois = new Date();
  dansDeuxMois.setUTCDate(1);
  dansDeuxMois.setUTCMonth(dansDeuxMois.getUTCMonth() + 2);
  await creer("radar_booking_activities", {
    booking_id: vieuxRappel.id,
    organization_id: orgs.a.id,
    type: "sale.reason",
    payload: { motif: "argent", recontacter: dansDeuxMois.toISOString().slice(0, 10) },
  });

  const purge = await srv("POST", "rpc/radar_purger_reponses", {});
  verifie("la purge tourne", purge.status === 200, JSON.stringify(purge.data));
  const restantes = await srv(
    "GET",
    `radar_booking_answers?select=booking_id&booking_id=in.(${[b1.id, vieux.id, vieuxRappel.id].join(",")})`,
  );
  verifie("les réponses d'un rendez-vous récent restent", ids(restantes).includes(b1.id), JSON.stringify(restantes.data));
  verifie("celles d'un rendez-vous de plus de 90 jours partent", !ids(restantes).includes(vieux.id), JSON.stringify(restantes.data));
  verifie(
    "celles d'un rendez-vous ancien avec un rappel promis restent",
    ids(restantes).includes(vieuxRappel.id),
    JSON.stringify(restantes.data),
  );

  const purgeParC1 = await c1("POST", "rpc/radar_purger_reponses", {});
  verifie("une closeuse ne lance pas la purge", purgeParC1.status >= 400, `statut ${purgeParC1.status}`);
} catch (erreur) {
  verifie("le banc s'exécute sans erreur", false, erreur.message);
} finally {
  for (const org of Object.values(orgs)) await srv("DELETE", `organizations?id=eq.${org.id}`);
  for (const id of Object.values(comptes)) await supprimerCompte(id);
  bilan();
}
