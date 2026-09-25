import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { envoyer } from "../fichiers/courriel.ts";
import { HEURE_DU_RESUME, mailDuResume, type DiagnosticDuJour } from "./resume-regles.ts";
import { ajouterJours, instantLocal, jourLocal } from "./temps.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Le mail du matin : chacune reçoit ses diagnostics du jour (Louis,
 * 25/09/2026). Le client reçoit les siens ; chaque closeuse, les rendez-vous
 * que Radar lui attribue, les jours où elle en a. Une closeuse retirée du
 * client rend ses rendez-vous au client.
 *
 * L'horloge passe toutes les 5 minutes ; le premier passage après 8h (heure
 * de Paris) réserve la journée dans `resume_envoye_le` avant d'envoyer. Deux
 * passages simultanés n'envoient donc qu'une fois. Si aucun mail n'est parti
 * (Resend en panne), la réservation est rendue et le passage suivant
 * réessaie ; si une partie seulement est partie, on ne renvoie pas à celles
 * qui l'ont déjà.
 *
 * Seules les vraies conversations comptent. Les simulations n'y entrent que
 * par l'envoi de test, qui part chez Louis seul.
 */

const PARIS = "Europe/Paris";
const ETATS_DU_JOUR = ["active", "hors_champ", "stop", "terminee"];

type NoteIa = { ia?: { note_pour_peggy?: string | null } } | null;

/** Les diagnostics d'une journée chez un client, avec ce que chacune a dit. */
export async function diagnosticsDuJour(
  admin: Admin,
  orgId: string,
  jour: string,
  avecSimulations: boolean,
): Promise<DiagnosticDuJour[]> {
  const debut = new Date(instantLocal(jour, 0, 0, PARIS)).toISOString();
  const fin = new Date(instantLocal(ajouterJours(jour, 1), 0, 0, PARIS)).toISOString();

  let requete = admin
    .from("agent_conversations")
    .select(
      "id, booking_id, rdv_debut, prenom, fuseau, etat, confirme_le, reports_agent, invites_precedents, sans_reponse_veille, simulation",
    )
    .eq("organization_id", orgId)
    .gte("rdv_debut", debut)
    .lt("rdv_debut", fin)
    .in("etat", ETATS_DU_JOUR)
    .order("rdv_debut");
  if (!avecSimulations) requete = requete.eq("simulation", false);

  const { data: conversations } = await requete;
  if (!conversations?.length) return [];

  const bookings = conversations.map((c) => c.booking_id).filter((b): b is string => Boolean(b));
  const [{ data: entrants }, { data: rdvs }] = await Promise.all([
    admin
      .from("agent_messages")
      .select("conversation_id, comprehension")
      .in(
        "conversation_id",
        conversations.map((c) => c.id),
      )
      .eq("sens", "entrant")
      .order("created_at"),
    bookings.length
      ? admin.from("radar_bookings").select("id, closeuse_id").in("id", bookings)
      : Promise.resolve({ data: [] as { id: string; closeuse_id: string | null }[] }),
  ]);
  const closeuseDe = new Map((rdvs ?? []).map((r) => [r.id, r.closeuse_id]));

  return conversations.map((c) => ({
    rdv_debut: c.rdv_debut,
    prenom: c.prenom,
    fuseau: c.fuseau,
    etat: c.etat,
    confirme_le: c.confirme_le,
    reports_agent: c.reports_agent,
    deplace: c.invites_precedents.length > 0,
    sans_reponse_veille: c.sans_reponse_veille,
    simulation: c.simulation,
    closeuse_id: c.booking_id ? (closeuseDe.get(c.booking_id) ?? null) : null,
    notes: (entrants ?? [])
      .filter((m) => m.conversation_id === c.id)
      .map((m) => (m.comprehension as NoteIa)?.ia?.note_pour_peggy ?? "")
      .filter((n): n is string => Boolean(n)),
  }));
}

type Envoi = { pour: string | null; a: string[]; diagnostics: DiagnosticDuJour[] };

/**
 * Qui reçoit quoi. Le client : ses destinataires réglés ; une closeuse : son
 * adresse de connexion au hub, tant qu'elle travaille pour ce client.
 */
