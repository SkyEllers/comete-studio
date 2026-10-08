import "server-only";

import { randomBytes } from "node:crypto";

import type { createAdminClient } from "@/lib/supabase/admin";
import { annulerAncien, jetonAgent } from "@/tools/agent/calendly";
import { attribuer, precedent, reponseDeclaree, type Canal, type ReglesCanal } from "@/tools/resultats/attribution";
import { cleInvite, nomInvite, reponsesGardees, utmRetenus } from "@/tools/resultats/calendly";

/**
 * Les rendez-vous de l'outil de réservation dans Radar, sans Calendly.
 *
 * Même ligne que celle du webhook Calendly (`api/webhooks/calendly/[orgId]`),
 * écrite de la même façon : clé de la personne par le sel du client (l'email
 * n'entre pas dans Radar), canal par `attribuer`, un report hérite du canal de
 * celui qu'il remplace, réponses gardées pour une closeuse seulement. Trois
 * différences :
 *
 * - `invitee_uri` et `event_uri` valent `reservation:<id du rendez-vous>` ;
 *   le type de séance `reservation:diagnostic` (un filtre suivi, à part) ;
 * - `status_origin` vaut `reservation` (0047) ;
 * - la personne est connue d'avance : `closeuse_id` est l'utilisateur de la
 *   closeuse choisie par le moteur, vide pour la titulaire.
 *
 * Idempotent : un rendez-vous déjà relié (`radar_booking_id`) ne se réécrit
 * pas. Ne lève jamais : Radar ne doit pas faire échouer une réservation. Un
 * échec se journalise sans donnée personnelle, et `radar_booking_id` reste
 * vide.
 */

type Admin = ReturnType<typeof createAdminClient>;

export const TYPE_URI = "reservation:diagnostic";
export const TYPE_NOM = "Diagnostic offert (réservation maison)";
export const uriRadar = (rdvId: string) => `reservation:${rdvId}`;
/** Une annulation demandée à l'assistante WhatsApp : la raison s'y ajoute quand elle la donne. */
export const NOTE_ANNULEE_AGENT = "Annulée par la personne, avec l'assistante";

async function sel(db: Admin, org: string): Promise<string | null> {
  const lu = await db.rpc("radar_get_secret", { org, kind: "salt" });
  if (lu.data) return lu.data;
  // Un client sans Calendly relié n'a pas encore de sel : on lui en pose un,
  // comme la connexion de Calendly le ferait.
  const neuf = randomBytes(32).toString("hex");
  const pose = await db.rpc("radar_set_secret", { org, kind: "salt", value: neuf });
  return pose.error ? null : neuf;
}

