"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Ce que Louis coche sur la page Prospection.
 *
 * Tout atterrit dans `prospection_suivi`, jamais dans `prospection_prospects` :
 * celle-là est la copie du vault, et le script d'import la réécrit à chaque
 * passage. Une coche écrite au mauvais endroit disparaîtrait au prochain
 * `prospects-vers-hub.mjs`, sans bruit.
 *
 * La date par défaut est aujourd'hui à Paris : Louis coche depuis son téléphone
 * juste après avoir filmé, et une date en UTC lui donnerait la veille passé
 * minuit... et le lendemain jamais.
 */

const AUJOURDHUI = () =>
  new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());

const schema = z.object({
  slug: z.string().min(1).max(120),
  quoi: z.enum(["video", "relance-video", "relance-mail", "reponse", "classe", "annuler"]),
  reponse: z.string().max(500).optional(),
});

export async function marquer(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = schema.safeParse({
    slug: formData.get("slug"),
    quoi: formData.get("quoi"),
    reponse: formData.get("reponse") ?? undefined,
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const { slug, quoi, reponse } = parsed.data;
  const jour = AUJOURDHUI();

  const valeurs: Database["public"]["Tables"]["prospection_suivi"]["Insert"] = { slug };
  if (quoi === "video") valeurs.video_filmee_le = jour;
  if (quoi === "relance-video") {
    valeurs.relance_envoyee_le = jour;
    valeurs.relance_type = "video";
  }
  if (quoi === "relance-mail") {
    valeurs.relance_envoyee_le = jour;
    valeurs.relance_type = "mail";
  }
  if (quoi === "reponse") {
    valeurs.reponse_le = jour;
    valeurs.reponse = reponse?.trim() || null;
  }
  if (quoi === "classe") valeurs.classe = true;
  if (quoi === "annuler") {
    valeurs.video_filmee_le = null;
    valeurs.relance_envoyee_le = null;
    valeurs.relance_type = null;
    valeurs.reponse_le = null;
    valeurs.reponse = null;
    valeurs.classe = false;
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("prospection_suivi")
    .upsert(valeurs, { onConflict: "slug" });

  if (error) return fail("La coche n'a pas pu être enregistrée. Réessaie dans un instant.");

  revalidatePath("/admin/prospection");
  return ok();
}
