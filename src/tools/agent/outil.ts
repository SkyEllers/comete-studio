import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { agendasGoogle, effacerRendezVous } from "@/tools/reservation/agenda";
import { depotSupabase } from "@/tools/reservation/depot";
import { identifiants } from "@/tools/reservation/google";
import { creneauxLibres, reporter } from "@/tools/reservation/moteur";
import { annulerDansRadar } from "@/tools/reservation/radar";
import { suivreReport } from "@/tools/reservation/suites";

import { agentRecoitInvitation } from "./conversations.ts";
import { tournerTout } from "./moteur.ts";
import {
  fenetreEntiere,
  invitationDepuisRdv,
  lienMonRdv,
  lireLienPersonnel,
  veilleMailDue,
  type RdvOutil,
} from "./outil-regles.ts";
import { profil as profilDe } from "./profils/index.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * L'agent WhatsApp branché sur l'outil de réservation maison.
 *
 * Avec Calendly, l'agent apprend une réservation par le webhook, et déplace
 * par l'API de Calendly. Avec l'outil, ce sont les routes de la page
 * (`api/reservation/page/*`) qui le préviennent, et il déplace par le moteur.
 * Tout passe par la même porte que Calendly (`agentRecoitInvitation`), sur un
 * rendez-vous traduit en invitation (`outil-regles.ts`).
 *
 * Rien ici ne fait échouer une réservation : l'agent est une suite, pas une
 * condition. Un échec se journalise sans donnée personnelle.
 */

const COLONNES_RDV =
  "id, organization_id, debut, fin, created_at, prenom, nom, email, telephone, fuseau_cliente, lien_visio, reponses";

async function lireRdv(admin: Admin, org: string, id: string): Promise<RdvOutil | null> {
  const { data } = await admin
    .from("reservation_rendez_vous")
    .select(COLONNES_RDV)
    .eq("id", id)
    .eq("organization_id", org)
    .maybeSingle();
  return (data as RdvOutil | null) ?? null;
}

/** Le site du client, lu dans le profil de l'agent (celui de sa page Tarifs). */
async function siteDuClient(admin: Admin, org: string): Promise<string | null> {
  const { data } = await admin.from("agent_reglages").select("profil").eq("organization_id", org).maybeSingle();
  return data ? (profilDe(data.profil)?.urlTarifs ?? null) : null;
}

export type EvenementOutil =
  | { type: "reserve"; rdvId: string; jeton: string }
  | { type: "reporte"; ancienId: string; rdvId: string; jeton: string }
  | { type: "annule"; rdvId: string };

export async function outilVersAgent(admin: Admin, org: string, e: EvenementOutil): Promise<void> {
  try {
    const rdv = await lireRdv(admin, org, e.rdvId);
    if (!rdv) return;
    const lienPersonnel = e.type === "annule" ? null : lienMonRdv(await siteDuClient(admin, org), e.jeton);
    const invite = invitationDepuisRdv(rdv, {
      lienPersonnel,
      ancienRdvId: e.type === "reporte" ? e.ancienId : null,
    });
    const issue = await agentRecoitInvitation(
      admin,
      org,
      e.type === "annule" ? "annulee" : "creee",
      invite,
      new Date().toISOString(),
    );
    if (issue === "erreur") console.error("Agent : rendez-vous de l'outil non transmis", e.type);
  } catch (erreur) {
    console.error("Agent, outil de réservation :", erreur instanceof Error ? erreur.message : "erreur");
  }
}

/** Un passage de l'horloge, tout de suite : le premier message n'attend pas 5 minutes. */
export async function horlogeAgent(admin: Admin): Promise<void> {
  try {
    await tournerTout(admin);
  } catch {
    console.error("Agent : premier message non parti depuis l'outil de réservation");
  }
}

/** Les débuts de créneaux libres, lus par le moteur sur toute la fenêtre, pour proposer un report. */
export async function creneauxOutil(admin: Admin, org: string, maintenant: number): Promise<string[] | null> {
  const ids = identifiants();
  if (!ids) return null;
  try {
    const d = await creneauxLibres(org, maintenant, fenetreEntiere(depotSupabase(admin)), agendasGoogle(admin, ids));
    if (d.etat === "ferme") return null;
    return d.creneaux.map((c) => c.debut);
  } catch (erreur) {
    console.error("Agent : créneaux de l'outil illisibles", erreur instanceof Error ? erreur.message : "erreur");
    return null;
  }
}

export type Deplace = {
  rdvId: string;
  debut: string;
  fin: string;
  lienVisio: string | null;
  bookingId: string | null;
};

/**
 * Déplacer le rendez-vous au créneau qu'elle a choisi, par le moteur : la
 * base annule l'ancien et prend le nouveau d'un seul geste, le lien personnel
 * suit. Puis l'agenda Google et Radar, marqués « par l'assistante ». Null si
 * le créneau n'est plus libre : l'ancien rendez-vous reste, intact.
 */
