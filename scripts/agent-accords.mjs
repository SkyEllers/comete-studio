/**
 * L'accord WhatsApp des clientes réservées avant le lancement (0046).
 *
 *   --preparer --sortie <fichier.json>
 *     Lit dans Calendly les diagnostics à venir (plus de 24 h, 60 jours au
 *     plus) du type suivi par l'agent, écarte ceux que l'agent suit déjà ou
 *     qui ont déjà un lien, et crée un lien personnel pour chacun. Le fichier
 *     de sortie (prénom, email, lien, rendez-vous) sert à l'envoi des mails :
 *     il contient des données personnelles, il ne se commite nulle part.
 *   --envoyes <fichier.json>
 *     Note `envoye_le` pour les liens du fichier, une fois les mails partis.
 *   --etat
 *     Combien de liens, d'envoyés, d'accords, de conversations ouvertes.
 *
 * Aucun mail ne part d'ici.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { env } from "./qa-commun.mjs";

import { empreinte, finNumero, jetonNeuf } from "../src/tools/agent/accords-regles.ts";
import { invitationsAVenir, jetonAgent } from "../src/tools/agent/calendly.ts";
import { peggy } from "../src/tools/agent/profils/peggy.ts";
import { effaceApres, lireReservation } from "../src/tools/agent/reservation.ts";
import { heureEnMots, jourEnMots } from "../src/tools/agent/temps.ts";

const P = "Europe/Paris";
const HEURE_MS = 3_600_000;
const JOUR_MS = 24 * HEURE_MS;
const RACINE = "https://app.cometestudio.fr";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: org } = await admin.from("organizations").select("id").eq("slug", "peggy").single();
const arg = (nom) => {
  const i = process.argv.indexOf(nom);
  return i === -1 ? null : (process.argv[i + 1] ?? "");
};

if (process.argv.includes("--preparer")) {
  const sortie = arg("--sortie");
  if (!sortie) throw new Error("--sortie <fichier.json> attendu.");

  const { data: r } = await admin
    .from("agent_reglages")
    .select("types_suivis")
    .eq("organization_id", org.id)
    .single();
  const jeton = await jetonAgent(admin, org.id);
  if (!jeton) throw new Error("Jeton Calendly de l'agent introuvable.");

  const maintenant = Date.now();
  const invitations = [];
  for (const type of r.types_suivis) {
    const lot = await invitationsAVenir(jeton, type, maintenant + JOUR_MS, maintenant + 60 * JOUR_MS);
    if (!lot) throw new Error("Calendly illisible : rien n'a été créé.");
    invitations.push(...lot);
  }

  const [{ data: suivies }, { data: liens }] = await Promise.all([
    admin.from("agent_conversations").select("invitee_uri").eq("organization_id", org.id).eq("simulation", false),
    admin.from("agent_accords").select("invitee_uri").eq("organization_id", org.id),
  ]);
  const deja = new Set([...(suivies ?? []), ...(liens ?? [])].map((x) => x.invitee_uri));

  const lignes = [];
  let sansNumero = 0;
  for (const inv of invitations) {
    if (deja.has(inv.uri)) continue;
    // Même lecture que le webhook : pas de numéro, l'agent n'écrira pas.
    const lu = lireReservation(inv, peggy, { delaiMinimumMs: 0, recuLe: new Date().toISOString() });
    if (!lu.telephone) {
      sansNumero++;
      continue;
    }
    const j = jetonNeuf();
    const { error } = await admin.from("agent_accords").insert({
      organization_id: org.id,
      jeton_sha256: empreinte(j),
      invitee_uri: inv.uri,
      rdv_debut: inv.scheduled_event.start_time,
      fin_numero: finNumero(lu.telephone),
      efface_apres: effaceApres(inv.scheduled_event.end_time),
    });
    if (error) throw new Error(`Lien non créé (${error.code}) : arrêt.`);
    lignes.push({
      invitee_uri: inv.uri,
      prenom: lu.prenom,
      email: inv.email,
      rdv: `${jourEnMots(inv.scheduled_event.start_time, P)} à ${heureEnMots(inv.scheduled_event.start_time, P)}`,
      lien: `${RACINE}/accord/${j}`,
    });
  }
  writeFileSync(sortie, JSON.stringify(lignes, null, 2), "utf8");
  console.log(`${invitations.length} rendez-vous à venir lus ; ${lignes.length} liens créés ; ${sansNumero} sans numéro ; ${invitations.length - lignes.length - sansNumero} déjà suivis ou déjà liés.`);
  process.exit(0);
}

if (arg("--envoyes") !== null) {
  const lignes = JSON.parse(readFileSync(arg("--envoyes"), "utf8"));
  const uris = lignes.map((l) => l.invitee_uri);
  const { error, count } = await admin
    .from("agent_accords")
    .update({ envoye_le: new Date().toISOString() }, { count: "exact" })
    .eq("organization_id", org.id)
    .in("invitee_uri", uris)
    .is("envoye_le", null);
  console.log(error ? `Erreur ${error.code}` : `${count} liens notés envoyés.`);
  process.exit(0);
}

if (process.argv.includes("--etat")) {
  const { data } = await admin
    .from("agent_accords")
    .select("envoye_le, accepte_le, conversation_id, rdv_debut")
    .eq("organization_id", org.id);
  const l = data ?? [];
  console.log(
    `${l.length} liens · ${l.filter((a) => a.envoye_le).length} envoyés · ${l.filter((a) => a.accepte_le).length} accords · ${l.filter((a) => a.conversation_id).length} conversations ouvertes`,
  );
  process.exit(0);
}

console.log("Usage : --preparer --sortie <fichier.json> | --envoyes <fichier.json> | --etat");
