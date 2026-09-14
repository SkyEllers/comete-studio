/**
 * Reprendre dans Radar les rendez-vous d'avant son branchement.
 *
 * Radar n'importe aucun historique : il ne connaît que ce que le webhook a reçu
 * depuis la connexion du Calendly d'un client. Ce script comble le trou, une
 * fois, pour un client dont on connaît l'issue de chaque rendez-vous passé.
 *
 *   node scripts/radar-import-historique.mjs --org <slug> --issues <fichier.json>
 *        --depuis AAAA-MM-JJ --jusqua AAAA-MM-JJ [--par <email admin>] [--ecrire]
 *
 * Sans `--ecrire`, rien ne part en base : le script lit Calendly et Radar, et
 * dit ce qu'il ferait. Aucun nom ni email n'est affiché, dans aucun mode.
 *
 * Pourquoi un fichier d'issues, et pourquoi il est obligatoire. Radar pose
 * « honoré » tout seul sur un rendez-vous passé non contesté. Importer un
 * rendez-vous dont on ignore l'issue, c'est donc le déclarer venu. Le fichier
 * dit, pour chaque événement Calendly (clé : l'URI du `scheduled_event`), ce
 * qui s'est passé : `vendue` (montant en centimes, date, offre), `venue_sans_vente`,
 * `venue_non_confirmee`, `absente`, `annule`, `inconnue`, `hors_import`. Un
 * rendez-vous passé sans issue connue n'est pas importé, et le compte-rendu en
 * donne les dates ; un rendez-vous à venir entre, comme au webhook. Le fichier
 * peut aussi porter `canal`, la clé du canal Radar du premier contact quand le
 * site du client l'a enregistré : Calendly, lui, ne garde souvent que les `utm`
 * que le site pose sur ses propres liens. Aucune donnée nominative : le fichier
 * reste hors du dépôt.
 *
 * Ce qui est écrit, et comment, suit le webhook au plus près :
 *   - même clé d'invité (HMAC du sel du client), même nom, mêmes `utm` retenus,
 *     même réponse déclarée, même attribution (`attribuer`, `precedent`), même
 *     héritage de canal pour une séance reprogrammée ;
 *   - seuls les types de séance suivis entrent. Un type inconnu entre s'il
 *     s'appelle « RDV diagnostic offert… », et il est ajouté aux types suivis ;
 *     tout autre type inconnu est laissé dehors et compté ;
 *   - une vente respecte les gardes de `radar_set_sale` : ni sur une séance
 *     annulée ou non venue, ni datée avant le rendez-vous, ni dans le futur ;
 *   - chaque ligne reprise porte une activité `booking.imported`, et ses gestes
 *     (vente, pas de vente, non venu) leurs activités habituelles, signées du
 *     compte admin passé en `--par`.
 *
 * Une ligne déjà dans Radar (même `invitee_uri`) n'est jamais recréée. Si le
 * fichier lui donne une issue qu'elle n'a pas encore — vente, non venu, pas de
 * vente —, elle la reçoit. Relancer le script ne fait rien de plus.
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

const ISSUES_CONNUES = new Set([
  "vendue",
  "venue_sans_vente",
  "venue_non_confirmee",
  "absente",
  "annule",
  "inconnue",
  "hors_import",
]);
const fichier = JSON.parse(readFileSync(FICHIER, "utf8"));
const issues = fichier.issues ?? {};
for (const [uri, e] of Object.entries(issues)) {
  if (!ISSUES_CONNUES.has(e.issue)) throw new Error(`Issue inconnue dans le fichier : ${e.issue}`);
  if (e.issue === "vendue" && (!Number.isInteger(e.montant_cents) || !jour.test(e.date_vente ?? ""))) {
    throw new Error(`Vente sans montant ou sans date pour ${uri.slice(-12)}`);
  }
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

const canaux = (await base("GET", `radar_channels?organization_id=eq.${org.id}&select=id,key,label,is_comete,rules,sort_order,is_active`)).map(
  (c) => ({ ...c, rules: c.rules ?? {} }),
);
const libelleCanal = Object.fromEntries(canaux.map((c) => [c.id, c.label]));
const filtres = await base("GET", `radar_event_filters?organization_id=eq.${org.id}&select=id,event_type_uri,event_type_name,tracked`);
const filtreParUri = new Map(filtres.map((f) => [f.event_type_uri, f]));

const existantes = await toutLire(
  `radar_bookings?organization_id=eq.${org.id}&select=id,invitee_uri,invitee_key,channel_id,attribution,scheduled_start,status,sale_amount_cents,status_note&order=id.asc`,
);
const parInvite = new Map(existantes.map((b) => [b.invitee_uri, b]));
const refus = new Set(
  (await toutLire(`radar_booking_activities?organization_id=eq.${org.id}&type=eq.sale.declined&select=booking_id&order=id.asc`)).map(
    (a) => a.booking_id,
  ),
);

// ------------------------------- Décisions ---------------------------------

const compte = {};
const noter = (cle) => (compte[cle] = (compte[cle] || 0) + 1);
const aCreer = [];
const aCompleter = [];
const sansIssue = [];
const typesAjoutes = new Map();

const jourParis = (instant) => new Date(instant).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
const aujourdhui = jourParis(new Date());

for (const ev of await evenements(reglages.calendly_user_uri)) {
  const typeUri = ev.event_type ?? null;
  const filtre = typeUri ? filtreParUri.get(typeUri) : undefined;
  if (filtre && !filtre.tracked) { noter("type coupé, laissé dehors"); continue; }
  if (!filtre) {
    if (!/^RDV diagnostic offert/i.test(ev.name ?? "")) { noter(`type non suivi, laissé dehors : ${ev.name}`); continue; }
    if (typeUri) typesAjoutes.set(typeUri, ev.name.slice(0, 200));
  }

  const issue = issues[ev.uri]?.issue ?? "inconnue";
  const invites = (await calendly(`${ev.uri}/invitees?count=100`)).collection;

  for (const invite of invites) {
    const deja = parInvite.get(invite.uri);
    const annuleCalendly = invite.status === "canceled";

    if (deja) {
      // Déjà dans Radar : seulement ce qui lui manque.
      if (deja.status === "annule") { noter("déjà dans Radar, annulé"); continue; }
      const e = issues[ev.uri];
      if (!e || ["inconnue", "annule", "hors_import"].includes(e.issue)) { noter("déjà dans Radar, rien à ajouter"); continue; }
      if (e.issue === "vendue" && deja.sale_amount_cents == null) aCompleter.push({ booking: deja, geste: "vente", e });
      else if (e.issue === "absente" && deja.status !== "no_show" && deja.sale_amount_cents == null) aCompleter.push({ booking: deja, geste: "absente", e });
      else if (["venue_sans_vente", "venue_non_confirmee"].includes(e.issue) && deja.sale_amount_cents == null && !refus.has(deja.id))
        aCompleter.push({ booking: deja, geste: "pas_de_vente", e });
      else { noter("déjà dans Radar, rien à ajouter"); continue; }
      noter(`déjà dans Radar, complété : ${aCompleter.at(-1).geste}`);
      continue;
    }

    const aVenir = Date.parse(ev.start_time) > Date.now();
    if (!annuleCalendly && aVenir && issue === "inconnue") {
      // Réservé avant le branchement de Radar, pour une date qui n'est pas
      // encore passée : rien à présumer, la ligne entre comme au webhook.
      aCreer.push({ ev, invite, issue: "a_venir", e: issues[ev.uri] });
      continue;
    }
    if (!annuleCalendly && ["inconnue", "annule", "hors_import"].includes(issue)) {
      noter(`actif sans issue exploitable (${issue}), laissé dehors`);
      sansIssue.push(ev.start_time);
      continue;
    }
    if (annuleCalendly && issue === "vendue") {
      noter("annulé dans Calendly mais vendu selon le fichier : laissé dehors, à regarder");
      continue;
    }
    if (!invite.email) { noter("invité sans email, laissé dehors"); continue; }
    aCreer.push({ ev, invite, issue: annuleCalendly ? "annule" : issue, e: issues[ev.uri] });
  }
}

// Dans l'ordre des réservations : une séance reprogrammée est réservée après
// celle qu'elle remplace, même quand elle a lieu avant.
aCreer.sort((a, b) => Date.parse(a.invite.created_at) - Date.parse(b.invite.created_at));

const historique = new Map();
for (const b of existantes) {
  if (!historique.has(b.invitee_key)) historique.set(b.invitee_key, []);
  historique.get(b.invitee_key).push(b);
}

const lignes = [];
for (const item of aCreer) {
  const { ev, invite, issue, e } = item;
  const cle = cleInvite(SEL, invite.email);
  const utm = utmRetenus(invite.tracking);
  const ancien = invite.old_invitee ? parInvite.get(invite.old_invitee) : null;
  // Une séance reprogrammée n'est pas une nouvelle acquisition : elle garde le
  // canal de celle qu'elle remplace, comme dans le webhook.
  const heritage = invite.old_invitee && ancien ? ancien : null;

  /*
   * Le canal. Calendly ne garde, pour ces réservations, que les `utm` posés par
   * le site sur ses propres liens (`utm_source=site`) : ils disent d'où la
   * personne a cliqué, pas d'où elle venait. Quand le fichier connaît le canal
   * du premier contact, c'est lui qui compte, en `manuel` avec sa note ; sinon
   * l'attribution habituelle, sans les `utm` du site.
   */
  const canalConnu = e?.canal ? canaux.find((c) => c.key === e.canal && c.is_active) : null;
  const utmCampagne = utm.utm_source === "site" ? {} : utm;
  const verdict = heritage
    ? { channel_id: heritage.channel_id, attribution: heritage.attribution, source: heritage.id ?? null }
    : canalConnu
      ? { channel_id: canalConnu.id, attribution: "manuel", source: null }
      : attribuer({
          utm: utmCampagne,
          scheduledStart: ev.start_time,
          channels: canaux,
          previous: precedent(historique.get(cle) ?? [], ev.start_time),
          windowDays: reglages.window_days,
        });

  const { prenom, nom } = nomInvite(invite);
  const statut = issue === "annule" ? "annule" : issue === "absente" ? "no_show" : "confirme";

  let vente = null;
  if (issue === "vendue") {
    const d = e.date_vente < jourParis(ev.start_time) ? jourParis(ev.start_time) : e.date_vente;
    if (d > aujourdhui) { noter("vente datée dans le futur : ligne reprise sans la vente"); }
    else if (moisClotures.has(d.slice(0, 7))) { noter("vente dans un mois clôturé : ligne reprise sans la vente"); }
    else {
      if (d !== e.date_vente) noter("date de vente antérieure au rendez-vous, ramenée au jour du rendez-vous");
      vente = { montant: e.montant_cents, date: d, offre: e.offre ? String(e.offre).slice(0, 200) : null };
    }
  }

  const ligne = {
    organization_id: org.id,
    invitee_uri: invite.uri,
    event_uri: ev.uri,
    invitee_key: cle,
    invitee_first_name: prenom,
    invitee_last_name: nom,
    scheduled_start: ev.start_time,
    scheduled_end: ev.end_time,
    event_type_name: ev.name,
    event_type_uri: ev.event_type ?? null,
    utm,
    declared_source: reponseDeclaree(invite.questions_and_answers ?? []),
    channel_id: verdict.channel_id,
    attribution: verdict.attribution,
    attribution_note:
      verdict.attribution === "manuel" && !heritage
        ? `Canal du premier contact enregistré par le site (reprise du ${fichier.etabli_le ?? "fichier d'issues"})`
        : null,
    attribution_source_id: verdict.source,
    status: statut,
    status_origin: statut === "confirme" ? "calendly" : statut === "annule" ? "calendly" : "admin",
    status_note:
      statut === "annule"
        ? motifAnnulation(invite.rescheduled)
        : issue === "venue_non_confirmee"
          ? "Présence non confirmée : « pas signé » au point du 14/09/2026"
          : null,
    canceled_at: statut === "annule" ? (invite.cancellation?.created_at ?? invite.updated_at) : null,
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
  const reference = { id: null, invitee_uri: invite.uri, channel_id: verdict.channel_id, attribution: verdict.attribution, scheduled_start: ev.start_time, status: statut };
  parInvite.set(invite.uri, reference);
  if (!historique.has(cle)) historique.set(cle, []);
  historique.get(cle).push(reference);

  lignes.push({ ligne, issue, vente, reference, ancienUri: heritage ? invite.old_invitee : null });
  noter(`à reprendre : ${issue}`);
}

