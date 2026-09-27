"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { deconnecter } from "@/tools/reservation/agenda";
import { maFiche } from "@/tools/reservation/personne";

/** Elle retire son agenda : le jeton est rendu à Google puis effacé. */
export async function deconnecterAgenda(orgSlug: string): Promise<ActionResult> {
  const lue = await maFiche(orgSlug);
  if (!lue) return fail("Cet espace n'est plus accessible.");
  try {
    await deconnecter(createAdminClient(), lue.fiche.id);
  } catch (erreur) {
    console.error("Réservation : déconnexion Google échouée", erreur instanceof Error ? erreur.message : erreur);
    return fail("La déconnexion n'a pas marché. Réessaie, et si ça recommence, écris à Louis.");
  }
  revalidatePath(`/app/${orgSlug}/agenda`);
  return ok();
}
