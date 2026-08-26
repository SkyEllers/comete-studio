/**
 * Le client « Démo » de Radar.
 *
 *   node scripts/demo-radar.mjs
 *
 * Un vrai client, pas un décor de banc : il reste en place pour que Louis
 * juge l'outil sur son téléphone. Deux mois de rendez-vous plausibles,
 * plusieurs canaux, une récurrence, un non-venu, une annulation, une séance
 * gratuite — de quoi voir chaque état de l'interface sans en fabriquer.
 *
 * Les clés d'invité sont de vrais HMAC, calculés comme le ferait le webhook :
 * les prénoms qui servent à les produire ne sortent jamais de ce fichier, et
 * rien de personnel n'entre en base. Deux séances de la même personne portent
 * la même clé, ce qui rend la récurrence lisible dans les données comme dans
 * l'écran.
 *
 * La connexion Calendly est simulée : `connected_at` est posé pour que
 * l'interface se lise, une clé de signature et un sel sont rangés dans le
 * Vault, mais aucun abonnement n'existe chez Calendly et il n'y a pas de
 * jeton. « Tester la connexion » répondra donc, à raison, que le jeton est
 * introuvable.
 *
 * Le script refuse de s'exécuter deux fois : à supprimer depuis /admin quand
 * la phase 4 sera close.
 */
import { createHmac } from "node:crypto";

import { annoncerCible, creer, srv } from "./qa-commun.mjs";

const { CANAUX_PAR_DEFAUT } = await import("../src/tools/resultats/attribution.ts");

annoncerCible("Client de démonstration — Radar");

const SLUG = "demo";
const MEMBRE = "7aae9430-3323-482e-99e5-4c8b7c838429"; // louisgirault1905@gmail.com
const SEL = "sel-de-demonstration-a-ne-pas-reutiliser-ailleurs";

const deja = (await srv("GET", `organizations?select=id&slug=eq.${SLUG}`)).data;
if (deja.length > 0) {
  console.error(
    `Le client « ${SLUG} » existe déjà (${deja[0].id}). Supprime-le depuis /admin avant de rejouer ce script.`,
  );
  process.exit(1);
}

// --------------------------------- Décor -----------------------------------

const org = await creer("organizations", { name: "Démo", slug: SLUG });
await creer("memberships", {
  organization_id: org.id,
  user_id: MEMBRE,
  role: "owner",
});

const outil = (await srv("GET", "tools?select=id&slug=eq.resultats")).data[0];
await creer("organization_tools", {
  organization_id: org.id,
  tool_id: outil.id,
  enabled: true,
});

await creer("radar_settings", {
  organization_id: org.id,
  commission_rate: 20,
  window_days: 90,
  currency: "EUR",
  connected_at: "2026-06-28T09:12:00+02:00",
  last_webhook_at: new Date().toISOString(),
  calendly_user_uri: "https://api.calendly.com/users/DEMO-UTILISATEUR",
  calendly_org_uri: "https://api.calendly.com/organizations/DEMO-ORGANISATION",
});

await srv("POST", "rpc/radar_set_secret", {
  org: org.id,
  kind: "signing_key",
  value: "cle-de-signature-de-demonstration-0123456789abcdef",
});
await srv("POST", "rpc/radar_set_secret", { org: org.id, kind: "salt", value: SEL });

const canaux = {};
for (const canal of CANAUX_PAR_DEFAUT) {
  const cree = await creer("radar_channels", {
    organization_id: org.id,
    key: canal.key,
    label: canal.label,
    is_comete: canal.is_comete,
    rules: canal.rules,
    sort_order: canal.sort_order,
  });
  canaux[canal.key] = cree.id;
}

// ------------------------------ Rendez-vous ---------------------------------

/** La clé d'invité, calculée comme le fait le webhook. L'email s'arrête ici. */
const cle = (prenom) =>
  createHmac("sha256", SEL).update(`${prenom}@exemple.fr`).digest("hex");

const UTM = {
  google_ads: { utm_source: "google", utm_medium: "cpc", utm_campaign: "suivi-rentree" },
  meta: { utm_source: "instagram", utm_medium: "paid", utm_campaign: "temoignages" },
  seo: { utm_source: "google", utm_medium: "organic" },
};

let compteur = 0;

async function seance({
  debut,
  minutes = 60,
  canal,
  attribution = "utm",
  personne,
  montant = 9000,
  paye = true,
  nom = "Séance de suivi",
  statut = "confirme",
  origineStatut = "calendly",
  noteStatut = null,
  declare = null,
  source = null,
}) {
  compteur += 1;
  const fin = new Date(Date.parse(debut) + minutes * 60000).toISOString();

  const rdv = await creer("radar_bookings", {
    organization_id: org.id,
    invitee_uri: `https://api.calendly.com/scheduled_events/demo/invitees/${compteur}`,
    event_uri: `https://api.calendly.com/scheduled_events/demo-${compteur}`,
    invitee_key: cle(personne),
    scheduled_start: debut,
    scheduled_end: fin,
    event_type_name: nom,
    event_type_uri: "https://api.calendly.com/event_types/DEMO",
    utm: attribution === "utm" ? (UTM[canal] ?? {}) : {},
    declared_source: declare,
    channel_id: canaux[canal],
    attribution,
    attribution_source_id: source,
    status: statut,
    status_origin: origineStatut,
    status_note: noteStatut,
    amount_cents: montant,
    currency: "EUR",
    payment_ok: montant > 0 && paye,
    payment_ref: montant > 0 && paye ? `ch_3QDemo${String(compteur).padStart(4, "0")}` : null,
    canceled_at: statut === "annule" ? debut : null,
  });

  await creer("radar_booking_activities", {
    booking_id: rdv.id,
    organization_id: org.id,
    type: "booking.created",
    payload: { attribution, utm: attribution === "utm" ? (UTM[canal] ?? {}) : {} },
  });

  if (statut !== "confirme") {
    await creer("radar_booking_activities", {
      booking_id: rdv.id,
      organization_id: org.id,
      user_id: origineStatut === "client" ? MEMBRE : null,
      type: statut === "annule" ? "booking.canceled" : "status.changed",
      payload: { to: statut, origin: origineStatut },
    });
  }

  return rdv;
}

