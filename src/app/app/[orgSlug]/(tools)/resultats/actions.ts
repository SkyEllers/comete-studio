"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

/**
 * Ce que le client peut changer lui-même : le statut d'une séance.
 *
 * L'écriture directe sur `radar_bookings` lui est fermée ; il passe par
 * `radar_client_set_status`, qui vérifie ce qu'une politique RLS ne saurait
 * dire — le relevé du mois est-il clôturé, le statut de départ est-il l'un des
 * trois permis, l'annulation vient-elle de Calendly. La fonction refuse en
 * français ; on relaie son message tel quel plutôt que de le traduire une
 * seconde fois et de risquer d'en dire moins.
 */

const changementSchema = z.object({
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  statut: z.enum(["confirme", "no_show", "annule"], { error: "Statut inconnu." }),
});

export async function marquerStatut(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await getMembership(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = changementSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_client_set_status", {
    booking_id: parsed.data.bookingId,
    new_status: parsed.data.statut,
  });

  if (error) {
    // Les messages de la fonction sont écrits pour être lus ; ceux de Postgres
    // ne le sont pas. On distingue les deux à la ponctuation, faute de mieux.
    const lisible = error.message?.trim();
    return fail(
      lisible && lisible.endsWith(".")
        ? lisible
        : "Ce changement n'a pas pu être enregistré.",
    );
  }

  revalidatePath(`/app/${orgSlug}/resultats`);
  revalidatePath(`/app/${orgSlug}/resultats/rendez-vous`);
  return ok();
}