export async function versRadar(db: Admin, rdvId: string): Promise<string | null> {
  try {
    const { data: rdv } = await db
      .from("reservation_rendez_vous")
      .select(
        "id, organization_id, debut, fin, prenom, nom, email, utm, reponses, reporte_de, radar_booking_id, personne:reservation_personnes!reservation_rendez_vous_personne_id_organization_id_fkey(role, user_id)",
      )
      .eq("id", rdvId)
      .single();
    if (!rdv) return null;
    if (rdv.radar_booking_id) return rdv.radar_booking_id;
    const org = rdv.organization_id;
    const personne = rdv.personne as unknown as { role: string; user_id: string };

    const { data: reglages } = await db
      .from("radar_settings")
      .select("window_days, currency")
      .eq("organization_id", org)
      .maybeSingle();
    // Radar n'est pas préparé pour ce client : rien à écrire.
    if (!reglages || !rdv.email) return null;

    const cle = await sel(db, org);
    if (!cle) throw new Error("sel introuvable");
    const invitee_key = cleInvite(cle, rdv.email);

    await db
      .from("radar_event_filters")
      .upsert(
        { organization_id: org, event_type_uri: TYPE_URI, event_type_name: TYPE_NOM },
        { onConflict: "organization_id,event_type_uri", ignoreDuplicates: true },
      );
    const { data: filtre } = await db
      .from("radar_event_filters")
      .select("tracked")
      .eq("organization_id", org)
      .eq("event_type_uri", TYPE_URI)
      .maybeSingle();
    if (filtre && !filtre.tracked) return null;

    // Un report : le rendez-vous d'origine, et sa ligne Radar.
    const ancien = rdv.reporte_de
      ? (
          await db
            .from("reservation_rendez_vous")
            .select("radar_booking_id")
            .eq("id", rdv.reporte_de)
            .eq("organization_id", org)
            .maybeSingle()
        ).data
      : null;

    const [canaux, historique, heritage] = await Promise.all([
      db
        .from("radar_channels")
        .select("id, key, label, is_comete, rules, sort_order, is_active")
        .eq("organization_id", org),
      db
        .from("radar_bookings")
        .select("id, channel_id, scheduled_start, status")
        .eq("organization_id", org)
        .eq("invitee_key", invitee_key)
        .order("scheduled_start", { ascending: false })
        .limit(50),
      ancien?.radar_booking_id
        ? db
            .from("radar_bookings")
            .select("id, channel_id, attribution")
            .eq("organization_id", org)
            .eq("id", ancien.radar_booking_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const channels: Canal[] = (canaux.data ?? []).map((c) => ({ ...c, rules: (c.rules ?? {}) as ReglesCanal }));
    const utm = utmRetenus(rdv.utm as Record<string, unknown>);
    const h = heritage.data;
    const verdict = h
      ? { channel_id: h.channel_id, attribution: h.attribution, source: h.id }
      : attribuer({
          utm,
          scheduledStart: rdv.debut,
          channels,
          previous: precedent(historique.data ?? [], rdv.debut),
          windowDays: reglages.window_days,
        });

    const questions = ((rdv.reponses ?? []) as { question: string; reponse: string }[]).map((r) => ({
      question: r.question,
      answer: r.reponse,
    }));
    const { prenom, nom } = nomInvite({ first_name: rdv.prenom, last_name: rdv.nom });
    const closeuse = personne.role === "closeuse" ? personne.user_id : null;

    const { data: cree, error } = await db
      .from("radar_bookings")
      .insert({
        organization_id: org,
        invitee_uri: uriRadar(rdv.id),
        event_uri: uriRadar(rdv.id),
        invitee_key,
        invitee_first_name: prenom,
        invitee_last_name: nom,
        scheduled_start: rdv.debut,
        scheduled_end: rdv.fin,
        event_type_name: TYPE_NOM,
        event_type_uri: TYPE_URI,
        utm,
        declared_source: reponseDeclaree(questions),
        channel_id: verdict.channel_id,
        attribution: verdict.attribution,
        attribution_source_id: verdict.source,
        status: "confirme",
        status_origin: "reservation",
        amount_cents: 0,
        currency: reglages.currency,
        payment_ok: false,
        rescheduled_from: h?.id ?? null,
        closeuse_id: closeuse,
      })
      .select("id")
      .single();

    let radarId = cree?.id ?? null;
    if (error || !cree) {
      // Deux écritures simultanées du même rendez-vous : on garde la première.
      if (error?.code !== "23505") throw new Error(`insertion Radar : ${error?.message ?? "refusée"}`);
      const { data: existant } = await db
        .from("radar_bookings")
        .select("id")
        .eq("invitee_uri", uriRadar(rdv.id))
        .maybeSingle();
      radarId = existant?.id ?? null;
    } else {
      if (closeuse) {
        const reponses = reponsesGardees(questions);
        if (reponses.length > 0) {
          await db.from("radar_booking_answers").insert({ booking_id: cree.id, organization_id: org, answers: reponses });
        }
      }
      await db.from("radar_booking_activities").insert({
        booking_id: cree.id,
        organization_id: org,
        type: h ? "booking.rescheduled" : "booking.created",
        payload: { attribution: verdict.attribution, utm, outil: "reservation", ...(h ? { rescheduled_from: h.id } : {}) },
      });
    }

    if (radarId) await db.from("reservation_rendez_vous").update({ radar_booking_id: radarId }).eq("id", rdv.id);
    return radarId;
  } catch (erreur) {
    console.error("Réservation, Radar :", erreur instanceof Error ? erreur.message : "erreur");
    return null;
  }
}

/**
 * Le rendez-vous est tombé : sa ligne Radar passe « annulé ». Un report
 * (`reprogramme`) le dit, pour que Radar ne le compte pas comme un
 * désistement. Ne lève jamais.
 *
 * Un rendez-vous pris sur Calendly puis confié à une closeuse a une ligne
 * dans l'outil : la cliente peut l'annuler ou le déplacer avec son lien
 * personnel. Il s'annule alors aussi chez Calendly (Louis, 08/10/2026 :
 * Sandrine D. avait annulé par l'outil, Calendly la croyait encore réservée,
 * l'événement restait chez Peggy et Calendly pouvait encore lui écrire). Le
 * webhook Calendly qui suit ne recompte rien : la ligne est déjà annulée.
 */
export async function annulerDansRadar(
  db: Admin,
  rdvId: string,
  { reprogramme, par }: { reprogramme: boolean; par: "cliente" | "agent" | "personne" | "admin" },
): Promise<void> {
  try {
    const { data: rdv } = await db
      .from("reservation_rendez_vous")
      .select("organization_id, radar_booking_id")
      .eq("id", rdvId)
      .single();
    if (!rdv?.radar_booking_id) return;

    const { data: ligne } = await db
      .from("radar_bookings")
      .select("id, status, invitee_uri, event_uri")
      .eq("id", rdv.radar_booking_id)
      .eq("organization_id", rdv.organization_id)
      .maybeSingle();
    if (!ligne || ligne.status === "annule") return;

    // L'agent n'annule qu'à sa demande (0048) : c'est elle qui annule.
    const note = reprogramme
      ? par === "agent"
        ? "Reprogrammée par l'assistante"
        : "Reprogrammée par la personne"
      : par === "cliente"
        ? "Annulée par la personne"
        : par === "agent"
          ? NOTE_ANNULEE_AGENT
          : "Annulée par toi";

    await db
      .from("radar_bookings")
      .update({
        status: "annule",
        status_origin: "reservation",
        status_note: note,
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", ligne.id);

    await db.from("radar_booking_activities").insert({
      booking_id: ligne.id,
      organization_id: rdv.organization_id,
      type: "booking.canceled",
      payload: {
        reprogramme,
        from: ligne.status,
        par: par === "cliente" || (par === "agent" && !reprogramme) ? "invitee" : par === "agent" ? null : "host",
        outil: "reservation",
        ...(par === "agent" ? { agent: true } : {}),
      },
    });

    if (evenementCalendly(ligne.invitee_uri, ligne.event_uri)) {
      const jeton = await jetonAgent(db, rdv.organization_id);
      if (jeton) {
        await annulerAncien(
          jeton,
          ligne.event_uri as string,
          reprogramme
            ? "Rendez-vous déplacé : la nouvelle date vous a été envoyée par mail."
            : "Rendez-vous annulé depuis votre lien personnel.",
        );
      } else {
        console.error("Réservation : pas de jeton Calendly, rendez-vous Calendly non annulé");
      }
    }
  } catch (erreur) {
    console.error("Réservation, Radar (annulation) :", erreur instanceof Error ? erreur.message : "erreur");
  }
}

/** Ce rendez-vous Radar vient-il de Calendly, avec un événement qu'on peut annuler ? */
export function evenementCalendly(inviteeUri: string | null, eventUri: string | null): boolean {
  return (
    Boolean(inviteeUri) &&
    !String(inviteeUri).startsWith("reservation:") &&
    /^https:\/\/api\.calendly\.com\/scheduled_events\/[^/]+$/.test(eventUri ?? "")
  );
}