export async function repartir(
  admin: Admin,
  orgId: string,
  destinatairesClient: string[],
  diagnostics: DiagnosticDuJour[],
): Promise<Envoi[]> {
  const ids = [...new Set(diagnostics.map((d) => d.closeuse_id).filter((c): c is string => Boolean(c)))];
  const closeuses = new Map<string, { nom: string; email: string }>();
  if (ids.length) {
    const [{ data: actives }, { data: profils }] = await Promise.all([
      admin.from("radar_closeuses").select("user_id").eq("organization_id", orgId).in("user_id", ids),
      admin.from("profiles").select("id, email, full_name").in("id", ids),
    ]);
    const encore = new Set((actives ?? []).map((a) => a.user_id));
    for (const p of profils ?? []) {
      if (encore.has(p.id) && p.email) closeuses.set(p.id, { nom: p.full_name || p.email, email: p.email });
    }
  }

  const envois = new Map<string, Envoi>();
  for (const d of diagnostics) {
    const closeuse = d.closeuse_id ? closeuses.get(d.closeuse_id) : undefined;
    const cle = closeuse ? d.closeuse_id! : "client";
    const envoi =
      envois.get(cle) ??
      (closeuse
        ? { pour: closeuse.nom, a: [closeuse.email], diagnostics: [] }
        : { pour: null, a: destinatairesClient, diagnostics: [] });
    envoi.diagnostics.push(d);
    envois.set(cle, envoi);
  }
  return [...envois.values()].filter((e) => e.a.length > 0);
}

/** Ce que l'horloge appelle à chaque passage. Rend le nombre de mails partis. */
export async function envoyerResumes(admin: Admin, reel = Date.now()): Promise<number> {
  const jour = jourLocal(reel, PARIS);
  if (reel < instantLocal(jour, HEURE_DU_RESUME, 0, PARIS)) return 0;

  const { data: clients } = await admin
    .from("agent_reglages")
    .select("organization_id, resume_destinataires, resume_envoye_le")
    .eq("actif", true)
    .eq("resume_actif", true);

  let partis = 0;
  for (const client of clients ?? []) {
    if (client.resume_envoye_le && client.resume_envoye_le >= jour) continue;

    // Réserver la journée : un seul passage gagne.
    const { data: reserve } = await admin
      .from("agent_reglages")
      .update({ resume_envoye_le: jour })
      .eq("organization_id", client.organization_id)
      .or(`resume_envoye_le.is.null,resume_envoye_le.lt.${jour}`)
      .select("organization_id")
      .maybeSingle();
    if (!reserve) continue;

    const envois = await repartir(
      admin,
      client.organization_id,
      client.resume_destinataires,
      await diagnosticsDuJour(admin, client.organization_id, jour, false),
    );

    let partisIci = 0;
    for (const e of envois) {
      const mail = mailDuResume({ jour, fuseau: PARIS, diagnostics: e.diagnostics });
      if (mail && (await envoyer({ ...mail, a: e.a }))) partisIci++;
    }
    partis += partisIci;

    if (envois.length > 0 && partisIci === 0) {
      await admin
        .from("agent_reglages")
        .update({ resume_envoye_le: client.resume_envoye_le })
        .eq("organization_id", client.organization_id);
    }
  }
  return partis;
}

/**
 * L'envoi de test : les mails d'un jour choisi, simulations comprises, tous
 * chez Louis, chacun marqué de celle qui l'aurait reçu. Rend `null` si la
 * journée est vide, sinon vrai si tous sont partis.
 */
export async function envoyerResumeTest(
  admin: Admin,
  orgId: string,
  jour: string,
): Promise<boolean | null> {
  const diagnostics = await diagnosticsDuJour(admin, orgId, jour, true);
  if (diagnostics.length === 0) return null;

  // Les adresses ne servent pas : tout part chez Louis. `["louis"]` garde
  // le mail du client, même sans destinataire réglé.
  const envois = await repartir(admin, orgId, ["louis"], diagnostics);
  let tous = true;
  for (const e of envois) {
    const mail = mailDuResume({ jour, fuseau: PARIS, diagnostics: e.diagnostics, test: true, pour: e.pour ?? undefined });
    if (!mail || !(await envoyer(mail))) tous = false;
  }
  return tous;
}
