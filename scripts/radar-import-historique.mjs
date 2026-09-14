/**
 * Reprendre dans Radar les rendez-vous d'avant son branchement.
 *
 * Radar n'importe aucun historique : il ne connaît que ce que le webhook a reçu
 * depuis la connexion du Calendly d'un client. Ce script comble le trou, une
 * fois, pour un client dont on connaît l'issue des rendez-vous passés.
 *
 *   node scripts/radar-import-historique.mjs --org <slug> --issues <fichier.json>
 *        --depuis AAAA-MM-JJ --jusqua AAAA-MM-JJ [--par <email admin>] [--ecrire]
 *
 * Sans `--ecrire`, rien ne part en base : le script lit Calendly et Radar, et
 * dit ce qu'il ferait. Aucun nom ni email n'est affiché, dans aucun mode.
 *
 * Le fichier, hors dépôt, porte deux choses.
 *
 * `issues` — pour chaque événement Calendly (clé : l'URI du `scheduled_event`),
 * ce qui s'est passé : `vendue` (montant en centimes, date, offre),
 * `venue_sans_vente`, `venue_non_confirmee`, `absente`, `annule` (même si
 * Calendly le garde actif : annulé ou reprogrammé hors Calendly),
 * `issue_inconnue` (passé, jamais noté : repris avec une note), `inconnue`
 * (rien à dire), `hors_import`. Et, quand le site du client les a enregistrés,
 * `canal` (clé du canal Radar du premier contact) et `utm` (ceux du premier
 * contact) : Calendly ne garde souvent que les `utm` que le site pose sur ses
 * propres liens (`utm_source=site`), qui disent d'où la personne a cliqué, pas
 * d'où elle venait.
 *
 * `manuels` — les rendez-vous que le client a saisis ailleurs que dans
 * Calendly, avec email et nom (d'où un fichier hors dépôt) : ils entrent avec
 * l'`invitee_uri` que le fichier leur donne.
 *
 * Pourquoi l'issue compte. Radar pose « honoré » tout seul sur un rendez-vous
 * passé non contesté. Un rendez-vous passé dont le fichier ne dit rien
 * (`inconnue`, ou absent du fichier) n'entre pas, et le compte-rendu en donne
 * les dates ; un rendez-vous à venir entre, comme au webhook.
 *
 * Ce qui est écrit suit le webhook au plus près : même clé d'invité (HMAC du
 * sel du client), même nom, même réponse déclarée, même attribution
 * (`attribuer`, `precedent`) quand le canal n'est pas connu, même héritage de
 * canal pour une séance reprogrammée. Seuls les types de séance suivis
 * entrent ; un type inconnu entre s'il s'appelle « RDV diagnostic offert… ».
 * Une vente respecte les gardes de `radar_set_sale`. Chaque ligne reprise
 * porte une activité `booking.imported`, et ses gestes (vente, pas de vente,
 * non venu) leurs activités habituelles, signées du compte admin `--par`.
 *
 * Une ligne déjà dans Radar n'est jamais recréée. Si elle a été reprise par
 * ce script, elle reçoit ce qui lui manque (`utm` d'origine) ; si elle vient du
 * webhook, seulement une vente, un non venu ou un « pas de vente » que le
 * fichier lui donne. Relancer le script ne fait rien de plus.
 */
import { readFileSync } from "node:fs";

import { SUPABASE, env } from "./qa-commun.mjs";
import { attribuer, precedent, reponseDeclaree } from "../src/tools/resultats/attribution.ts";
import { cleInvite, motifAnnulation, nomInvite, utmRetenus } from "../src/tools/resultats/calendly.ts";

// ------------------------------- Arguments ---------------------------------

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const ECRIRE = args.includes("--ecrire");
const SLUG = option("org");
const FICHIER = option("issues");
const DEPUIS = option("depuis");
const JUSQUA = option("jusqua");
const PAR = option("par") ?? "louis@cometestudio.fr";

const jour = /^\d{4}-\d{2}-\d{2}$/;
if (!SLUG || !FICHIER || !jour.test(DEPUIS ?? "") || !jour.test(JUSQUA ?? "")) {
  console.error(
    "Usage : node scripts/radar-import-historique.mjs --org <slug> --issues <fichier.json> --depuis AAAA-MM-JJ --jusqua AAAA-MM-JJ [--par <email admin>] [--ecrire]",
  );
  process.exit(1);
}

