import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { envoyer } from "../fichiers/courriel.ts";
import { HEURE_DU_RESUME, mailDuResume, type DiagnosticDuJour } from "./resume-regles.ts";
import { ajouterJours, instantLocal, jourLocal } from "./temps.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Le mail du matin : les diagnostics du jour, envoyés au client à 8h.
 *
 * L'horloge passe toutes les 5 minutes ; le premier passage après 8h (heure
 * de Paris) réserve la journée dans `resume_envoye_le` avant d'envoyer. Deux
 * passages simultanés n'envoient donc qu'un mail. Si Resend refuse, la
 * réservation est rendue et le passage suivant réessaie.
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
      "id, rdv_debut, prenom, fuseau, etat, confirme_le, reports_agent, invites_precedents, sans_reponse_veille, simulation",
    )
    .eq("organization_id", orgId)
    .gte("rdv_debut", debut)
    .lt("rdv_debut", fin)
    .in("etat", ETATS_DU_JOUR)
    .order("rdv_debut");
  if (!avecSimulations) requete = requete.eq("simulation", false);

  const { data: conversations } = await requete;
  if (!conversations?.length) return [];

  const { data: entrants } = await admin
    .from("agent_messages")
    .select("conversation_id, comprehension")
    .in(
      "conversation_id",
      conversations.map((c) => c.id),
    )
    .eq("sens", "entrant")
    .order("created_at");

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
    notes: (entrants ?? [])
      .filter((m) => m.conversation_id === c.id)
      .map((m) => (m.comprehension as NoteIa)?.ia?.note_pour_peggy ?? "")
      .filter((n): n is string => Boolean(n)),
  }));
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
    if (client.resume_destinataires.length === 0) continue;
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

    const mail = mailDuResume({
      jour,
      fuseau: PARIS,
      diagnostics: await diagnosticsDuJour(admin, client.organization_id, jour, false),
    });
    if (!mail) continue;

    if (await envoyer({ ...mail, a: client.resume_destinataires })) {
      partis++;
    } else {
      await admin
        .from("agent_reglages")
        .update({ resume_envoye_le: client.resume_envoye_le })
        .eq("organization_id", client.organization_id);
    }
  }
  return partis;
}

/**
 * L'envoi de test : le résumé d'un jour choisi, simulations comprises, chez
 * Louis seul. Rend `null` si la journée est vide.
 */
export async function envoyerResumeTest(
  admin: Admin,
  orgId: string,
  jour: string,
): Promise<boolean | null> {
  const mail = mailDuResume({
    jour,
    fuseau: PARIS,
    diagnostics: await diagnosticsDuJour(admin, orgId, jour, true),
    test: true,
  });
  if (!mail) return null;
  return envoyer(mail);
}
