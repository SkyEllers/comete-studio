import type { NextRequest } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  attribuer,
  precedent,
  reponseDeclaree,
  type Canal,
  type ReglesCanal,
} from "@/tools/resultats/attribution";
import {
  centimes,
  cleInvite,
  messageCalendly,
  motifAnnulation,
  utmRetenus,
  verifierSignature,
} from "@/tools/resultats/calendly";

/**
 * Ce que Calendly nous raconte, une route par client.
 *
 * Première route du hub sans session — d'où la règle ajoutée à CLAUDE.md §7.
 * Elle vérifie une signature avant de lire quoi que ce soit d'interprété, elle
 * est idempotente, elle ne journalise aucune donnée personnelle, et elle
 * n'emploie la clé secrète que pour les tables qu'elle a à écrire.
 *
 * Les codes de retour ne sont pas décoratifs, ils pilotent Calendly :
 *
 *   404  cette adresse ne correspond à aucun client connecté. Sans corps.
 *   401  signature absente, fausse, ou trop vieille. Sans corps.
 *   200  message reçu et traité — ou volontairement ignoré. Jamais de 4xx
 *        pour un payload qui ne passera jamais : Calendly le rejouerait
 *        pendant des heures.
 *   500  c'est nous qui sommes en panne. Là, oui, qu'il rejoue.
 *
 * Une séance manquée, c'est une commission perdue ou facturée à tort. C'est
 * pourquoi tout ce qui n'est pas compris finit dans `radar_webhook_log` avec
 * son motif, plutôt que dans le silence.
 */

export const runtime = "nodejs";

const identifiant = z.uuid();

/** Les deux seuls événements auxquels on est abonné. */
const CREATION = "invitee.created";
const ANNULATION = "invitee.canceled";

const sansCorps = (code: number) => new Response(null, { status: code });