// ------------------------------ Juillet 2026 --------------------------------

const camilleJuillet = await seance({
  debut: "2026-07-03T10:00:00+02:00",
  canal: "google_ads",
  personne: "camille",
  declare: "Google",
  nom: "Première séance",
});
const inesJuillet = await seance({
  debut: "2026-07-07T14:00:00+02:00",
  canal: "meta",
  personne: "ines",
  declare: "Instagram",
  nom: "Première séance",
});
await seance({
  debut: "2026-07-09T09:00:00+02:00",
  canal: "bouche_a_oreille",
  attribution: "direct",
  personne: "sarah",
  declare: "Bouche à oreille",
});
await seance({
  debut: "2026-07-15T16:30:00+02:00",
  canal: "google_ads",
  personne: "marion",
  declare: "Google",
});
await seance({
  debut: "2026-07-18T11:00:00+02:00",
  canal: "seo",
  personne: "julie",
  declare: "Recherche Google",
  nom: "Première séance",
});
await seance({
  debut: "2026-07-22T17:00:00+02:00",
  minutes: 30,
  canal: "google_ads",
  personne: "lea",
  montant: 0,
  nom: "Appel découverte",
  declare: "Google",
});
await seance({
  debut: "2026-07-24T10:00:00+02:00",
  canal: "meta",
  personne: "noemie",
  statut: "annule",
  noteStatut: "Annulée dans Calendly",
  declare: "Instagram ou Facebook",
});
await seance({
  debut: "2026-07-29T15:00:00+02:00",
  canal: "direct",
  attribution: "direct",
  personne: "anne",
});

// -------------------------------- Août 2026 ---------------------------------

await seance({
  debut: "2026-08-04T10:00:00+02:00",
  canal: "google_ads",
  personne: "elodie",
  declare: "Google",
  nom: "Première séance",
});
// Camille revient : son canal vient de sa séance du 3 juillet.
await seance({
  debut: "2026-08-06T10:00:00+02:00",
  canal: "google_ads",
  attribution: "recurrence",
  source: camilleJuillet.id,
  personne: "camille",
  declare: "Bouche à oreille",
});
// Deux séances de plus qu'en juillet : sans écart entre les mois, toutes les
// comparaisons du tableau de bord diraient « autant qu'en juillet », et on ne
// verrait pas à quoi elles ressemblent.
await seance({
  debut: "2026-08-07T09:00:00+02:00",
  canal: "google_ads",
  personne: "aurore",
  declare: "Google",
});
await seance({
  debut: "2026-08-19T10:00:00+02:00",
  canal: "meta",
  personne: "nadia",
  declare: "Instagram ou Facebook",
  nom: "Première séance",
});
await seance({
  debut: "2026-08-11T14:00:00+02:00",
  canal: "meta",
  personne: "farah",
  declare: "Instagram",
  nom: "Première séance",
});
await seance({
  debut: "2026-08-13T09:00:00+02:00",
  canal: "seo",
  personne: "claire",
  statut: "no_show",
  origineStatut: "client",
  noteStatut: "Ne s'est pas présentée",
  declare: "Recherche Google",
});
await seance({
  debut: "2026-08-18T16:30:00+02:00",
  canal: "bouche_a_oreille",
  attribution: "direct",
  personne: "sarah",
  declare: "Bouche à oreille",
});
await seance({
  debut: "2026-08-20T17:00:00+02:00",
  minutes: 30,
  canal: "meta",
  personne: "manon",
  montant: 0,
  nom: "Appel découverte",
  declare: "Instagram",
});
// Inès revient : son canal vient de sa séance du 7 juillet.
await seance({
  debut: "2026-08-24T14:00:00+02:00",
  canal: "meta",
  attribution: "recurrence",
  source: inesJuillet.id,
  personne: "ines",
});
await seance({
  debut: "2026-08-28T11:00:00+02:00",
  canal: "google_ads",
  personne: "lucie",
  declare: "Google",
  nom: "Première séance",
});

// --------------------------------- Bilan ------------------------------------

const lignes = (
  await srv(
    "GET",
    `radar_bookings_effective?select=mois,effective_status,counts_for_commission,amount_cents&organization_id=eq.${org.id}`,
  )
).data;

const parMois = {};
for (const ligne of lignes) {
  const bilan = (parMois[ligne.mois] ??= { total: 0, comptees: 0, base: 0 });
  bilan.total += 1;
  if (ligne.counts_for_commission) {
    bilan.comptees += 1;
    bilan.base += ligne.amount_cents;
  }
}

console.log(`\nClient « Démo » créé : ${org.id}`);
console.log(`Membre : louisgirault1905@gmail.com · espace /app/${SLUG}/resultats\n`);
for (const [mois, bilan] of Object.entries(parMois).sort()) {
  console.log(
    `${mois} — ${bilan.total} rendez-vous, ${bilan.comptees} comptés, base ${(bilan.base / 100).toFixed(0)} €, commission ${((bilan.base * 0.2) / 100).toFixed(0)} €`,
  );
}
