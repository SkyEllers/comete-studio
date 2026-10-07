import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { createAdminClient } from "@/lib/supabase/admin";
import { jetonAgent, lireEvenement, lireInvitation } from "@/tools/agent/calendly";
import { lienMonRdv, lireLienPersonnel } from "@/tools/agent/outil-regles";
import { profil as profilAgent } from "@/tools/agent/profils";
import { reponsesGardees } from "@/tools/resultats/calendly";

import { ecrireRendezVous, effacerRendezVous, lireJeton } from "./agenda.ts";
import { deteindreConfie, jetonAcces, teinterConfie, type Identifiants, type Teinte } from "./google.ts";
import { prevenirPersonne } from "./prevenir.ts";
import { baseEspace } from "./suites.ts";

/**
 * Confier à une closeuse un diagnostic déjà pris chez la titulaire (Louis,
 * 06/10/2026 : remplir leurs créneaux et libérer du temps à Peggy).
 *
 * Même rendez-vous, même heure, même fiche Radar ; seule la personne change :
 * 1. l'événement quitte l'agenda « Diagnostics » de la titulaire et s'écrit
 *    dans celui de la closeuse, avec sa visio (d'où un nouveau lien) ;
 * 2. la cliente reçoit le nouveau lien (`visio`, mail du site, depuis
 *    l'adresse de Peggy) ; elle n'a pas à savoir qui la reçoit ;
 * 3. Radar et l'assistante WhatsApp suivent (closeuse, lien des rappels) ;
 * 4. la closeuse reçoit le mail « Nouveau diagnostic ».
 *
 * Un rendez-vous pris sur Calendly n'a pas de ligne dans l'outil : on la crée
 * (origine `admin`), avec l'adresse et les réponses lues chez Calendly.
 * L'événement Calendly reste dans l'agenda de la titulaire (`calendly: true`
 * dans la réponse) : on le passe en Tomate et « Disponible » (`teinterConfie`)
 * si la titulaire a donné le droit de modifier ses événements. Il ne se
 * supprime jamais : le 06/10, le supprimer annulait le rendez-vous Calendly ;
 * le 07/10, synchronisation des annulations coupée dans Calendly, Google a
 * quand même envoyé « Événement annulé » à l'invitée.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type Confie =
  | {
      ok: true;
      mailCliente: boolean;
      calendly: boolean;
      lienVisio: string | null;
      /** Calendly : son événement chez la titulaire, passé en Tomate et Disponible, ou pourquoi pas. */
      agendaTitulaire: Teinte | "erreur" | null;
    }
  | { ok: false; erreur: string };

const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");

/** Le site du client, lu dans le profil de l'agent (comme `agent/outil.ts`). */
async function siteDuClient(admin: Admin, org: string): Promise<string | null> {
  const { data } = await admin.from("agent_reglages").select("profil").eq("organization_id", org).maybeSingle();
  return data ? (profilAgent(data.profil)?.urlTarifs ?? null) : null;
}