const ISSUES = new Set([
  "vendue",
  "venue_sans_vente",
  "venue_non_confirmee",
  "absente",
  "annule",
  "issue_inconnue",
  "inconnue",
  "hors_import",
]);
const fichier = JSON.parse(readFileSync(FICHIER, "utf8"));
const REPRISE = fichier.etabli_le ?? "fichier d'issues";
const issues = fichier.issues ?? {};
const manuels = fichier.manuels ?? [];
const verifier = (e, ou) => {
  if (!ISSUES.has(e.issue)) throw new Error(`Issue inconnue (${e.issue}) pour ${ou}`);
  if (e.issue === "vendue" && (!Number.isInteger(e.montant_cents) || !jour.test(e.date_vente ?? ""))) {
    throw new Error(`Vente sans montant ou sans date pour ${ou}`);
  }
};
for (const [uri, e] of Object.entries(issues)) verifier(e, uri.slice(-12));
for (const m of manuels) {
  verifier(m, m.invitee_uri);
  if (!m.invitee_uri || !m.event_uri || !m.email || !m.scheduled_start || !m.scheduled_end || !m.event_type_name) {
    throw new Error(`Rendez-vous manuel incomplet : ${m.invitee_uri ?? "?"}`);
  }
  if (m.invitee_uri.startsWith("https://api.calendly.com/")) throw new Error(`Un rendez-vous manuel ne prend pas d'URI Calendly : ${m.invitee_uri}`);
}

// ------------------------------- Supabase ----------------------------------

const CLE = env.SUPABASE_SERVICE_ROLE_KEY;