export async function reporterParAgent(
  admin: Admin,
  org: string,
  ancienId: string,
  choisi: string,
  lienPersonnel: string | null,
): Promise<Deplace | null> {
  const ids = identifiants();
  if (!ids) return null;
  const prise = await reporter(
    org,
    ancienId,
    new Date(choisi).toISOString(),
    "agent",
    Date.now(),
    depotSupabase(admin),
    agendasGoogle(admin, ids),
  );
  if (!prise.ok) {
    if (prise.raison === "erreur") console.error("Agent : report refusé par l'outil", prise.message ?? "");
    return null;
  }

  await suivreReport(admin, org, ancienId, prise.id, ids, "agent");
  // Le mail « ton rendez-vous est déplacé », avec l'invitation mise à jour :
  // c'est le site qui l'envoie, depuis l'adresse du client.
  await notifierSite(lienPersonnel, "deplace");

  const { data } = await admin
    .from("reservation_rendez_vous")
    .select("debut, fin, lien_visio, radar_booking_id")
    .eq("id", prise.id)
    .single();
  if (!data) return null;
  return {
    rdvId: prise.id,
    debut: new Date(data.debut).toISOString(),
    fin: new Date(data.fin).toISOString(),
    lienVisio: data.lien_visio,
    bookingId: data.radar_booking_id,
  };
}

/**
 * Demander au site d'envoyer un mail à la cliente : « déplacé », « annulé »
 * ou le rappel de la veille. Le mail part de l'adresse du client, avec
 * l'invitation d'agenda, comme ceux de la page. Le site ne croit que le lien
 * personnel : il relit le rendez-vous au hub avec son propre jeton, et
 * n'écrit qu'à sa titulaire. Ne lève jamais.
 */
export async function notifierSite(
  lienPersonnel: string | null,
  geste: "deplace" | "annule" | "veille",
): Promise<boolean> {
  const lu = lireLienPersonnel(lienPersonnel);
  if (!lu) {
    console.error("Agent : pas de lien personnel, le site n'est pas prévenu", geste);
    return false;
  }
  try {
    const r = await fetch(`${lu.site}/api/rdv/notifier`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "comete-hub/agent" },
      body: JSON.stringify({ lien: lu.jeton, geste }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) console.error("Agent : le site refuse le mail", geste, r.status);
    return r.ok;
  } catch {
    console.error("Agent : le site ne répond pas", geste);
    return false;
  }
}

/**
 * Annuler à sa demande un rendez-vous de l'outil : la base d'abord (le
 * créneau se libère), puis l'agenda Google, Radar (« annulée par la
 * personne, avec l'assistante ») et le mail d'annulation du site.
 */
export async function annulerParAgentOutil(
  admin: Admin,
  rdvId: string,
  lienPersonnel: string | null,
): Promise<boolean> {
  const { error } = await admin.rpc("reservation_annuler", { rendez_vous: rdvId, par: "agent" });
  if (error) {
    console.error("Agent : annulation refusée par l'outil", error.message);
    return false;
  }
  const ids = identifiants();
  if (ids) {
    try {
      await effacerRendezVous(admin, rdvId, ids);
    } catch (erreur) {
      console.error("Agent, effacement Google :", erreur instanceof Error ? erreur.message : "erreur");
    }
  }
  await annulerDansRadar(admin, rdvId, { reprogramme: false, par: "agent" });
  await notifierSite(lienPersonnel, "annule");
  return true;
}

/**
 * Le mail de la veille pour celles qui ont dit STOP (rendez-vous de l'outil
 * seulement : Calendly envoie ses propres rappels). Appelé par l'horloge.
 */
export async function mailsVeilleStop(admin: Admin, maintenant = Date.now()): Promise<number> {
  const { data } = await admin
    .from("agent_conversations")
    .select("id, rdv_debut, fuseau, veille_mail_le, lien_report")
    .eq("etat", "stop")
    .eq("simulation", false)
    .like("invitee_uri", "reservation:%")
    .is("veille_mail_le", null)
    .gt("rdv_debut", new Date(maintenant).toISOString())
    .lt("rdv_debut", new Date(maintenant + 3 * 86_400_000).toISOString());

  let envoyes = 0;
  for (const c of data ?? []) {
    if (!veilleMailDue(c, maintenant)) continue;
    // Noté avant l'envoi : deux passages de l'horloge n'envoient pas deux mails.
    const { data: pris } = await admin
      .from("agent_conversations")
      .update({ veille_mail_le: new Date(maintenant).toISOString() })
      .eq("id", c.id)
      .is("veille_mail_le", null)
      .select("id");
    if (!pris?.length) continue;
    if (await notifierSite(c.lien_report, "veille")) envoyes++;
    else await admin.from("agent_conversations").update({ veille_mail_le: null }).eq("id", c.id);
  }
  return envoyes;
}
