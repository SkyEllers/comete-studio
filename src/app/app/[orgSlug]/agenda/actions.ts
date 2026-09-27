"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { jourLocal } from "@/tools/agent/temps";
import { deconnecter } from "@/tools/reservation/agenda";
import { maFiche } from "@/tools/reservation/personne";
import {
  absenceSchema,
  maximumSchema,
  plagesSchema,
  problemeAbsence,
  problemePlages,
  visioSchema,
} from "@/tools/reservation/reglages";

/**
 * Ce qu'elle règle dans « Mon agenda ». Tout passe par sa propre session :
 * la RLS de la 0042 ne la laisse écrire que ses horaires, ses absences, son
 * maximum et sa visio, et rien chez les autres.
 */

const PAS_ACCESSIBLE = "Cet espace n'est plus accessible.";
const RATE = "Ça n'a pas marché. Réessaie, et si ça recommence, écris à Louis.";

/**
 * Sous RLS, une écriture refusée ne lève pas toujours d'erreur : elle touche
 * zéro ligne. On demande donc les lignes touchées, et « zéro » est un échec.
 * Le 27/09/2026, « C'est noté » s'affichait sans que rien ne soit écrit.
 */
const rien = (data: unknown[] | null) => !data || data.length === 0;

function rafraichir(orgSlug: string) {
  revalidatePath(`/app/${orgSlug}/agenda`);
}

/** Elle retire son agenda : le jeton est rendu à Google puis effacé. */
export async function deconnecterAgenda(orgSlug: string): Promise<ActionResult> {
  const lue = await maFiche(orgSlug);
  if (!lue) return fail(PAS_ACCESSIBLE);
  try {
    await deconnecter(createAdminClient(), lue.fiche.id);
  } catch (erreur) {
    console.error("Réservation : déconnexion Google échouée", erreur instanceof Error ? erreur.message : erreur);
    return fail("La déconnexion n'a pas marché. Réessaie, et si ça recommence, écris à Louis.");
  }
  rafraichir(orgSlug);
  return ok();
}

/**
 * Ses horaires, remplacés d'un coup. Les nouvelles plages s'écrivent d'abord,
 * les anciennes partent ensuite : si l'écriture échoue, elle garde ses
 * horaires d'avant plutôt que plus rien.
 */
export async function enregistrerHoraires(orgSlug: string, input: unknown): Promise<ActionResult> {
  const lue = await maFiche(orgSlug);
  if (!lue) return fail(PAS_ACCESSIBLE);

  const parsed = plagesSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const probleme = problemePlages(parsed.data);
  if (probleme) return fail(probleme);

  const supabase = await createClient();
  const { data: avant } = await supabase.from("reservation_horaires").select("id").eq("personne_id", lue.fiche.id);

  if (parsed.data.length > 0) {
    const { data, error } = await supabase
      .from("reservation_horaires")
      .insert(parsed.data.map((p) => ({ ...p, personne_id: lue.fiche.id, organization_id: lue.org.id })))
      .select("id");
    if (error || rien(data)) return fail(RATE);
  }
  const anciens = (avant ?? []).map((h) => h.id);
  if (anciens.length > 0) {
    const { data, error } = await supabase.from("reservation_horaires").delete().in("id", anciens).select("id");
    if (error || rien(data)) return fail(RATE);
  }

  rafraichir(orgSlug);
  return ok();
}

export async function ajouterAbsence(orgSlug: string, input: unknown): Promise<ActionResult> {
  const lue = await maFiche(orgSlug);
  if (!lue) return fail(PAS_ACCESSIBLE);

  const parsed = absenceSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const probleme = problemeAbsence(parsed.data, jourLocal(Date.now(), lue.fiche.fuseau));
  if (probleme) return fail(probleme);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservation_absences")
    .insert({ ...parsed.data, personne_id: lue.fiche.id, organization_id: lue.org.id })
    .select("id");
  if (error || rien(data)) return fail(RATE);

  rafraichir(orgSlug);
  return ok();
}

export async function retirerAbsence(orgSlug: string, absenceId: unknown): Promise<ActionResult> {
  const lue = await maFiche(orgSlug);
  if (!lue) return fail(PAS_ACCESSIBLE);
  const id = z.uuid().safeParse(absenceId);
  if (!id.success) return fail("Absence introuvable.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservation_absences")
    .delete()
    .eq("id", id.data)
    .eq("personne_id", lue.fiche.id)
    .select("id");
  if (error || rien(data)) return fail(RATE);

  rafraichir(orgSlug);
  return ok();
}

export async function enregistrerMaximum(orgSlug: string, input: unknown): Promise<ActionResult> {
  const lue = await maFiche(orgSlug);
  if (!lue) return fail(PAS_ACCESSIBLE);
  const parsed = maximumSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservation_personnes")
    .update({ max_par_jour: parsed.data })
    .eq("id", lue.fiche.id)
    .select("id");
  if (error || rien(data)) return fail(RATE);

  rafraichir(orgSlug);
  return ok();
}

export async function enregistrerVisio(orgSlug: string, input: unknown): Promise<ActionResult> {
  const lue = await maFiche(orgSlug);
  if (!lue) return fail(PAS_ACCESSIBLE);
  const parsed = visioSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservation_personnes")
    .update(
      parsed.data.visio === "lien"
        ? { visio: "lien", lien_visio: parsed.data.lien }
        : { visio: "meet", lien_visio: null },
    )
    .eq("id", lue.fiche.id)
    .select("id");
  if (error || rien(data)) return fail(RATE);

  rafraichir(orgSlug);
  return ok();
}