type Journal = {
  event_kind?: string | null;
  invitee_key?: string | null;
  outcome: string;
  message?: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;

  // Une adresse qui n'est même pas un identifiant : on ne touche pas la base,
  // et on ne journalise rien. Sans quoi un scanner remplirait le journal.
  if (!identifiant.safeParse(orgId).success) return sansCorps(404);

  const admin = createAdminClient();

  const noter = async (champs: Journal) => {
    await admin
      .from("radar_webhook_log")
      .insert({ organization_id: orgId, ...champs })
      .then(
        () => undefined,
        () => undefined, // journaliser ne doit jamais faire tomber la route
      );
  };

  try {
    const [reglages, signature] = await Promise.all([
      admin
        .from("radar_settings")
        .select("commission_rate, window_days, currency, connected_at")
        .eq("organization_id", orgId)
        .maybeSingle(),
      admin.rpc("radar_get_secret", { org: orgId, kind: "signing_key" }),
    ]);

    // Client inconnu, ou Calendly jamais relié : rien à dire, et surtout rien
    // à confirmer à qui frappe à la porte.
    if (!reglages.data || !reglages.data.connected_at) return sansCorps(404);

    const cleSignature = signature.data;
    if (!cleSignature) {
      await noter({ outcome: "error", message: "clé de signature introuvable" });
      return sansCorps(500);
    }

    // Le corps brut, tel quel : c'est lui qui est signé. Le relire après
    // `JSON.parse` puis le ré-imprimer donnerait un autre texte, donc une
    // autre signature.
    const corps = await request.text();

    if (
      !verifierSignature({
        entete: request.headers.get("calendly-webhook-signature"),
        corps,
        cle: cleSignature,
      })
    ) {
      await noter({ outcome: "invalid_signature" });
      return sansCorps(401);
    }

    let brut: unknown;
    try {
      brut = JSON.parse(corps);
    } catch {
      await noter({ outcome: "invalid_payload", message: "JSON illisible" });
      return sansCorps(200);
    }

    const lu = messageCalendly.safeParse(brut);
    if (!lu.success) {
      await noter({
        outcome: "invalid_payload",
        message: lu.error.issues[0]?.path.join(".") || "forme inattendue",
      });
      return sansCorps(200);
    }

    const message = lu.data;
    const invite = message.payload;

    if (message.event !== CREATION && message.event !== ANNULATION) {
      await noter({ event_kind: message.event, outcome: "ignored" });
      return sansCorps(200);
    }

    const sel = (await admin.rpc("radar_get_secret", { org: orgId, kind: "salt" })).data;
    if (!sel) {
      await noter({
        event_kind: message.event,
        outcome: "error",
        message: "sel introuvable",
      });
      return sansCorps(500);
    }

    // À partir d'ici, l'email n'existe plus.
    const invitee_key = cleInvite(sel, invite.email);
    const recuLe = message.created_at ?? new Date().toISOString();

    const accepter = async (kind: string) => {
      await admin
        .from("radar_settings")
        .update({ last_webhook_at: new Date().toISOString() })
        .eq("organization_id", orgId);
      await noter({ event_kind: kind, invitee_key, outcome: "accepted" });
      return sansCorps(200);
    };

    // ----------------------------- Annulation -----------------------------

    if (message.event === ANNULATION) {
      const { data: connu } = await admin
        .from("radar_bookings")
        .select("id, status")
        .eq("invitee_uri", invite.uri)
        .maybeSingle();

      if (!connu) {
        await noter({ event_kind: message.event, invitee_key, outcome: "ignored" });
        return sansCorps(200);
      }

      await admin
        .from("radar_bookings")
        .update({
          status: "annule",
          status_origin: "calendly",
          status_note: motifAnnulation(invite.rescheduled),
          canceled_at: recuLe,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connu.id);

      await admin.from("radar_booking_activities").insert({
        booking_id: connu.id,
        organization_id: orgId,
        type: "booking.canceled",
        payload: { reprogramme: Boolean(invite.rescheduled), from: connu.status },
      });

      return accepter(message.event);
    }

    // ------------------------------ Création ------------------------------

    const { data: dejaVu } = await admin
      .from("radar_bookings")
      .select("id")
      .eq("invitee_uri", invite.uri)
      .maybeSingle();

    // Calendry rejoue ses messages : deux livraisons, un seul rendez-vous.
    if (dejaVu) {
      await noter({ event_kind: message.event, invitee_key, outcome: "duplicate" });
      return sansCorps(200);
    }

    const [canaux, historique, ancien] = await Promise.all([
      admin
        .from("radar_channels")
        .select("id, key, label, is_comete, rules, sort_order, is_active")
        .eq("organization_id", orgId),
      admin
        .from("radar_bookings")
        .select("channel_id, scheduled_start, status")
        .eq("organization_id", orgId)
        .eq("invitee_key", invitee_key)
        .order("scheduled_start", { ascending: false })
        .limit(50),
      invite.old_invitee
        ? admin
            .from("radar_bookings")
            .select("id, channel_id, attribution")
            .eq("invitee_uri", invite.old_invitee)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const channels: Canal[] = (canaux.data ?? []).map((canal) => ({
      ...canal,
      rules: (canal.rules ?? {}) as ReglesCanal,
    }));

    const utm = utmRetenus(invite.tracking);
    const debut = invite.scheduled_event.start_time;

    /*
     * Une séance reprogrammée n'est pas une nouvelle acquisition : elle garde
     * le canal de celle qu'elle remplace. Sans ça, déplacer un rendez-vous
     * suffirait à le faire basculer en « direct » — et à effacer le canal qui
     * l'avait amené.
     */
    const heritage = invite.rescheduled && ancien.data ? ancien.data : null;

    const verdict = heritage
      ? { channel_id: heritage.channel_id, attribution: heritage.attribution }
      : attribuer({
          utm,
          scheduledStart: debut,
          channels,
          previous: precedent(historique.data ?? [], debut),
          windowDays: reglages.data.window_days,
        });

    const paiement = invite.payment;

    const { data: cree, error } = await admin
      .from("radar_bookings")
      .insert({
        organization_id: orgId,
        invitee_uri: invite.uri,
        event_uri: invite.scheduled_event.uri,
        invitee_key,
        scheduled_start: debut,
        scheduled_end: invite.scheduled_event.end_time,
        event_type_name: invite.scheduled_event.name,
        event_type_uri: invite.scheduled_event.event_type ?? null,
        utm,
        declared_source: reponseDeclaree(invite.questions_and_answers ?? []),
        channel_id: verdict.channel_id,
        attribution: verdict.attribution,
        status: "confirme",
        status_origin: "calendly",
        amount_cents: centimes(paiement?.amount),
        currency: paiement?.currency?.toUpperCase() || reglages.data.currency,
        payment_ok: paiement?.successful === true,
        payment_ref: paiement?.external_id ?? null,
        rescheduled_from: heritage?.id ?? null,
      })
      .select("id")
      .single();

    if (error || !cree) {
      // Course entre deux livraisons simultanées : la contrainte d'unicité sur
      // `invitee_uri` a tranché, et c'est très bien ainsi.
      const doublon = error?.code === "23505";
      await noter({
        event_kind: message.event,
        invitee_key,
        outcome: doublon ? "duplicate" : "error",
        message: doublon ? null : "insertion refusée",
      });
      return sansCorps(doublon ? 200 : 500);
    }

    await admin.from("radar_booking_activities").insert({
      booking_id: cree.id,
      organization_id: orgId,
      type: heritage ? "booking.rescheduled" : "booking.created",
      payload: {
        attribution: verdict.attribution,
        utm,
        ...(heritage ? { rescheduled_from: heritage.id } : {}),
      },
    });

    return accepter(message.event);
  } catch {
    // Rien de l'exception ne part dans le journal : elle pourrait porter un
    // fragment de payload.
    await noter({ outcome: "error", message: "erreur interne" });
    return sansCorps(500);
  }
}