/** Le mail « le lien de ta visio change », demandé au site avec le lien personnel. */
async function prevenirCliente(lienPersonnel: string | null): Promise<boolean> {
  const lu = lireLienPersonnel(lienPersonnel);
  if (!lu) return false;
  try {
    const r = await fetch(`${lu.site}/api/rdv/notifier`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "comete-hub/confier" },
      body: JSON.stringify({ lien: lu.jeton, geste: "visio" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) console.error("Confier : le site refuse le mail", r.status);
    return r.ok;
  } catch {
    console.error("Confier : le site ne répond pas");
    return false;
  }
}

/** Un autre rendez-vous confirmé de la closeuse chevauche-t-il celui-ci, pause comprise ? */
async function dejaPrise(admin: Admin, personneId: string, debut: string, bloqueJusqua: string, sauf?: string) {
  let q = admin
    .from("reservation_rendez_vous")
    .select("id")
    .eq("personne_id", personneId)
    .eq("statut", "confirme")
    .lt("debut", bloqueJusqua)
    .gt("bloque_jusqu_a", debut);
  if (sauf) q = q.neq("id", sauf);
  const { data } = await q.limit(1);
  return Boolean(data?.length);
}

export async function confierRendezVous(
  admin: Admin,
  org: string,
  bookingId: string,
  personneId: string,
  ids: Identifiants,
): Promise<Confie> {
  const [{ data: rdv }, { data: closeuse }, { data: reglages }] = await Promise.all([
    admin
      .from("radar_bookings")
      .select("id, status, scheduled_start, scheduled_end, invitee_uri, invitee_first_name, invitee_last_name, closeuse_id")
      .eq("id", bookingId)
      .eq("organization_id", org)
      .maybeSingle(),
    admin
      .from("reservation_personnes")
      .select("id, user_id, role, google_agenda, google_connecte_le")
      .eq("id", personneId)
      .eq("organization_id", org)
      .maybeSingle(),
    admin.from("reservation_reglages").select("pause_minutes").eq("organization_id", org).maybeSingle(),
  ]);

  if (!rdv) return { ok: false, erreur: "Rendez-vous introuvable." };
  if (rdv.status !== "confirme" || Date.parse(rdv.scheduled_start) <= Date.now()) {
    return { ok: false, erreur: "Seul un rendez-vous confirmé et à venir se confie." };
  }
  if (!closeuse || closeuse.role !== "closeuse") return { ok: false, erreur: "Cette personne n'est pas closeuse ici." };
  if (!closeuse.google_connecte_le || closeuse.google_agenda === "primary") {
    return { ok: false, erreur: "Son agenda Google n'est pas relié : elle le fait dans « Mon agenda »." };
  }

  const pause = (reglages?.pause_minutes ?? 15) * 60_000;
  const bloque = new Date(Date.parse(rdv.scheduled_end) + pause).toISOString();
  const espace = await baseEspace(admin, org);
  const site = await siteDuClient(admin, org);

  const { data: ligne } = await admin
    .from("reservation_rendez_vous")
    .select("id, personne_id")
    .eq("radar_booking_id", bookingId)
    .eq("statut", "confirme")
    .maybeSingle();

  let rdvId: string;
  let lienPersonnel: string | null = null;
  let emailCalendly: string | null = null;
  const calendly = !ligne;

  if (ligne) {
    // ----------------------- Pris par la page de l'outil -----------------------
    if (ligne.personne_id === closeuse.id) return { ok: false, erreur: "Ce rendez-vous est déjà chez elle." };
    if (await dejaPrise(admin, closeuse.id, rdv.scheduled_start, bloque, ligne.id)) {
      return { ok: false, erreur: "Elle a déjà un rendez-vous sur ce créneau." };
    }
    rdvId = ligne.id;

    try {
      await effacerRendezVous(admin, rdvId, ids);
    } catch (erreur) {
      console.error("Confier, effacement Google :", erreur instanceof Error ? erreur.message : "erreur");
    }

    // Le lien personnel de la cliente : celui que garde l'assistante, sinon un
    // nouveau (l'ancien cesse alors de marcher ; le mail donne le nouveau).
    const { data: conv } = await admin
      .from("agent_conversations")
      .select("lien_report")
      .eq("booking_id", bookingId)
      .maybeSingle();
    lienPersonnel = lireLienPersonnel(conv?.lien_report ?? null) ? (conv?.lien_report as string) : null;
    let nouveauJeton: string | null = null;
    if (!lienPersonnel) {
      nouveauJeton = randomBytes(32).toString("hex");
      lienPersonnel = lienMonRdv(site, nouveauJeton);
    }

    const { error } = await admin
      .from("reservation_rendez_vous")
      .update({
        personne_id: closeuse.id,
        google_event_id: null,
        lien_visio: null,
        ...(nouveauJeton ? { jeton_hash: empreinte(nouveauJeton) } : {}),
      })
      .eq("id", rdvId);
    if (error) return { ok: false, erreur: `Le rendez-vous n'a pas pu changer de personne : ${error.message}` };
  } else {
    // --------------------------- Pris sur Calendly -----------------------------
    if (await dejaPrise(admin, closeuse.id, rdv.scheduled_start, bloque)) {
      return { ok: false, erreur: "Elle a déjà un rendez-vous sur ce créneau." };
    }
    const jeton = await jetonAgent(admin, org);
    const invite = jeton ? await lireInvitation(jeton, rdv.invitee_uri) : null;
    if (!invite?.email) return { ok: false, erreur: "Calendly ne rend pas l'adresse de la cliente : rien n'a changé." };
    emailCalendly = invite.email;

    const telephone =
      invite.text_reminder_number ??
      invite.questions_and_answers?.find((q) => /t[ée]l[ée]phone|num[ée]ro|whatsapp/i.test(q.question))?.answer ??
      null;
    const jetonClient = randomBytes(32).toString("hex");
    lienPersonnel = lienMonRdv(site, jetonClient);

    const { data: cree, error } = await admin
      .from("reservation_rendez_vous")
      .insert({
        organization_id: org,
        personne_id: closeuse.id,
        debut: rdv.scheduled_start,
        fin: rdv.scheduled_end,
        bloque_jusqu_a: bloque,
        statut: "confirme",
        origine: "admin",
        prenom: invite.first_name ?? rdv.invitee_first_name ?? null,
        nom: invite.last_name ?? rdv.invitee_last_name ?? null,
        email: invite.email,
        telephone,
        fuseau_cliente: invite.timezone ?? "Europe/Paris",
        reponses: (invite.questions_and_answers ?? []).map((q) => ({ question: q.question, reponse: q.answer })),
        jeton_hash: empreinte(jetonClient),
        radar_booking_id: bookingId,
      })
      .select("id")
      .single();
    if (error || !cree) return { ok: false, erreur: `Le rendez-vous n'a pas pu être repris : ${error?.message ?? "erreur"}` };
    rdvId = cree.id;
  }

  // ----------------------------- La suite commune -----------------------------
  let lienVisio: string | null = null;
  try {
    lienVisio = (await ecrireRendezVous(admin, rdvId, ids, espace)).lienVisio;
  } catch (erreur) {
    console.error("Confier, écriture Google :", erreur instanceof Error ? erreur.message : "erreur");
  }

  await admin
    .from("radar_bookings")
    .update({ closeuse_id: closeuse.user_id, updated_at: new Date().toISOString() })
    .eq("id", bookingId);

  try {
    await copierReponses(admin, org, bookingId, rdvId);
  } catch (erreur) {
    console.error("Confier, réponses :", erreur instanceof Error ? erreur.message : "erreur");
  }

  // L'assistante envoie ses rappels avec ce lien : il doit être le nouveau.
  await admin
    .from("agent_conversations")
    .update({ lien_visio: lienVisio, ...(lienPersonnel && !calendly ? { lien_report: lienPersonnel } : {}) })
    .eq("booking_id", bookingId);

  // Calendly : l'événement reste chez la titulaire ; on le passe en Tomate et
  // « Disponible » plutôt que le supprimer (Louis, 07/10/2026).
  let agendaTitulaire: Teinte | "erreur" | null = null;
  if (calendly && emailCalendly) {
    try {
      const { data: titulaire } = await admin
        .from("reservation_personnes")
        .select("id")
        .eq("organization_id", org)
        .eq("role", "titulaire")
        .maybeSingle();
      const jeton = titulaire ? await lireJeton(admin, titulaire.id) : null;
      agendaTitulaire = jeton
        ? await teinterConfie(await jetonAcces(jeton, ids), { debut: rdv.scheduled_start, fin: rdv.scheduled_end, email: emailCalendly, nom: [rdv.invitee_first_name, rdv.invitee_last_name].filter(Boolean).join(" ") })
        : "sans_droit";
    } catch (erreur) {
      console.error("Confier, Tomate chez la titulaire :", erreur instanceof Error ? erreur.message : "erreur");
      agendaTitulaire = "erreur";
    }
  }

  const mailCliente = await prevenirCliente(lienPersonnel);
  await prevenirPersonne(admin, rdvId, "nouveau", espace);

  return { ok: true, mailCliente, calendly, lienVisio, agendaTitulaire };
}

// ------------------------------- Rendre à la titulaire -------------------------------

export type Rendu =
  | { ok: true; mailCliente: boolean; calendly: boolean; agendaTitulaire: Teinte | "erreur" | null }
  | { ok: false; erreur: string };

/**
 * Rendre à la titulaire un diagnostic confié à une closeuse (Louis,
 * 07/10/2026 : Marion se désiste d'un mardi 14h que personne d'autre ne
 * couvre). L'inverse de `confierRendezVous` :
 * 1. l'événement quitte l'agenda « Diagnostics » de la closeuse ;
 * 2. le rendez-vous revient à la titulaire (outil, Radar, assistante) :
 *    pris par la page, il s'écrit dans son agenda « Diagnostics » avec sa
 *    visio ; pris sur Calendly, son événement Calendly reprend sa couleur et
 *    « Occupé », et le lien est celui de Calendly ;
 * 3. la cliente reçoit le mail « nouveau lien de visio » (même jour, même
 *    heure), avec un nouveau lien personnel.
 */
export async function rendreATitulaire(admin: Admin, org: string, bookingId: string, ids: Identifiants): Promise<Rendu> {
  const [{ data: rdv }, { data: titulaire }, { data: ligne }] = await Promise.all([
    admin
      .from("radar_bookings")
      .select("id, status, scheduled_start, scheduled_end, invitee_uri, event_uri, invitee_first_name, invitee_last_name, closeuse_id")
      .eq("id", bookingId)
      .eq("organization_id", org)
      .maybeSingle(),
    admin
      .from("reservation_personnes")
      .select("id, lien_visio")
      .eq("organization_id", org)
      .eq("role", "titulaire")
      .maybeSingle(),
    admin
      .from("reservation_rendez_vous")
      .select("id, personne_id, email")
      .eq("radar_booking_id", bookingId)
      .eq("statut", "confirme")
      .maybeSingle(),
  ]);

  if (!rdv) return { ok: false, erreur: "Rendez-vous introuvable." };
  if (!rdv.closeuse_id) return { ok: false, erreur: "Ce rendez-vous n'est confié à personne." };
  if (rdv.status !== "confirme" || Date.parse(rdv.scheduled_start) <= Date.now()) {
    return { ok: false, erreur: "Seul un rendez-vous confirmé et à venir se reprend." };
  }
  if (!titulaire) return { ok: false, erreur: "Pas de titulaire dans l'outil." };
  if (!ligne) return { ok: false, erreur: "Ce rendez-vous n'a pas de ligne dans l'outil : rien n'a changé." };

  const calendly = !String(rdv.invitee_uri).startsWith("reservation:");
  const espace = await baseEspace(admin, org);
  const site = await siteDuClient(admin, org);

  // 1. Hors de l'agenda de la closeuse.
  try {
    await effacerRendezVous(admin, ligne.id, ids);
  } catch (erreur) {
    console.error("Rendre, effacement Google :", erreur instanceof Error ? erreur.message : "erreur");
  }

  // 3 (préparé). Un nouveau lien personnel : l'ancien, donné par le mail du
  // « Confier », cesse de marcher ; celui-ci arrive dans le mail.
  const nouveauJeton = randomBytes(32).toString("hex");
  const lienPersonnel = lienMonRdv(site, nouveauJeton);

  // 2. Le rendez-vous revient à la titulaire.
  let lienVisio: string | null = null;
  let agendaTitulaire: Teinte | "erreur" | null = null;
  if (calendly) {
    const jetonCal = await jetonAgent(admin, org);
    const ev = jetonCal && rdv.event_uri ? await lireEvenement(jetonCal, rdv.event_uri) : null;
    lienVisio = ev?.location?.join_url ?? titulaire.lien_visio ?? null;
    const { error } = await admin
      .from("reservation_rendez_vous")
      .update({ personne_id: titulaire.id, google_event_id: null, lien_visio: lienVisio, jeton_hash: empreinte(nouveauJeton) })
      .eq("id", ligne.id);
    if (error) return { ok: false, erreur: `Le rendez-vous n'a pas pu revenir : ${error.message}` };
    try {
      const jeton = await lireJeton(admin, titulaire.id);
      agendaTitulaire =
        jeton && ligne.email
          ? await deteindreConfie(await jetonAcces(jeton, ids), {
              debut: rdv.scheduled_start,
              fin: rdv.scheduled_end,
              email: ligne.email,
              nom: [rdv.invitee_first_name, rdv.invitee_last_name].filter(Boolean).join(" "),
            })
          : "sans_droit";
    } catch (erreur) {
      console.error("Rendre, couleur chez la titulaire :", erreur instanceof Error ? erreur.message : "erreur");
      agendaTitulaire = "erreur";
    }
  } else {
    const { error } = await admin
      .from("reservation_rendez_vous")
      .update({ personne_id: titulaire.id, google_event_id: null, lien_visio: null, jeton_hash: empreinte(nouveauJeton) })
      .eq("id", ligne.id);
    if (error) return { ok: false, erreur: `Le rendez-vous n'a pas pu revenir : ${error.message}` };
    try {
      lienVisio = (await ecrireRendezVous(admin, ligne.id, ids, espace)).lienVisio;
    } catch (erreur) {
      console.error("Rendre, écriture Google :", erreur instanceof Error ? erreur.message : "erreur");
    }
  }

  await admin
    .from("radar_bookings")
    .update({ closeuse_id: null, updated_at: new Date().toISOString() })
    .eq("id", bookingId);

  await admin
    .from("agent_conversations")
    .update({ lien_visio: lienVisio, ...(!calendly ? { lien_report: lienPersonnel } : {}) })
    .eq("booking_id", bookingId);

  const mailCliente = await prevenirCliente(lienPersonnel);
  if (!calendly) await prevenirPersonne(admin, ligne.id, "nouveau", espace);

  return { ok: true, mailCliente, calendly, agendaTitulaire };
}

/**
 * Les réponses au formulaire, pour la closeuse (Louis, 07/10/2026). Elles ne
 * s'écrivaient dans `radar_booking_answers` qu'à la réservation, quand le
 * créneau était déjà celui d'une closeuse : un rendez-vous confié ensuite
 * s'affichait « Pas de réponses au formulaire ». La ligne de l'outil les a
 * toutes (page de l'outil, ou copiées de Calendly au « Confier »). Une ligne
 * déjà là n'est pas remplacée.
 */
export async function copierReponses(admin: Admin, org: string, bookingId: string, rdvId: string): Promise<number> {
  const { data } = await admin.from("reservation_rendez_vous").select("reponses").eq("id", rdvId).maybeSingle();
  const reponses = reponsesGardees(
    ((data?.reponses ?? []) as { question?: string; reponse?: string }[]).map((r) => ({
      question: String(r.question ?? ""),
      answer: String(r.reponse ?? ""),
    })),
  );
  if (!reponses.length) return 0;
  const { error } = await admin
    .from("radar_booking_answers")
    .upsert({ booking_id: bookingId, organization_id: org, answers: reponses }, { onConflict: "booking_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return reponses.length;
}
