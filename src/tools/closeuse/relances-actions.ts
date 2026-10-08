"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { ETAPES_RELANCE, type EtapeRelance, type Relances } from "./relances";

/**
 * Les relances notées par la closeuse (0058, 08/10/2026). Écritures en service
 * role après contrôle : seule la closeuse du rendez-vous coche ou décoche.
 */

// La table arrive avec 0058 : les types générés ne la connaissent pas encore.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brut = (admin: ReturnType<typeof createAdminClient>) => admin as any;

const cocherSchema = z.object({
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  etape: z.enum(ETAPES_RELANCE.map((e) => e.cle) as [EtapeRelance, ...EtapeRelance[]]),
  coche: z.boolean(),
});

export async function cocherRelance(orgSlug: string, input: unknown): Promise<ActionResult<{ cocheLe: string | null }>> {
  const acces = await getMembership(orgSlug);
  if (!acces) return fail("Cet espace n'est plus accessible.");
  if (acces.role !== "closeuse") return fail("Seule la closeuse du rendez-vous coche ses relances.");
  const parsed = cocherSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { bookingId, etape, coche } = parsed.data;

  const admin = createAdminClient();
  const { data: rdv } = await admin
    .from("radar_bookings")
    .select("id, organization_id, closeuse_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!rdv || rdv.organization_id !== acces.org.id || rdv.closeuse_id !== acces.userId) {
    return fail("Ce rendez-vous ne t'est pas confié.");
  }

  if (!coche) {
    const { error } = await brut(admin).from("radar_relances").delete().eq("booking_id", bookingId).eq("etape", etape);
    if (error) return fail("Ça n'a pas pu être enlevé.");
    revalidatePath(`/app/${orgSlug}/closeuse`);
    return ok({ cocheLe: null });
  }
  const cocheLe = new Date().toISOString();
  const { error } = await brut(admin)
    .from("radar_relances")
    .upsert(
      { booking_id: bookingId, organization_id: acces.org.id, etape, user_id: acces.userId, coche_le: cocheLe },
      { onConflict: "booking_id,etape", ignoreDuplicates: true },
    );
  if (error) return fail("Ça n'a pas pu être noté.");
  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok({ cocheLe });
}

/** Les relances d'un rendez-vous, pour la fiche Radar de la titulaire. */
export async function lireRelances(orgSlug: string, bookingId: string): Promise<ActionResult<Relances>> {
  const acces = await getMembership(orgSlug);
  if (!acces) return fail("Cet espace n'est plus accessible.");
  if (!z.uuid().safeParse(bookingId).success) return fail("Rendez-vous introuvable.");
  // Lu avec la session : la RLS de 0058 dit qui peut voir.
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("radar_relances")
    .select("etape, coche_le")
    .eq("organization_id", acces.org.id)
    .eq("booking_id", bookingId);
  const relances: Relances = {};
  for (const l of (data ?? []) as { etape: EtapeRelance; coche_le: string }[]) relances[l.etape] = l.coche_le;
  return ok(relances);
}