// ------------------------------ Compte-rendu -------------------------------

const somme = lignes.reduce((s, l) => s + (l.vente?.montant ?? 0), 0) + aCompleter.filter((c) => c.geste === "vente").reduce((s, c) => s + c.e.montant_cents, 0);
const parCanal = {};
for (const { ligne } of lignes) {
  const cle = `${libelleCanal[ligne.channel_id] ?? "sans canal"} (${ligne.attribution})`;
  parCanal[cle] = (parCanal[cle] || 0) + 1;
}

console.log(`\n${org.name} — du ${DEPUIS} au ${JUSQUA} — ${ECRIRE ? "ÉCRITURE" : "essai à blanc, rien n'est écrit"}\n`);
for (const [cle, n] of Object.entries(compte).sort()) console.log(`  ${String(n).padStart(4)}  ${cle}`);
console.log(`\n  Lignes à créer : ${lignes.length}, à compléter : ${aCompleter.length}`);
console.log(`  Ventes posées : ${lignes.filter((l) => l.vente).length + aCompleter.filter((c) => c.geste === "vente").length}, ${(somme / 100).toLocaleString("fr-FR")} €`);
console.log("  Canaux des lignes créées :");
for (const [cle, n] of Object.entries(parCanal).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${cle}`);
if (typesAjoutes.size) console.log(`  Types de séance ajoutés aux suivis : ${[...typesAjoutes.values()].join(" ; ")}`);
if (sansIssue.length) console.log(`  Passés sans issue connue, laissés dehors (dates) : ${sansIssue.map(jourParis).join(", ")}`);

if (!ECRIRE) {
  console.log("\nRelancer avec --ecrire pour écrire.\n");
  process.exit(0);
}

// -------------------------------- Écriture ---------------------------------

const activite = (booking_id, type, payload, user_id = admin.id) =>
  base("POST", "radar_booking_activities", { booking_id, organization_id: org.id, user_id, type, payload }, "return=minimal");

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
    const precedente = precedent(historique.get(l.ligne.invitee_key).filter((b) => b.id), l.ligne.scheduled_start);
    l.ligne.attribution_source_id = precedente?.id ?? null;
  }
  const [cree] = await base("POST", "radar_bookings", l.ligne);
  l.reference.id = cree.id;
  crees++;

  await activite(cree.id, "booking.imported", {
    attribution: l.ligne.attribution,
    utm: l.ligne.utm,
    reprise: fichier.etabli_le ?? null,
    ...(l.ligne.rescheduled_from ? { rescheduled_from: l.ligne.rescheduled_from } : {}),
  }, null);
  if (l.ligne.status === "no_show") await activite(cree.id, "status.changed", { from: "confirme", to: "no_show", reprise: true });
  if (l.vente) {
    await activite(cree.id, "sale.recorded", { montant_cents: l.vente.montant, date: l.vente.date, note_presente: Boolean(l.vente.offre), montant_precedent: null, date_precedente: null });
  } else if (["venue_sans_vente", "venue_non_confirmee"].includes(l.issue)) {
    await activite(cree.id, "sale.declined", {});
  }
}

let completes = 0;
for (const { booking, geste, e } of aCompleter) {
  if (geste === "vente") {
    const d = e.date_vente < jourParis(booking.scheduled_start) ? jourParis(booking.scheduled_start) : e.date_vente;
    if (d > aujourdhui || moisClotures.has(d.slice(0, 7))) continue;
    await base("PATCH", `radar_bookings?id=eq.${booking.id}`, {
      sale_amount_cents: e.montant_cents,
      sale_date: d,
      sale_note: e.offre ? String(e.offre).slice(0, 200) : null,
      sale_recorded_by: admin.id,
      sale_recorded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, "return=minimal");
    await activite(booking.id, "sale.recorded", { montant_cents: e.montant_cents, date: d, note_presente: Boolean(e.offre), montant_precedent: null, date_precedente: null });
  } else if (geste === "absente") {
    await base("PATCH", `radar_bookings?id=eq.${booking.id}`, { status: "no_show", status_origin: "admin", updated_at: new Date().toISOString() }, "return=minimal");
    await activite(booking.id, "status.changed", { from: booking.status, to: "no_show", reprise: true });
  } else {
    if (e.issue === "venue_non_confirmee") {
      await base("PATCH", `radar_bookings?id=eq.${booking.id}`, { status_note: "Présence non confirmée : « pas signé » au point du 14/09/2026", updated_at: new Date().toISOString() }, "return=minimal");
    }
    await activite(booking.id, "sale.declined", {});
  }
  completes++;
}

console.log(`\nÉcrit : ${crees} lignes créées, ${completes} complétées.\n`);
