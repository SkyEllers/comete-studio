"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { centimesSaisis } from "@/tools/resultats/format";
import { MOTIFS } from "@/tools/resultats/non-vente";

/**
 * Ce que la closeuse note après un rendez-vous. Chaque geste passe par une
 * fonction de Radar : elles vérifient elles-mêmes que le rendez-vous est bien
 * le sien (`radar_peut_saisir`, 0036). L'action ne fait que valider la saisie
 * et traduire les refus en phrases.
 */

function lisible(message: string | undefined, defaut: string) {
  const texte = message?.trim();
  return texte && texte.endsWith(".") ? texte : defaut;
}

async function acces(orgSlug: string) {
  const membre = await getMembership(orgSlug);
  return membre && (membre.role === "closeuse" || membre.role === "admin") ? membre : null;
}

/**
 * « Pas venue » notée par erreur : le rendez-vous redevient confirmé avant
 * qu'on y note autre chose. Sans effet s'il l'était déjà.
 */
async function sortirDAbsente(supabase: Awaited<ReturnType<typeof createClient>>, bookingId: string) {
  const { data } = await supabase.from("radar_bookings").select("status").eq("id", bookingId).maybeSingle();
  if (data?.status === "no_show") {
    await supabase.rpc("radar_client_set_status", { booking_id: bookingId, new_status: "confirme" });
  }
}

const idSchema = z.uuid({ error: "Rendez-vous introuvable." });

const venteSchema = z.object({
  bookingId: idSchema,
  montant: z.string().trim().min(1, { error: "Écris le montant total." }).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choisis la date de la vente." }),
  fois: z.coerce.number().int().min(1).max(24),
  premier: z.string().trim().max(20).optional(),
});

export async function noterVente(orgSlug: string, input: unknown): Promise<ActionResult> {
  if (!(await acces(orgSlug))) return fail("Cet espace n'est plus accessible.");

  const parsed = venteSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { bookingId, montant, date, fois, premier } = parsed.data;

  const centimes = centimesSaisis(montant);
  if (centimes === null) return fail("Écris le montant en euros, par exemple 1 520.", "montant");

  let premierCents: number | null = null;
  if (fois > 1 && premier) {
    premierCents = centimesSaisis(premier);
    if (premierCents === null) return fail("Écris le premier paiement en euros, par exemple 500.", "premier");
  }

  const supabase = await createClient();
  await sortirDAbsente(supabase, bookingId);
  const vente = await supabase.rpc("radar_set_sale", {
    booking_id: bookingId,
    amount_cents: centimes,
    sale_date: date,
  });
  if (vente.error) return fail(lisible(vente.error.message, "Cette vente n'a pas pu être enregistrée."));

  const etalement = await supabase.rpc("radar_set_sale_fois", {
    booking_id: bookingId,
    fois,
    premier_cents: premierCents ?? undefined,
  });
  if (etalement.error) {
    return fail(lisible(etalement.error.message, "La vente est notée, mais pas le nombre de paiements."));
  }

  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok();
}

const nonVenteSchema = z.object({
  bookingId: idSchema,
  motif: z.enum(MOTIFS as unknown as [string, ...string[]], { error: "Choisis une raison." }),
  // Le jour où la rappeler, choisi dans un calendrier (0038).
  recontacterLe: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choisis une date dans le calendrier." })
    .nullable()
    .optional(),
});

export async function noterNonVente(orgSlug: string, input: unknown): Promise<ActionResult> {
  if (!(await acces(orgSlug))) return fail("Cet espace n'est plus accessible.");

  const parsed = nonVenteSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();

  // Une vente ou une absence notée par erreur s'enlève d'abord : Radar refuse
  // un motif de non-vente sur l'une comme sur l'autre.
  await sortirDAbsente(supabase, parsed.data.bookingId);
  await supabase.rpc("radar_set_sale", { booking_id: parsed.data.bookingId });

  const { error } = await supabase.rpc("radar_note_non_vente", {
    booking_id: parsed.data.bookingId,
    motif: parsed.data.motif,
    recontacter: parsed.data.recontacterLe ? `${parsed.data.recontacterLe.slice(0, 7)}-01` : undefined,
    recontacter_le: parsed.data.recontacterLe ?? undefined,
  });
  if (error) return fail(lisible(error.message, "Ça n'a pas pu être noté."));

  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok();
}

export async function noterAbsente(orgSlug: string, input: unknown): Promise<ActionResult> {
  if (!(await acces(orgSlug))) return fail("Cet espace n'est plus accessible.");

  const parsed = z.object({ bookingId: idSchema }).safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  await supabase.rpc("radar_set_sale", { booking_id: parsed.data.bookingId });
  const { error } = await supabase.rpc("radar_client_set_status", {
    booking_id: parsed.data.bookingId,
    new_status: "no_show",
  });
  if (error) return fail(lisible(error.message, "Ça n'a pas pu être noté."));

  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok();
}

/** Revenir sur « pas venue » : le rendez-vous redevient à noter. */
export async function annulerAbsence(orgSlug: string, input: unknown): Promise<ActionResult> {
  if (!(await acces(orgSlug))) return fail("Cet espace n'est plus accessible.");

  const parsed = z.object({ bookingId: idSchema }).safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_client_set_status", {
    booking_id: parsed.data.bookingId,
    new_status: "confirme",
  });
  if (error) return fail(lisible(error.message, "Ça n'a pas pu être changé."));

  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok();
}

export async function noterRecontactee(orgSlug: string, input: unknown): Promise<ActionResult> {
  if (!(await acces(orgSlug))) return fail("Cet espace n'est plus accessible.");

  const parsed = z.object({ bookingId: idSchema }).safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_recontact_fait", { booking_id: parsed.data.bookingId });
  if (error) return fail(lisible(error.message, "Ça n'a pas pu être noté."));

  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok();
}
