import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { envoyer } from "../fichiers/courriel.ts";
import { HEURE_DU_RESUME, mailDuResume, raisonHorsChamp, type DiagnosticDuJour } from "./resume-regles.ts";
import { ajouterJours, instantLocal, jourLocal } from "./temps.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Le mail de la veille : chacune reçoit ses diagnostics du lendemain (Louis,
 * 25/09/2026 ; la veille à 17h au lieu du jour même à 8h depuis le 28/09). Le client reçoit les siens ; chaque closeuse, les rendez-vous
 * que Radar lui attribue, les jours où elle en a. Une closeuse retirée du
 * client rend ses rendez-vous au client.
 *
 * L'horloge passe toutes les 5 minutes ; le premier passage après 17h (heure
 * de Paris) réserve le lendemain dans `resume_envoye_le` avant d'envoyer
 * ses diagnostics. Deux
 * passages simultanés n'envoient donc qu'une fois. Si aucun mail n'est parti
 * (Resend en panne), la réservation est rendue et le passage suivant
 * réessaie ; si une partie seulement est partie, on ne renvoie pas à celles
 * qui l'ont déjà.
 *
 * Les simulations n'y entrent que par l'envoi de test, qui part chez Louis
 * seul.
 */

const PARIS = "Europe/Paris";
const ETATS_DU_JOUR = ["active", "hors_champ", "stop", "terminee"];

type NoteIa = { ia?: { note_pour_peggy?: string | null } } | null;

/**
 * Les diagnostics d'une journée chez un client, avec ce que chacune a dit.
 *
 * La liste part de Radar : tous les diagnostics du jour (un type dont le nom
 * dit « diagnostic »), qu'ils soient suivis par l'assistante ou non (Louis,
 * 28/09/2026 : le 28 au soir, les 5 diagnostics du lendemain, pris sur
 * Calendly avant la mise en route de l'assistante, n'apparaissaient pas, et
 * aucun mail n'était parti). Quand l'assistante suit la cliente, sa
 * conversation ajoute l'état et ce qu'elle a dit. Les simulations, sans
 * rendez-vous dans Radar, n'entrent que par l'envoi de test.
 */
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
      "id, booking_id, rdv_debut, reserve_le, telephone, prenom, fuseau, etat, confirme_le, reports_agent, invites_precedents, sans_reponse_veille, simulation",
    )
    .eq("organization_id", orgId)
    .gte("rdv_debut", debut)
    .lt("rdv_debut", fin)
    .in("etat", ETATS_DU_JOUR)
    // Annulé par l'agent, la conversation reste un temps « active » (0048) :
    // ce n'est plus un rendez-vous du jour.
    .is("annulee_par_agent_le", null)
    .order("rdv_debut");
  if (!avecSimulations) requete = requete.eq("simulation", false);

  const [{ data: conversations }, { data: rdvs }] = await Promise.all([
    requete,
    admin
      .from("radar_bookings")
      .select("id, scheduled_start, invitee_first_name, closeuse_id, status, event_type_name")
      .eq("organization_id", orgId)
      .gte("scheduled_start", debut)
      .lt("scheduled_start", fin)
      .not("status", "in", "(annule,no_show)")
      .ilike("event_type_name", "%diagnostic%")
      .order("scheduled_start"),
  ]);

  const convs = conversations ?? [];
  const { data: entrants } = convs.length
    ? await admin
        .from("agent_messages")
        .select("conversation_id, comprehension")
        .in(
          "conversation_id",
          convs.map((c) => c.id),
        )
        .eq("sens", "entrant")
        .order("created_at")
    : { data: [] as { conversation_id: string; comprehension: unknown }[] };

  const notesDe = (id: string) =>
    (entrants ?? [])
      .filter((m) => m.conversation_id === id)
      .map((m) => (m.comprehension as NoteIa)?.ia?.note_pour_peggy ?? "")
      .filter((n): n is string => Boolean(n));

  const depuisConversation = (c: (typeof convs)[number], closeuse: string | null): DiagnosticDuJour => ({
    rdv_debut: c.rdv_debut,
    prenom: c.prenom,
    fuseau: c.fuseau,
    etat: c.etat,
    confirme_le: c.confirme_le,
    reports_agent: c.reports_agent,
    deplace: c.invites_precedents.length > 0,
    sans_reponse_veille: c.sans_reponse_veille,
    simulation: c.simulation,
    closeuse_id: closeuse,
    notes: notesDe(c.id),
    ...(c.etat === "hors_champ" ? { raison_hors_champ: raisonHorsChamp(c) } : {}),
  });

  const convDe = new Map(convs.filter((c) => c.booking_id).map((c) => [c.booking_id as string, c]));
  const vus = new Set<string>();
  const liste: DiagnosticDuJour[] = (rdvs ?? []).map((r) => {
    const c = convDe.get(r.id);
    if (c) {
      vus.add(c.id);
      return depuisConversation(c, r.closeuse_id);
    }
    return {
      rdv_debut: r.scheduled_start,
      prenom: r.invitee_first_name?.trim() || "Invitée",
      fuseau: PARIS,
      etat: "sans_suivi",
      confirme_le: null,
      reports_agent: 0,
      deplace: false,
      sans_reponse_veille: false,
      simulation: false,
      closeuse_id: r.closeuse_id,
      notes: [],
    };
  });
  // Une conversation sans rendez-vous Radar (une simulation, un rendez-vous
  // pas encore arrivé dans Radar) garde sa place.
  for (const c of convs) if (!vus.has(c.id)) liste.push(depuisConversation(c, null));
  return liste.sort((a, b) => Date.parse(a.rdv_debut) - Date.parse(b.rdv_debut));
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

  // `resume_envoye_le` porte le jour des diagnostics couverts (le lendemain
  // de l'envoi). Avant le 28/09/2026, il portait le jour d'envoi du mail de
  // 8h, qui couvrait le jour même : le premier passage de 17h qui suit la
  // mise en ligne voit une date plus petite que demain et envoie bien.
  const demain = ajouterJours(jour, 1);

  let partis = 0;
  for (const client of clients ?? []) {
    if (client.resume_envoye_le && client.resume_envoye_le >= demain) continue;

    // Réserver la journée : un seul passage gagne.
    const { data: reserve } = await admin
      .from("agent_reglages")
      .update({ resume_envoye_le: demain })
      .eq("organization_id", client.organization_id)
      .or(`resume_envoye_le.is.null,resume_envoye_le.lt.${demain}`)
      .select("organization_id")
      .maybeSingle();
    if (!reserve) continue;

    const envois = await repartir(
      admin,
      client.organization_id,
      client.resume_destinataires,
      await diagnosticsDuJour(admin, client.organization_id, demain, false),
    );

    let partisIci = 0;
    for (const e of envois) {
      const mail = mailDuResume({ jour: demain, fuseau: PARIS, diagnostics: e.diagnostics });
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