async function base(methode, chemin, corps, prefer = "return=representation") {
  const reponse = await fetch(`${SUPABASE}/rest/v1/${chemin}`, {
    method: methode,
    headers: {
      apikey: CLE,
      Authorization: `Bearer ${CLE}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await reponse.text();
  const data = texte ? JSON.parse(texte) : null;
  if (!reponse.ok) throw new Error(`${methode} ${chemin.split("?")[0]} : ${reponse.status} ${texte.slice(0, 200)}`);
  return data;
}

async function toutLire(chemin) {
  const lignes = [];
  for (let debut = 0; ; debut += 1000) {
    const reponse = await fetch(`${SUPABASE}/rest/v1/${chemin}`, {
      headers: { apikey: CLE, Authorization: `Bearer ${CLE}`, Range: `${debut}-${debut + 999}` },
    });
    if (!reponse.ok) throw new Error(`GET ${chemin.split("?")[0]} : ${reponse.status}`);
    const page = await reponse.json();
    lignes.push(...page);
    if (page.length < 1000) return lignes;
  }
}

const secret = async (org, kind) => base("POST", "rpc/radar_get_secret", { org, kind });

// ------------------------------- Calendly ----------------------------------

let JETON;
async function calendly(url) {
  for (let essai = 0; ; essai++) {
    const reponse = await fetch(url, { headers: { Authorization: `Bearer ${JETON}` } });
    if (reponse.status === 429 && essai < 5) {
      await new Promise((r) => setTimeout(r, 2000 * (essai + 1)));
      continue;
    }
    if (!reponse.ok) throw new Error(`Calendly ${reponse.status} sur ${new URL(url).pathname}`);
    return reponse.json();
  }
}

async function evenements(utilisateur) {
  const liste = [];
  let url =
    "https://api.calendly.com/scheduled_events?" +
    new URLSearchParams({
      user: utilisateur,
      min_start_time: new Date(`${DEPUIS}T00:00:00+02:00`).toISOString(),
      max_start_time: new Date(`${JUSQUA}T00:00:00+02:00`).toISOString(),
      count: "100",
      sort: "start_time:asc",
    });
  while (url) {
    const page = await calendly(url);
    liste.push(...page.collection);
    url = page.pagination?.next_page ?? null;
  }
  return liste;
}

// --------------------------------- Lecture ---------------------------------

const [org] = await base("GET", `organizations?slug=eq.${encodeURIComponent(SLUG)}&select=id,name`);
if (!org) throw new Error(`Aucun client « ${SLUG} ».`);

const [reglages] = await base(
  "GET",
  `radar_settings?organization_id=eq.${org.id}&select=window_days,currency,calendly_user_uri,connected_at`,
);
if (!reglages?.connected_at || !reglages.calendly_user_uri) throw new Error("Calendly n'est pas relié pour ce client.");

const [admin] = await base("GET", `profiles?email=eq.${encodeURIComponent(PAR)}&is_admin=eq.true&select=id`);
if (!admin) throw new Error(`« ${PAR} » n'est pas un compte admin.`);

const releves = await base("GET", `radar_statements?organization_id=eq.${org.id}&select=month`);
const moisClotures = new Set((releves ?? []).map((r) => r.month.slice(0, 7)));

JETON = await secret(org.id, "token");
const SEL = await secret(org.id, "salt");
if (!JETON || !SEL) throw new Error("Jeton Calendly ou sel introuvable dans le Vault.");

const canaux = (
  await base("GET", `radar_channels?organization_id=eq.${org.id}&select=id,key,label,is_comete,rules,sort_order,is_active`)
).map((c) => ({ ...c, rules: c.rules ?? {} }));
const libelleCanal = Object.fromEntries(canaux.map((c) => [c.id, c.label]));
const filtres = await base("GET", `radar_event_filters?organization_id=eq.${org.id}&select=id,event_type_uri,event_type_name,tracked`);
const filtreParUri = new Map(filtres.map((f) => [f.event_type_uri, f]));

const existantes = await toutLire(
  `radar_bookings?organization_id=eq.${org.id}&select=id,invitee_uri,invitee_key,channel_id,attribution,scheduled_start,status,sale_amount_cents,utm&order=id.asc`,
);
const parInvite = new Map(existantes.map((b) => [b.invitee_uri, b]));
const activites = await toutLire(
  `radar_booking_activities?organization_id=eq.${org.id}&type=in.(sale.declined,booking.imported)&select=booking_id,type&order=id.asc`,
);
const refus = new Set(activites.filter((a) => a.type === "sale.declined").map((a) => a.booking_id));
const reprises = new Set(activites.filter((a) => a.type === "booking.imported").map((a) => a.booking_id));

// ------------------------------- Décisions ---------------------------------

const compte = {};
const noter = (cle) => (compte[cle] = (compte[cle] || 0) + 1);
const aCreer = [];
const aCompleter = [];
const sansIssue = [];
const typesAjoutes = new Map();

const jourParis = (instant) => new Date(instant).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
const aujourdhui = jourParis(new Date());
const RIEN = ["inconnue", "hors_import"];

/** Les `utm` posés par le site sur ses propres liens ne disent rien de l'origine. */
const utmDuSite = (utm) => Object.keys(utm).length === 0 || utm.utm_source === "site";
const utmAGarder = (utmCalendly, e) =>
  e?.utm && Object.keys(e.utm).length > 0 && utmDuSite(utmCalendly) ? utmRetenus(e.utm) : utmCalendly;

/** Ce qu'une ligne déjà dans Radar peut encore recevoir du fichier. */
function completer(deja, e) {
  if (!e) return null;
  const gestes = [];
  if (reprises.has(deja.id) && e.utm && Object.keys(e.utm).length > 0 && utmDuSite(deja.utm ?? {})) gestes.push("utm");
  if (deja.status !== "annule" && deja.sale_amount_cents == null) {
    if (e.issue === "vendue") gestes.push("vente");
    else if (e.issue === "absente" && deja.status !== "no_show") gestes.push("absente");
    else if (["venue_sans_vente", "venue_non_confirmee"].includes(e.issue) && !refus.has(deja.id)) gestes.push("pas_de_vente");
  }
  return gestes.length ? gestes : null;
}

for (const ev of await evenements(reglages.calendly_user_uri)) {
  const typeUri = ev.event_type ?? null;
  const filtre = typeUri ? filtreParUri.get(typeUri) : undefined;
  if (filtre && !filtre.tracked) { noter("type coupé, laissé dehors"); continue; }
  if (!filtre) {
    if (!/^RDV diagnostic offert/i.test(ev.name ?? "")) { noter(`type non suivi, laissé dehors : ${ev.name}`); continue; }
    if (typeUri) typesAjoutes.set(typeUri, ev.name.slice(0, 200));
  }

  const e = issues[ev.uri];
  const issue = e?.issue ?? "inconnue";
  const invites = (await calendly(`${ev.uri}/invitees?count=100`)).collection;

  for (const invite of invites) {
    const deja = parInvite.get(invite.uri);
    if (deja) {
      const gestes = completer(deja, e);
      if (!gestes) { noter("déjà dans Radar, rien à ajouter"); continue; }
      aCompleter.push({ booking: deja, gestes, e });
      for (const g of gestes) noter(`déjà dans Radar, complété : ${g}`);
      continue;
    }

    const annuleCalendly = invite.status === "canceled";
    const aVenir = Date.parse(ev.start_time) > Date.now();
    let decision = issue;
    if (annuleCalendly) decision = "annule";
    else if (RIEN.includes(issue)) {
      if (aVenir && issue === "inconnue") decision = "a_venir";
      else { noter(`passé sans issue (${issue}), laissé dehors`); sansIssue.push(ev.start_time); continue; }
    }
    if (annuleCalendly && issue === "vendue") { noter("annulé dans Calendly mais vendu selon le fichier : laissé dehors, à regarder"); continue; }
    if (!invite.email) { noter("invité sans email, laissé dehors"); continue; }

    aCreer.push({
      invitee_uri: invite.uri,
      event_uri: ev.uri,
      email: invite.email,
      identite: nomInvite(invite),
      debut: ev.start_time,
      fin: ev.end_time,
      reserve_le: invite.created_at,
      type_nom: ev.name,
      type_uri: typeUri,
      utm: utmAGarder(utmRetenus(invite.tracking), e),
      declared_source: reponseDeclaree(invite.questions_and_answers ?? []),
      ancien_uri: invite.old_invitee ?? null,
      annule_calendly: annuleCalendly,
      reprogramme: invite.rescheduled,
      annule_le: annuleCalendly ? (invite.cancellation?.created_at ?? invite.updated_at) : null,
      decision,
      e,
      origine: "calendly",
    });
  }
}

for (const m of manuels) {
  const deja = parInvite.get(m.invitee_uri);
  if (deja) {
    const gestes = completer(deja, m);
    if (!gestes) { noter("manuel déjà dans Radar, rien à ajouter"); continue; }
    aCompleter.push({ booking: deja, gestes, e: m });
    for (const g of gestes) noter(`manuel déjà dans Radar, complété : ${g}`);
    continue;
  }
  if (m.issue === "hors_import") { noter("manuel hors import"); continue; }
  const aVenir = Date.parse(m.scheduled_start) > Date.now();
  if (m.issue === "inconnue" && !aVenir) { noter("manuel passé sans issue, laissé dehors"); sansIssue.push(m.scheduled_start); continue; }
  aCreer.push({
    invitee_uri: m.invitee_uri,
    event_uri: m.event_uri,
    email: m.email,
    identite: nomInvite({ first_name: m.prenom, last_name: m.nom }),
    debut: m.scheduled_start,
    fin: m.scheduled_end,
    reserve_le: m.scheduled_start,
    type_nom: m.event_type_name,
    type_uri: null,
    utm: m.utm ? utmRetenus(m.utm) : {},
    declared_source: null,
    ancien_uri: null,
    annule_calendly: false,
    reprogramme: false,
    annule_le: null,
    decision: m.issue === "inconnue" ? "a_venir" : m.issue,
    e: m,
    origine: "hors Calendly",
  });
}

// Dans l'ordre des réservations : une séance reprogrammée est réservée après
// celle qu'elle remplace, même quand elle a lieu avant.
aCreer.sort((a, b) => Date.parse(a.reserve_le) - Date.parse(b.reserve_le));

const historique = new Map();
for (const b of existantes) {
  if (!historique.has(b.invitee_key)) historique.set(b.invitee_key, []);
  historique.get(b.invitee_key).push(b);
}

const NOTES = {
  venue_non_confirmee: `Présence non confirmée : « pas signé » au point du ${REPRISE}`,
  issue_inconnue: "Issue inconnue : jamais notée par le client",
};

const lignes = [];
for (const item of aCreer) {
  const { e, decision } = item;
  const cle = cleInvite(SEL, item.email);
  const ancien = item.ancien_uri ? parInvite.get(item.ancien_uri) : null;
  const heritage = ancien ?? null;

  const canalConnu = e?.canal ? canaux.find((c) => c.key === e.canal && c.is_active) : null;
  const verdict = heritage
    ? { channel_id: heritage.channel_id, attribution: heritage.attribution, source: heritage.id ?? null }
    : canalConnu
      ? { channel_id: canalConnu.id, attribution: "manuel", source: null }
      : attribuer({
          utm: utmDuSite(item.utm) ? {} : item.utm,
          scheduledStart: item.debut,
          channels: canaux,
          previous: precedent(historique.get(cle) ?? [], item.debut),
          windowDays: reglages.window_days,
        });

  const statut = decision === "annule" ? "annule" : decision === "absente" ? "no_show" : "confirme";

  let vente = null;
  if (decision === "vendue") {
    const d = e.date_vente < jourParis(item.debut) ? jourParis(item.debut) : e.date_vente;
    if (d > aujourdhui) noter("vente datée dans le futur : ligne reprise sans la vente");
    else if (moisClotures.has(d.slice(0, 7))) noter("vente dans un mois clôturé : ligne reprise sans la vente");
    else {
      if (d !== e.date_vente) noter("date de vente antérieure au rendez-vous, ramenée au jour du rendez-vous");
      vente = { montant: e.montant_cents, date: d, offre: e.offre ? String(e.offre).slice(0, 200) : null };
    }
  }

  let note = e?.note ?? NOTES[decision] ?? null;
  if (statut === "annule") {
    note = item.annule_calendly ? motifAnnulation(item.reprogramme) : "Annulé ou reprogrammé hors Calendly, selon le client";
  }

  const ligne = {
    organization_id: org.id,
    invitee_uri: item.invitee_uri,
    event_uri: item.event_uri,
    invitee_key: cle,
    invitee_first_name: item.identite.prenom,
    invitee_last_name: item.identite.nom,
    scheduled_start: item.debut,
    scheduled_end: item.fin,
    event_type_name: item.type_nom,
    event_type_uri: item.type_uri,
    utm: item.utm,
    declared_source: item.declared_source,
    channel_id: verdict.channel_id,
    attribution: verdict.attribution,
    attribution_note:
      verdict.attribution === "manuel" && !heritage ? `Canal du premier contact enregistré par le site (reprise du ${REPRISE})` : null,
    attribution_source_id: verdict.source,
    status: statut,
    status_origin: statut === "no_show" || (statut === "annule" && !item.annule_calendly) ? "admin" : "calendly",
    status_note: note,
    canceled_at: statut === "annule" ? item.annule_le : null,
    amount_cents: 0,
    currency: reglages.currency,
    payment_ok: false,
    rescheduled_from: heritage?.id ?? null,
    sale_amount_cents: vente?.montant ?? null,
    sale_date: vente?.date ?? null,
    sale_note: vente?.offre ?? null,
    sale_recorded_by: vente ? admin.id : null,
    sale_recorded_at: vente ? new Date().toISOString() : null,
  };

  // Pour les suivantes du lot : cette ligne existe désormais.
  const reference = {
    id: null,
    invitee_uri: item.invitee_uri,
    channel_id: verdict.channel_id,
    attribution: verdict.attribution,
    scheduled_start: item.debut,
    status: statut,
  };
  parInvite.set(item.invitee_uri, reference);
  if (!historique.has(cle)) historique.set(cle, []);
  historique.get(cle).push(reference);

  lignes.push({ ligne, decision, vente, reference, ancienUri: heritage ? item.ancien_uri : null, origine: item.origine });
  noter(`à reprendre (${item.origine}) : ${decision}`);
}

// ------------------------------ Compte-rendu -------------------------------

const ventesCompletees = aCompleter.filter((c) => c.gestes.includes("vente"));
const somme =
  lignes.reduce((s, l) => s + (l.vente?.montant ?? 0), 0) + ventesCompletees.reduce((s, c) => s + c.e.montant_cents, 0);
const parCanal = {};
for (const { ligne } of lignes) {
  const cle = `${libelleCanal[ligne.channel_id] ?? "sans canal"} (${ligne.attribution})`;
  parCanal[cle] = (parCanal[cle] || 0) + 1;
}

console.log(`\n${org.name} — du ${DEPUIS} au ${JUSQUA} — ${ECRIRE ? "ÉCRITURE" : "essai à blanc, rien n'est écrit"}\n`);
for (const [cle, n] of Object.entries(compte).sort()) console.log(`  ${String(n).padStart(4)}  ${cle}`);
console.log(`\n  Lignes à créer : ${lignes.length}, à compléter : ${aCompleter.length}`);
console.log(`  Ventes posées : ${lignes.filter((l) => l.vente).length + ventesCompletees.length}, ${(somme / 100).toLocaleString("fr-FR")} €`);
if (lignes.length) {
  console.log("  Canaux des lignes créées :");
  for (const [cle, n] of Object.entries(parCanal).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${cle}`);
}
if (typesAjoutes.size) console.log(`  Types de séance ajoutés aux suivis : ${[...typesAjoutes.values()].join(" ; ")}`);
if (sansIssue.length) console.log(`  Passés sans issue connue, laissés dehors (dates) : ${sansIssue.map(jourParis).join(", ")}`);

if (!ECRIRE) {
  console.log("\nRelancer avec --ecrire pour écrire.\n");
  process.exit(0);
}

// -------------------------------- Écriture ---------------------------------

const activite = (booking_id, type, payload, user_id = admin.id) =>
  base("POST", "radar_booking_activities", { booking_id, organization_id: org.id, user_id, type, payload }, "return=minimal");
const maintenant = () => new Date().toISOString();

for (const [uri, nomType] of typesAjoutes) {
  await base(
    "POST",
    "radar_event_filters?on_conflict=organization_id,event_type_uri",
    { organization_id: org.id, event_type_uri: uri, event_type_name: nomType },
    "resolution=ignore-duplicates,return=minimal",
  );
}

let crees = 0;
for (const l of lignes) {
  if (l.ancienUri) {
    const ancien = parInvite.get(l.ancienUri);
    l.ligne.rescheduled_from = ancien?.id ?? null;
    l.ligne.attribution_source_id = ancien?.id ?? null;
  }
  if (l.ligne.attribution === "recurrence" && !l.ligne.attribution_source_id) {
    // La source était une ligne du même lot : on la retrouve maintenant qu'elle a un id.
    const source = precedent(historique.get(l.ligne.invitee_key).filter((b) => b.id), l.ligne.scheduled_start);
    l.ligne.attribution_source_id = source?.id ?? null;
  }
  const [cree] = await base("POST", "radar_bookings", l.ligne);
  l.reference.id = cree.id;
  crees++;

  await activite(
    cree.id,
    "booking.imported",
    {
      origine: l.origine,
      attribution: l.ligne.attribution,
      utm: l.ligne.utm,
      reprise: REPRISE,
      ...(l.ligne.rescheduled_from ? { rescheduled_from: l.ligne.rescheduled_from } : {}),
    },
    null,
  );
  if (l.ligne.status === "no_show") await activite(cree.id, "status.changed", { from: "confirme", to: "no_show", reprise: true });
  if (l.vente) {
    await activite(cree.id, "sale.recorded", {
      montant_cents: l.vente.montant,
      date: l.vente.date,
      note_presente: Boolean(l.vente.offre),
      montant_precedent: null,
      date_precedente: null,
    });
  } else if (["venue_sans_vente", "venue_non_confirmee"].includes(l.decision)) {
    await activite(cree.id, "sale.declined", {});
  }
}

let completes = 0;
for (const { booking, gestes, e } of aCompleter) {
  for (const geste of gestes) {
    if (geste === "utm") {
      await base("PATCH", `radar_bookings?id=eq.${booking.id}`, { utm: utmRetenus(e.utm), updated_at: maintenant() }, "return=minimal");
    } else if (geste === "vente") {
      const d = e.date_vente < jourParis(booking.scheduled_start) ? jourParis(booking.scheduled_start) : e.date_vente;
      if (d > aujourdhui || moisClotures.has(d.slice(0, 7))) continue;
      await base(
        "PATCH",
        `radar_bookings?id=eq.${booking.id}`,
        {
          sale_amount_cents: e.montant_cents,
          sale_date: d,
          sale_note: e.offre ? String(e.offre).slice(0, 200) : null,
          sale_recorded_by: admin.id,
          sale_recorded_at: maintenant(),
          updated_at: maintenant(),
        },
        "return=minimal",
      );
      await activite(booking.id, "sale.recorded", { montant_cents: e.montant_cents, date: d, note_presente: Boolean(e.offre), montant_precedent: null, date_precedente: null });
    } else if (geste === "absente") {
      await base("PATCH", `radar_bookings?id=eq.${booking.id}`, { status: "no_show", status_origin: "admin", updated_at: maintenant() }, "return=minimal");
      await activite(booking.id, "status.changed", { from: booking.status, to: "no_show", reprise: true });
    } else if (geste === "pas_de_vente") {
      if (e.issue === "venue_non_confirmee") {
        await base("PATCH", `radar_bookings?id=eq.${booking.id}`, { status_note: NOTES.venue_non_confirmee, updated_at: maintenant() }, "return=minimal");
      }
      await activite(booking.id, "sale.declined", {});
    }
  }
  completes++;
}

console.log(`\nÉcrit : ${crees} lignes créées, ${completes} complétées.\n`);
