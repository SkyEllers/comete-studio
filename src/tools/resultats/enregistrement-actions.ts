"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { BUCKET_DIAGNOSTICS, lancerTranscription } from "./enregistrement-assemblyai";
import type { EtatTranscription } from "./enregistrement-format";

/**
 * Déposer l'enregistrement d'un diagnostic, ou dire qu'il n'y en a pas (0049).
 *
 * Le fichier part du navigateur vers le Storage en TUS (il pèse des centaines
 * de Mo) ; ces actions n'enregistrent que ce qui en découle. Les droits sont
 * dans les fonctions de la base, comme toute saisie de Radar : l'action
 * valide, appelle, et relaie leurs refus.
 */

function lisible(message: string | undefined, defaut: string) {
  const texte = message?.trim();
  return texte && texte.endsWith(".") ? texte : defaut;
}

function rafraichir(orgSlug: string) {
  revalidatePath(`/app/${orgSlug}/closeuse`);
  revalidatePath(`/app/${orgSlug}/resultats/rendez-vous`);
}

const idSchema = z.uuid({ error: "Rendez-vous introuvable." });

const depotSchema = z.object({
  bookingId: idSchema,
  chemin: z.string().min(1).max(300),
  nom: z.string().trim().max(255),
  taille: z.number().int().min(0),
});

export async function deposerEnregistrement(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ transcription: EtatTranscription }>> {
  if (!(await getMembership(orgSlug))) return fail("Cet espace n'est plus accessible.");

  const parsed = depotSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { bookingId, chemin, nom, taille } = parsed.data;

  const supabase = await createClient();
  const { data: ancien, error } = await supabase.rpc("radar_diagnostic_deposer", {
    booking_id: bookingId,
    chemin,
    nom,
    taille,
  });
  if (error) return fail(lisible(error.message, "L'enregistrement n'a pas pu être rangé sur la fiche."));

  const admin = createAdminClient();

  // Remplacé : l'ancien fichier ne sert plus à personne.
  if (ancien) {
    const { error: retrait } = await admin.storage.from(BUCKET_DIAGNOSTICS).remove([ancien]);
    if (retrait) console.error(`[diagnostic] ancien fichier non retiré (${bookingId})`);
  }

  const transcription = await lancerTranscription(admin, bookingId);
  rafraichir(orgSlug);
  return ok({ transcription });
}

const texte = z.string().trim().min(1, { error: "Remplis les quatre parties du résumé." }).max(2000, {
  error: "Une partie du résumé dépasse 2 000 caractères.",
});

const sansSchema = z.object({
  bookingId: idSchema,
  resume: z.object({ probleme: texte, objectif: texte, freins: texte, propose: texte }),
});

export async function noterSansEnregistrement(orgSlug: string, input: unknown): Promise<ActionResult> {
  if (!(await getMembership(orgSlug))) return fail("Cet espace n'est plus accessible.");

  const parsed = sansSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_diagnostic_sans", {
    booking_id: parsed.data.bookingId,
    resume: parsed.data.resume,
  });
  if (error) return fail(lisible(error.message, "Le résumé n'a pas pu être enregistré."));

  rafraichir(orgSlug);
  return ok();
}

export async function relancerTranscription(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ transcription: EtatTranscription }>> {
  if (!(await getMembership(orgSlug))) return fail("Cet espace n'est plus accessible.");

  const parsed = z.object({ bookingId: idSchema }).safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  // Qui relance doit voir l'enregistrement : la RLS de la 0049 en décide.
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_diagnostic_enregistrements")
    .select("chemin, transcription_etat")
    .eq("booking_id", parsed.data.bookingId)
    .maybeSingle();
  if (!data?.chemin) return fail("Il n'y a pas d'enregistrement sur ce rendez-vous.");
  if (data.transcription_etat === "en_cours" || data.transcription_etat === "faite") {
    return ok({ transcription: data.transcription_etat as EtatTranscription });
  }

  const transcription = await lancerTranscription(createAdminClient(), parsed.data.bookingId);
  rafraichir(orgSlug);
  if (transcription === "echec") return fail("La transcription n'a pas pu partir. Réessaie dans quelques minutes.");
  return ok({ transcription });
}
