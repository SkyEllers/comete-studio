"use server";

import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/admin";

import { rendezVousAccessible } from "./acces";

/**
 * La fiche de la cliente (P16, Louis, 28/09/2026) : la fiche du rendez-vous
 * dans Radar devient la fiche de la personne, du premier clic au paiement.
 * Ici, ce que le hub sait déjà : sa réservation (ses réponses), et ce qui
 * s'est passé avec l'assistante WhatsApp. Le canal, le diagnostic, l'issue et
 * le devis ont leurs propres blocs sur la fiche.
 *
 * Ce que le hub ne sait pas encore (l'inscription à la masterclass, la
 * catégorie du quiz, les mails Brevo, le détail Stripe) vit dans le site et
 * dans Brevo : une étape suivante, avec un secret partagé entre le hub et le
 * site.
 */

const idSchema = z.uuid({ error: "Rendez-vous introuvable." });

type NoteIa = { ia?: { note_pour_peggy?: string | null } } | null;

export type Parcours = {
  reservation: { reserveLe: string | null; reponses: { question: string; reponse: string }[] } | null;
  whatsapp: {
    etat: string;
    premiereReponseLe: string | null;
    confirmeLe: string | null;
    reportsAgent: number;
    stopLe: string | null;
    sansReponseVeille: boolean;
    annuleeParAgentLe: string | null;
    raisonCategorie: string | null;
    notes: string[];
  } | null;
};

function reponsesLisibles(brut: unknown): { question: string; reponse: string }[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .map((r) => {
      const q = (r as { question?: unknown })?.question;
      const v = (r as { reponse?: unknown })?.reponse;
      const reponse = Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : typeof v === "string" ? v : "";
      return typeof q === "string" && reponse.trim() ? { question: q.trim(), reponse: reponse.trim() } : null;
    })
    .filter((x): x is { question: string; reponse: string } => x !== null);
}

export async function lireParcours(orgSlug: string, bookingId: string): Promise<ActionResult<Parcours>> {
  const parsed = idSchema.safeParse(bookingId);
  if (!parsed.success) return failFromZod(parsed.error);
  const lu = await rendezVousAccessible(orgSlug, parsed.data);
  if (!lu) return fail("Ce rendez-vous ne t'est pas accessible.");

  const admin = createAdminClient();
  const [{ data: resa }, { data: conv }] = await Promise.all([
    admin
      .from("reservation_rendez_vous")
      .select("created_at, reponses")
      .eq("radar_booking_id", lu.rdv.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("agent_conversations")
      .select(
        "id, reserve_le, reponses, etat, premiere_reponse_le, confirme_le, reports_agent, stop_le, sans_reponse_veille, annulee_par_agent_le, raison_categorie",
      )
      .eq("booking_id", lu.rdv.id)
      .eq("simulation", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let notes: string[] = [];
  if (conv) {
    const { data: entrants } = await admin
      .from("agent_messages")
      .select("comprehension")
      .eq("conversation_id", conv.id)
      .eq("sens", "entrant")
      .order("created_at");
    notes = [
      ...new Set(
        (entrants ?? [])
          .map((m) => ((m.comprehension as NoteIa)?.ia?.note_pour_peggy ?? "").trim())
          .filter(Boolean),
      ),
    ];
  }

  const reponses = reponsesLisibles(resa?.reponses ?? conv?.reponses);
  return ok({
    reservation:
      resa || conv
        ? { reserveLe: resa?.created_at ?? conv?.reserve_le ?? null, reponses }
        : null,
    whatsapp: conv
      ? {
          etat: conv.etat,
          premiereReponseLe: conv.premiere_reponse_le,
          confirmeLe: conv.confirme_le,
          reportsAgent: conv.reports_agent,
          stopLe: conv.stop_le,
          sansReponseVeille: conv.sans_reponse_veille,
          annuleeParAgentLe: conv.annulee_par_agent_le,
          raisonCategorie: conv.raison_categorie,
          notes,
        }
      : null,
  });
}
