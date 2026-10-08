"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { rappelRecontact } from "@/tools/reservation/agenda";
import { identifiants } from "@/tools/reservation/google";
import { centimesSaisis } from "@/tools/resultats/format";
import { LIBELLES_MOTIF, MOTIFS, type Motif } from "@/tools/resultats/non-vente";

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

/**
 * Le rappel « La rappeler le » dans l'agenda Google de la closeuse du
 * rendez-vous (Louis, 08/10/2026) : posé ou déplacé avec une date, retiré
 * sans. Ne fait jamais échouer ce qu'elle vient de noter.
 */
async function majRappel(orgSlug: string, bookingId: string, rappel: { date: string; motif: Motif } | null) {
  const ids = identifiants();
  if (!ids) return;
  const admin = createAdminClient();
  const [{ data: rdv }, { data: reponses }, { data: ligne }] = await Promise.all([
    admin
      .from("radar_bookings")
      .select("organization_id, closeuse_id, invitee_first_name, invitee_last_name")
      .eq("id", bookingId)
      .maybeSingle(),
    admin.from("radar_booking_answers").select("answers").eq("booking_id", bookingId).maybeSingle(),
    admin.from("reservation_rendez_vous").select("telephone").eq("radar_booking_id", bookingId).limit(1).maybeSingle(),
  ]);
  if (!rdv?.closeuse_id) return;
  const qui = [rdv.invitee_first_name, rdv.invitee_last_name].filter(Boolean).join(" ") || "ta cliente";
  const tel =
    ligne?.telephone ||
    ((reponses?.answers ?? []) as { q: string; r: string }[]).find((x) => /t[ée]l[ée]phone/i.test(x.q))?.r ||
    null;
  const racine = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.cometestudio.fr").replace(/\/+$/, "");
  await rappelRecontact(
    admin,
    ids,
    rdv.closeuse_id,
    rdv.organization_id,
    bookingId,
    rappel
      ? {
          date: rappel.date,
          titre: `Rappeler ${qui}${tel ? ` · ${tel}` : ""}`,
          description: [
            `Elle n'a pas acheté : ${LIBELLES_MOTIF[rappel.motif].toLowerCase()}.`,
            "Elle est aussi dans ton espace, dans « À recontacter ». Après l'appel : « C'est fait ».",
            `${racine}/app/${orgSlug}/closeuse`,
          ].join("\n"),
        }
      : null,
  );
}

/**
 * L'enregistrement du diagnostic est réglé (0049, Louis, 28/09/2026) : une
 * vidéo déposée, ou « pas d'enregistrement » avec son résumé. Exigé la
 * première fois qu'on note l'issue d'un rendez-vous tenu ; corriger une issue
 * déjà notée ne le redemande pas.
 */
async function diagnosticRegle(supabase: Awaited<ReturnType<typeof createClient>>, bookingId: string) {
  const [{ data: enregistrement }, { data: rdv }, { data: activites }] = await Promise.all([
    supabase.from("radar_diagnostic_enregistrements").select("booking_id").eq("booking_id", bookingId).maybeSingle(),
    supabase.from("radar_bookings").select("sale_amount_cents").eq("id", bookingId).maybeSingle(),
    supabase
      .from("radar_booking_activities")
      .select("id")
      .eq("booking_id", bookingId)
      .in("type", ["sale.declined", "sale.reason"])
      .limit(1),
  ]);
  return Boolean(enregistrement) || rdv?.sale_amount_cents != null || (activites?.length ?? 0) > 0;
}

const SANS_ENREGISTREMENT =
  "Dépose l'enregistrement du diagnostic, ou dis que tu n'en as pas et écris le résumé.";

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
  if (!(await diagnosticRegle(supabase, bookingId))) return fail(SANS_ENREGISTREMENT);
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
  await majRappel(orgSlug, bookingId, null);

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
  if (!(await diagnosticRegle(supabase, parsed.data.bookingId))) return fail(SANS_ENREGISTREMENT);

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

  await majRappel(
    orgSlug,
    parsed.data.bookingId,
    parsed.data.recontacterLe ? { date: parsed.data.recontacterLe, motif: parsed.data.motif as Motif } : null,
  );
  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok();
}

export async function noterAbsente(orgSlug: string, input: unknown): Promise<ActionResult> {
  if (!(await acces(orgSlug))) return fail("Cet espace n'est plus accessible.");

  // Une note facultative (Peggy Auger, 08/10/2026 : « pas de réponse aux
  // SMS », « prévenue au moment du call »), gardée dans `status_note` et lue
  // par la titulaire dans Radar.
  const parsed = z
    .object({ bookingId: idSchema, note: z.string().trim().max(500, { error: "500 caractères au plus." }).optional() })
    .safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  await supabase.rpc("radar_set_sale", { booking_id: parsed.data.bookingId });
  const { error } = await supabase.rpc("radar_client_set_status", {
    booking_id: parsed.data.bookingId,
    new_status: "no_show",
    note: parsed.data.note || undefined,
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
  await majRappel(orgSlug, parsed.data.bookingId, null);

  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok();
}
