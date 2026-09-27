/**
 * Banc de la réservation (migration 0042), contre la vraie base.
 *
 *   npm run qa:reservation
 *
 * Un client A avec sa titulaire P et deux closeuses C1 et C2, et un autre
 * client B. On vérifie :
 * 1. les droits : chacune ne lit et n'écrit que ses propres réglages ; une
 *    closeuse ne voit que ses rendez-vous, la titulaire les voit tous, B rien ;
 *    personne n'écrit un rendez-vous en direct ;
 * 2. la base refuse la double réservation (pause comprise), même lancée deux
 *    fois au même instant, et le dépassement du maximum par jour, même lancé
 *    en parallèle ; le maximum se compte dans le fuseau de la personne ;
 * 3. annuler et reporter, en une seule transaction ;
 * 4. le jeton Google dans le Vault, hors de portée des sessions ;
 * 5. la purge à 6 mois ;
 * 6. le moteur de bout en bout sur la vraie base (agendas simulés).
 *
 * Tout est préfixé `zz-qa-` et supprimé à la fin, même en cas d'échec.
 */
import { createClient } from "@supabase/supabase-js";

import {
  annoncerCible,
  connecter,
  creer,
  creerCompte,
  env,
  journal,
  par,
  refuse,
  srv,
  supprimerCompte,
  vide,
} from "./qa-commun.mjs";

import { ajouterJours, instantLocal, jourLocal } from "../src/tools/agent/temps.ts";
import { depotSupabase } from "../src/tools/reservation/depot.ts";
import { creneauxLibres, reserver } from "../src/tools/reservation/moteur.ts";

annoncerCible("Banc de la réservation");

const { verifie, bilan } = journal();
const marque = Date.now().toString(36);
const mail = (qui) => `zz-qa-reservation-${qui}-${marque}@cometestudio.fr`;
const comptes = {};
const orgs = {};
const personnes = {};

const P = "Europe/Paris";
const M = 60_000;
// Un lundi dans trois semaines, pour ne jamais tomber dans le préavis.
const aujourdhui = jourLocal(Date.now(), P);
let lundi = ajouterJours(aujourdhui, 14);
while (new Date(`${lundi}T12:00:00Z`).getUTCDay() !== 1) lundi = ajouterJours(lundi, 1);
const a = (h, m = 0, jour = lundi) => new Date(instantLocal(jour, h, m, P)).toISOString();

const ids = (r) => (Array.isArray(r.data) ? r.data.map((l) => l.id) : []);
const rpc = (nom, corps) => srv("POST", `rpc/${nom}`, corps);
const prendre = (personne, debut, donnees = {}) =>
  rpc("reservation_prendre", {
    personne,
    debut,
    donnees: { origine: "essai", prenom: "ZZ", email: `zz-${marque}@example.com`, ...donnees },
  });
const refusePour = (r, mot) =>
  r.status >= 400 && (mot === "23P01" ? r.data?.code === "23P01" : String(r.data?.message ?? "").includes(mot));

try {
  // ------------------------------- Décor ------------------------------------

  for (const qui of ["p", "c1", "c2", "b"]) comptes[qui] = await creerCompte(mail(qui));

  orgs.a = await creer("organizations", { name: "ZZ QA Réservation A", slug: `zz-qa-reservation-a-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA Réservation B", slug: `zz-qa-reservation-b-${marque}` });

  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.p, role: "owner" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.c1, role: "closeuse" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.c2, role: "closeuse" });
  await creer("memberships", { organization_id: orgs.b.id, user_id: comptes.b, role: "owner" });

  await creer("reservation_reglages", { organization_id: orgs.a.id, actif: true });
  await creer("reservation_reglages", { organization_id: orgs.b.id });

  const connecte = new Date().toISOString();
  personnes.p = await creer("reservation_personnes", {
    organization_id: orgs.a.id, user_id: comptes.p, role: "titulaire", google_connecte_le: connecte,
  });
  personnes.c1 = await creer("reservation_personnes", {
    organization_id: orgs.a.id, user_id: comptes.c1, role: "closeuse", max_par_jour: 3, google_connecte_le: connecte,
  });
  personnes.c2 = await creer("reservation_personnes", {
    organization_id: orgs.a.id, user_id: comptes.c2, role: "closeuse", google_connecte_le: connecte,
  });
  personnes.b = await creer("reservation_personnes", {
    organization_id: orgs.b.id, user_id: comptes.b, role: "titulaire",
  });

  const p = par(await connecter(mail("p")));
  const c1 = par(await connecter(mail("c1")));
  const c2 = par(await connecter(mail("c2")));
  const b = par(await connecter(mail("b")));

  // ----------------------------- 1. Les droits ------------------------------

  console.log("== 1. Les droits ==");

  const vuesC1 = await c1("GET", "reservation_personnes?select=id");
  verifie("C1 ne lit que sa propre fiche", ids(vuesC1).join() === personnes.c1.id, JSON.stringify(vuesC1.data));
  const vuesP = await p("GET", "reservation_personnes?select=id");
  verifie("P ne lit que la sienne", ids(vuesP).join() === personnes.p.id, JSON.stringify(vuesP.data));
  verifie("B ne lit rien de A", !ids(await b("GET", "reservation_personnes?select=id")).includes(personnes.p.id));

  const monMax = await c1("PATCH", `reservation_personnes?id=eq.${personnes.c1.id}`, { max_par_jour: 4 });
  verifie("C1 change son maximum", monMax.status === 200 && monMax.data?.[0]?.max_par_jour === 4, JSON.stringify(monMax.data));
  const monRole = await c1("PATCH", `reservation_personnes?id=eq.${personnes.c1.id}`, { role: "titulaire" });
  verifie("C1 ne change pas son rôle", monRole.status >= 400, `${monRole.status}`);
  const monActif = await c1("PATCH", `reservation_personnes?id=eq.${personnes.c1.id}`, { actif: false });
  verifie("C1 ne se sort pas du roulement elle-même", monActif.status >= 400, `${monActif.status}`);
  const autreMax = await c1("PATCH", `reservation_personnes?id=eq.${personnes.c2.id}`, { max_par_jour: 1 });
  verifie("C1 ne change pas le maximum de C2", refuse(autreMax), JSON.stringify(autreMax.data));
  const nouvelle = await c1("POST", "reservation_personnes", {
    organization_id: orgs.a.id, user_id: comptes.c1, role: "titulaire",
  });
  verifie("C1 ne crée pas de fiche", nouvelle.status >= 400, `${nouvelle.status}`);
  const lienFaux = await c2("PATCH", `reservation_personnes?id=eq.${personnes.c2.id}`, { visio: "lien", lien_visio: "http://zoom" });
  verifie("un lien de visio non https est refusé", lienFaux.status >= 400, `${lienFaux.status}`);
  const lienSans = await c2("PATCH", `reservation_personnes?id=eq.${personnes.c2.id}`, { visio: "lien" });
  verifie("« lien fixe » sans lien est refusé", lienSans.status >= 400, `${lienSans.status}`);

  const horaire = await c1("POST", "reservation_horaires", {
    personne_id: personnes.c1.id, organization_id: orgs.a.id, jour: 1, debut: "09:00", fin: "12:00",
  });
  verifie("C1 ajoute une plage à ses horaires", horaire.status === 201, JSON.stringify(horaire.data));
  const horaireAutre = await c1("POST", "reservation_horaires", {
    personne_id: personnes.c2.id, organization_id: orgs.a.id, jour: 1, debut: "09:00", fin: "12:00",
  });
  verifie("C1 n'ajoute rien aux horaires de C2", horaireAutre.status >= 400, `${horaireAutre.status}`);
  const horaireEnvers = await c1("POST", "reservation_horaires", {
    personne_id: personnes.c1.id, organization_id: orgs.a.id, jour: 2, debut: "12:00", fin: "09:00",
  });
  verifie("une plage qui finit avant de commencer est refusée", horaireEnvers.status >= 400, `${horaireEnvers.status}`);
  const horaireAilleurs = await b("POST", "reservation_horaires", {
    personne_id: personnes.b.id, organization_id: orgs.a.id, jour: 1, debut: "09:00", fin: "12:00",
  });
  verifie("une plage ne pointe pas une personne d'un autre client", horaireAilleurs.status >= 400, `${horaireAilleurs.status}`);
  verifie("C2 ne voit pas les horaires de C1", vide(await c2("GET", "reservation_horaires?select=id")));

  const absence = await c2("POST", "reservation_absences", {
    personne_id: personnes.c2.id, organization_id: orgs.a.id, du: lundi, au: ajouterJours(lundi, 2),
  });
  verifie("C2 pose une absence", absence.status === 201, JSON.stringify(absence.data));
  const absenceEnvers = await c2("POST", "reservation_absences", {
    personne_id: personnes.c2.id, organization_id: orgs.a.id, du: ajouterJours(lundi, 2), au: lundi,
  });
  verifie("une absence à l'envers est refusée", absenceEnvers.status >= 400, `${absenceEnvers.status}`);
  const retrait = await c2("DELETE", `reservation_absences?id=eq.${absence.data?.[0]?.id}`);
  verifie("C2 retire son absence", retrait.status === 200 && retrait.data?.length === 1, JSON.stringify(retrait.data));

  verifie("C1 lit les réglages de son client", (await c1("GET", "reservation_reglages?select=organization_id")).data?.length === 1);
  verifie("B ne lit pas les réglages de A", !(await b("GET", "reservation_reglages?select=organization_id")).data?.some((r) => r.organization_id === orgs.a.id));
  const reglageP = await p("PATCH", `reservation_reglages?organization_id=eq.${orgs.a.id}`, { pause_minutes: 0 });
  verifie("P ne change pas les réglages communs", refuse(reglageP), `${reglageP.status}`);

  const rdvC1 = await prendre(personnes.c1.id, a(9), { reponses: [{ question: "Âge, poids", reponse: "zz" }] });
  const rdvC2 = await prendre(personnes.c2.id, a(9));
  verifie("la clé de service prend un rendez-vous", rdvC1.status === 200 && rdvC2.status === 200, JSON.stringify([rdvC1.data, rdvC2.data]));

  const lusC1 = await c1("GET", "reservation_rendez_vous?select=id,reponses");
  verifie("C1 voit son rendez-vous et ses réponses, pas celui de C2",
    ids(lusC1).join() === rdvC1.data && lusC1.data[0].reponses.length === 1, JSON.stringify(lusC1.data));
  const lusP = await p("GET", "reservation_rendez_vous?select=id");
  verifie("P voit les deux", ids(lusP).sort().join() === [rdvC1.data, rdvC2.data].sort().join(), JSON.stringify(lusP.data));
  verifie("B ne voit rien", vide(await b("GET", "reservation_rendez_vous?select=id")));

  const direct = await c1("POST", "reservation_rendez_vous", {
    organization_id: orgs.a.id, personne_id: personnes.c1.id, debut: a(15), fin: a(15, 45), bloque_jusqu_a: a(16), origine: "page",
  });
  verifie("personne n'écrit un rendez-vous en direct", direct.status >= 400, `${direct.status}`);
  const annuleDirect = await c1("PATCH", `reservation_rendez_vous?id=eq.${rdvC1.data}`, { statut: "annule", annule_le: new Date().toISOString() });
  verifie("ni ne l'annule en direct", refuse(annuleDirect), `${annuleDirect.status}`);
  for (const f of ["reservation_prendre", "reservation_annuler", "reservation_purger"]) {
    const r = await c1("POST", `rpc/${f}`, f === "reservation_prendre"
      ? { personne: personnes.c1.id, debut: a(15), donnees: {} }
      : f === "reservation_annuler" ? { rendez_vous: rdvC1.data, par: "personne" } : {});
    verifie(`une session n'appelle pas ${f}`, r.status >= 400, `${r.status}`);
  }

  // ---------------------- 2. Doubles et maximum -----------------------------

  console.log("== 2. Double réservation et maximum ==");

  verifie("même personne, même créneau : refusé", refusePour(await prendre(personnes.c1.id, a(9)), "23P01"));
  verifie("chevauchement partiel : refusé", refusePour(await prendre(personnes.c1.id, a(9, 30)), "23P01"));
  verifie("dans la pause (9h50) : refusé", refusePour(await prendre(personnes.c1.id, a(9, 50)), "23P01"));
  verifie("avant, en empiétant sur la pause (8h20) : refusé", refusePour(await prendre(personnes.c1.id, a(8, 20)), "23P01"));
  const apresPause = await prendre(personnes.c1.id, a(10));
  verifie("à 10h, pause respectée : accepté", apresPause.status === 200, JSON.stringify(apresPause.data));
  const avantPause = await prendre(personnes.c1.id, a(8));
  verifie("à 8h (fin 8h45, pause jusqu'à 9h) : accepté", avantPause.status === 200, JSON.stringify(avantPause.data));

  // C1 : max 4, déjà 3 ce lundi.
  const quatrieme = await prendre(personnes.c1.id, a(14));
  verifie("C1 prend un 4e rendez-vous (son maximum)", quatrieme.status === 200, JSON.stringify(quatrieme.data));
  verifie("le 5e est refusé : maximum atteint", refusePour(await prendre(personnes.c1.id, a(16)), "maximum_atteint"));

  const mardi = ajouterJours(lundi, 1);
  const enMemeTemps = await Promise.all([1, 2, 3, 4, 5].map(() => prendre(personnes.c2.id, a(11, 0, mardi))));
  verifie("5 réservations simultanées du même créneau : une seule passe",
    enMemeTemps.filter((r) => r.status === 200).length === 1 &&
      enMemeTemps.filter((r) => refusePour(r, "23P01")).length === 4,
    enMemeTemps.map((r) => r.status).join());

  await srv("PATCH", `reservation_personnes?id=eq.${personnes.c2.id}`, { max_par_jour: 2 });
  const mercredi = ajouterJours(lundi, 2);
  const enParallele = await Promise.all([9, 11, 13, 15, 17].map((h) => prendre(personnes.c2.id, a(h, 0, mercredi))));
  verifie("5 créneaux différents en parallèle, maximum 2 : deux passent",
    enParallele.filter((r) => r.status === 200).length === 2 &&
      enParallele.filter((r) => refusePour(r, "maximum_atteint")).length === 3,
    enParallele.map((r) => `${r.status}`).join());

  verifie("deux personnes, même créneau : accepté", (await prendre(personnes.p.id, a(9))).status === 200);
  verifie("un créneau passé est refusé", refusePour(await prendre(personnes.p.id, new Date(Date.now() - M).toISOString()), "creneau_passe"));

  await srv("PATCH", `reservation_personnes?id=eq.${personnes.c2.id}`, { actif: false });
  verifie("une personne inactive ne prend plus rien", refusePour(await prendre(personnes.c2.id, a(9, 0, ajouterJours(lundi, 3))), "personne_indisponible"));
  await srv("PATCH", `reservation_personnes?id=eq.${personnes.c2.id}`, { actif: true, max_par_jour: 1, fuseau: "America/Montreal" });

  // Jeudi 15h à Paris = 9h à Montréal ; vendredi 1h à Paris = jeudi 19h à Montréal.
  const jeudi = ajouterJours(lundi, 3);
  const vendredi = ajouterJours(lundi, 4);
  const mtl1 = await prendre(personnes.c2.id, a(15, 0, jeudi));
  const mtl2 = await prendre(personnes.c2.id, a(1, 0, vendredi));
  verifie("le maximum se compte dans son fuseau : jeudi 15h et vendredi 1h de Paris, c'est le même jeudi à Montréal",
    mtl1.status === 200 && refusePour(mtl2, "maximum_atteint"), `${mtl1.status} ${JSON.stringify(mtl2.data)}`);
  await srv("PATCH", `reservation_personnes?id=eq.${personnes.c2.id}`, { max_par_jour: 4, fuseau: P });

  const retirer = await srv("DELETE", `reservation_personnes?id=eq.${personnes.c1.id}`);
  verifie("une personne qui a des rendez-vous ne se supprime pas", retirer.status >= 400, `${retirer.status}`);

  // ------------------------- 3. Annuler, reporter ---------------------------

  console.log("== 3. Annuler et reporter ==");

  const aReporter = await prendre(personnes.p.id, a(11), { jeton_hash: `zz-${marque}-jeton` });
  const reporte = await rpc("reservation_reporter", { ancien: aReporter.data, personne: personnes.p.id, debut: a(11, 15), par: "agent" });
  verifie("reporter de 15 minutes chez la même personne", reporte.status === 200, JSON.stringify(reporte.data));
  const deux = await srv("GET", `reservation_rendez_vous?select=id,statut,annule_par,reporte_de,jeton_hash,prenom&id=in.(${aReporter.data},${reporte.data})`);
  const ancien = deux.data?.find((l) => l.id === aReporter.data);
  const neuf = deux.data?.find((l) => l.id === reporte.data);
  verifie("l'ancien est annulé par l'agent, le nouveau pointe l'ancien",
    ancien?.statut === "annule" && ancien?.annule_par === "agent" && neuf?.reporte_de === aReporter.data && neuf?.prenom === "ZZ",
    JSON.stringify(deux.data));
  verifie("le lien personnel suit le nouveau rendez-vous",
    ancien?.jeton_hash === null && neuf?.jeton_hash === `zz-${marque}-jeton`, JSON.stringify(deux.data));

  // P a 9h et 11h15 ; reporter 11h15 sur 9h échoue, et rien ne bouge.
  const reporteRate = await rpc("reservation_reporter", { ancien: reporte.data, personne: personnes.p.id, debut: a(9), par: "cliente" });
  const toujours = await srv("GET", `reservation_rendez_vous?select=statut&id=eq.${reporte.data}`);
  verifie("un report sur un créneau pris échoue sans rien annuler",
    refusePour(reporteRate, "23P01") && toujours.data?.[0]?.statut === "confirme", `${JSON.stringify(reporteRate.data)} ${JSON.stringify(toujours.data)}`);

  const annule1 = await rpc("reservation_annuler", { rendez_vous: reporte.data, par: "cliente" });
  const annule2 = await rpc("reservation_annuler", { rendez_vous: reporte.data, par: "cliente" });
  verifie("annuler : vrai la première fois, faux ensuite", annule1.data === true && annule2.data === false, `${annule1.data} ${annule2.data}`);
  verifie("le créneau annulé se reprend", (await prendre(personnes.p.id, a(11, 15))).status === 200);

  // ----------------------------- 4. Le Vault --------------------------------

  console.log("== 4. Le jeton Google ==");

  const pose = await rpc("reservation_set_secret", { personne: personnes.c1.id, kind: "google_refresh_token", value: `zz-${marque}` });
  const relu = await rpc("reservation_get_secret", { personne: personnes.c1.id, kind: "google_refresh_token" });
  verifie("le serveur range et relit le jeton", pose.status < 300 && relu.data === `zz-${marque}`, `${pose.status}`);
  verifie("une session ne le lit pas", (await c1("POST", "rpc/reservation_get_secret", { personne: personnes.c1.id, kind: "google_refresh_token" })).status >= 400);
  verifie("un autre type de secret est refusé", (await rpc("reservation_set_secret", { personne: personnes.c1.id, kind: "autre", value: "x" })).status >= 400);
  const efface = await rpc("reservation_clear_secrets", { personne: personnes.c1.id });
  const reluApres = await rpc("reservation_get_secret", { personne: personnes.c1.id, kind: "google_refresh_token" });
  verifie("effacer le jeton", efface.data === 1 && reluApres.data === null, `${efface.data} ${reluApres.data}`);

  // ------------------------------ 5. La purge -------------------------------

  console.log("== 5. La purge à 6 mois ==");

  const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000);
  const ligne = (jours, heureDebut) => {
    const debut = ilYa(jours);
    debut.setUTCHours(heureDebut, 0, 0, 0);
    return {
      organization_id: orgs.a.id, personne_id: personnes.p.id, origine: "essai",
      debut: debut.toISOString(), fin: new Date(+debut + 45 * M).toISOString(), bloque_jusqu_a: new Date(+debut + 60 * M).toISOString(),
      prenom: "ZZ", email: "zz@example.com", telephone: "+33600000000", reponses: [{ question: "q", reponse: "r" }],
      jeton_hash: `zz-${marque}-${jours}`,
    };
  };
  const vieux = await creer("reservation_rendez_vous", ligne(200, 8));
  const recent = await creer("reservation_rendez_vous", ligne(150, 8));
  const purge = await rpc("reservation_purger", {});
  verifie("la purge tourne", purge.status === 200, JSON.stringify(purge.data));
  const apres = await srv("GET", `reservation_rendez_vous?select=id,prenom,email,telephone,reponses,jeton_hash,efface_le&id=in.(${vieux.id},${recent.id})`);
  const v = apres.data?.find((l) => l.id === vieux.id);
  const r = apres.data?.find((l) => l.id === recent.id);
  verifie("à plus de 6 mois : nom, email, téléphone, réponses et lien effacés, la ligne reste",
    v && v.prenom === null && v.email === null && v.telephone === null && v.reponses.length === 0 && v.jeton_hash === null && v.efface_le !== null,
    JSON.stringify(v));
  verifie("à 5 mois : rien n'est effacé", r && r.prenom === "ZZ" && r.reponses.length === 1 && r.efface_le === null, JSON.stringify(r));

  // ------------------------- 6. Le moteur, de bout en bout ------------------

  console.log("== 6. Le moteur sur la vraie base ==");

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const depot = depotSupabase(admin);
  const agendas = { occupe: async () => [] };

  // Un client neuf : C1 débutante, P titulaire, lundi 14h-16h chacune.
  orgs.m = await creer("organizations", { name: "ZZ QA Réservation moteur", slug: `zz-qa-reservation-m-${marque}` });
  await creer("reservation_reglages", { organization_id: orgs.m.id, actif: true, fenetre_jours: 21 });
  const mp = await creer("reservation_personnes", { organization_id: orgs.m.id, user_id: comptes.p, role: "titulaire", google_connecte_le: connecte });
  const mc = await creer("reservation_personnes", { organization_id: orgs.m.id, user_id: comptes.c1, role: "closeuse", google_connecte_le: connecte });
  for (const qui of [mp, mc]) {
    await creer("reservation_horaires", { personne_id: qui.id, organization_id: orgs.m.id, jour: 1, debut: "14:00", fin: "16:00" });
  }

  const dispo = await creneauxLibres(orgs.m.id, Date.now(), depot, agendas);
  const quatorze = a(14);
  const c14 = dispo.etat === "ouvert" ? dispo.creneaux.find((c) => c.debut === quatorze) : null;
  verifie("le lundi 14h est proposé, avec les deux personnes", c14?.personnes?.length === 2, JSON.stringify(c14));

  const donnees = { origine: "essai", prenom: "ZZ", email: "zz@example.com", fuseauCliente: P, reponses: [], utm: { utm_campaign: "test-qa" }, jetonHash: `zz-${marque}-m1` };
  const r1 = await reserver(orgs.m.id, quatorze, donnees, Date.now(), depot, agendas);
  verifie("la closeuse débutante le prend, pas la titulaire", r1.ok && r1.personneId === mc.id, JSON.stringify(r1));
  const r2 = await reserver(orgs.m.id, quatorze, { ...donnees, jetonHash: `zz-${marque}-m2` }, Date.now(), depot, agendas);
  verifie("le même créneau, ensuite : la titulaire", r2.ok && r2.personneId === mp.id, JSON.stringify(r2));
  const r3 = await reserver(orgs.m.id, quatorze, { ...donnees, jetonHash: `zz-${marque}-m3` }, Date.now(), depot, agendas);
  verifie("puis plus personne", !r3.ok && r3.raison === "plus_libre", JSON.stringify(r3));

  const apresResa = await creneauxLibres(orgs.m.id, Date.now(), depot, agendas);
  const debuts = apresResa.etat === "ouvert" ? apresResa.creneaux.filter((c) => c.debut.startsWith(lundi) || c.debut.startsWith(ajouterJours(lundi, -1))) : [];
  verifie("après 14h, la pause : plus rien avant 15h ce lundi",
    !debuts.some((c) => Date.parse(c.debut) > Date.parse(quatorze) - 60 * M && Date.parse(c.debut) < Date.parse(a(15))),
    JSON.stringify(debuts.map((c) => c.debut)));
} catch (erreur) {
  verifie("le banc s'exécute sans erreur", false, erreur.stack ?? erreur.message);
} finally {
  for (const org of Object.values(orgs)) {
    const r = await srv("DELETE", `organizations?id=eq.${org.id}`);
    if (r.status >= 300) console.log(`  ménage : ${org.slug} ${r.status} ${JSON.stringify(r.data)}`);
  }
  for (const id of Object.values(comptes)) await supprimerCompte(id);
  const reste = await srv("GET", `organizations?select=id&slug=like.zz-qa-reservation-*-${marque}`);
  verifie("le ménage ne laisse aucun client de test", vide(reste), JSON.stringify(reste.data));
  bilan();
}
