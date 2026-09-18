"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { NOMBRE_MAX, NOMBRE_MIN, aEnvoyer, type MessagePret } from "@/tools/prospection/demandes";

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

/**
 * Le bouton « Trouver des prospects » : déposer une demande pour le PC.
 *
 * Rien ne se cherche ici (migration 0029) : la demande attend que la tâche
 * planifiée du PC de Louis la prenne, dans les 5 minutes s'il est allumé.
 * Une seule demande vivante à la fois : l'index unique de la base refuse la
 * seconde, et le message le dit plutôt que de laisser croire à une panne.
 */

const schemaDemande = z.object({
  nombre: z.coerce
    .number({ message: "Indique un nombre." })
    .int("Un nombre entier, sans virgule.")
    .min(NOMBRE_MIN, `Au moins ${NOMBRE_MIN}.`)
    .max(NOMBRE_MAX, `Au plus ${NOMBRE_MAX} par demande.`),
});

export async function demanderRecherche(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = schemaDemande.safeParse({ nombre: formData.get("nombre") });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("prospection_demandes")
    .insert({ nombre: parsed.data.nombre });

  if (error?.code === "23505") {
    return fail("Une recherche est déjà en attente ou en cours. Attends qu'elle finisse, ou annule-la.");
  }
  if (error) return fail("La demande n'a pas pu être enregistrée. Réessaie dans un instant.");

  revalidatePath("/admin/prospection");
  return ok();
}

const schemaAnnulation = z.object({ id: z.string().uuid() });

/** Annuler une demande que le PC n'a pas encore prise. Une recherche en cours ne s'annule pas d'ici. */
export async function annulerDemande(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = schemaAnnulation.safeParse({ id: formData.get("id") });
  if (!parsed.success) return fail("Demande introuvable.");

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("prospection_demandes")
    .update({ statut: "annulee", finie_le: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("statut", "en_attente")
    .select("id");

  if (error) return fail("L'annulation n'a pas pu être enregistrée. Réessaie dans un instant.");
  if (!data?.length) return fail("Trop tard : ton PC a déjà commencé cette recherche.");

  revalidatePath("/admin/prospection");
  return ok();
}

/**
 * « Envoyer » : le clic de Louis qui autorise le PC à envoyer les messages prêts.
 *
 * C'est la seule porte vers l'envoi (migration 0029, point 4) : le PC ne part
 * que sur une demande dont `envoi_valide_le` est posé. Le nombre attendu voyage
 * avec le clic : si un message a été retiré dans un autre onglet entre-temps,
 * la validation est refusée plutôt que d'envoyer autre chose que ce que Louis
 * a vu.
 */
const schemaValidation = z.object({
  id: z.string().uuid(),
  attendus: z.coerce.number().int().min(1),
});

export async function validerEnvoi(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = schemaValidation.safeParse({ id: formData.get("id"), attendus: formData.get("attendus") });
  if (!parsed.success) return fail("Demande introuvable.");

  const supabase = createAdminClient();
  const { data: demande, error: lecture } = await supabase
    .from("prospection_demandes")
    .select("statut, messages, envoi_exclus, envoi_valide_le")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (lecture || !demande) return fail("Demande introuvable.");
  if (demande.envoi_valide_le) return fail("Cet envoi est déjà validé.");
  if (demande.statut !== "faite") return fail("La recherche n'est pas finie.");

  const partants = aEnvoyer({
    messages: (demande.messages as MessagePret[]) ?? [],
    envoi_exclus: demande.envoi_exclus ?? [],
  });
  if (partants.length !== parsed.data.attendus) {
    return fail("La liste a changé depuis que tu l'as ouverte : recharge la page et relis-la.");
  }

  const { error } = await supabase
    .from("prospection_demandes")
    .update({ envoi_valide_le: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .is("envoi_valide_le", null);
  if (error) return fail("La validation n'a pas pu être enregistrée. Réessaie dans un instant.");

  revalidatePath("/admin/prospection");
  return ok();
}

/** Retirer un message de l'envoi, ou le remettre, tant que l'envoi n'est pas validé. */
const schemaRetrait = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(120),
  retirer: z.enum(["oui", "non"]),
});

export async function retirerMessage(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = schemaRetrait.safeParse({
    id: formData.get("id"),
    slug: formData.get("slug"),
    retirer: formData.get("retirer"),
  });
  if (!parsed.success) return fail("Message introuvable.");

  const supabase = createAdminClient();
  const { data: demande } = await supabase
    .from("prospection_demandes")
    .select("envoi_exclus, envoi_valide_le")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!demande) return fail("Demande introuvable.");
  if (demande.envoi_valide_le) return fail("L'envoi est déjà validé : ce message part avec les autres.");

  const exclus = new Set(demande.envoi_exclus ?? []);
  if (parsed.data.retirer === "oui") exclus.add(parsed.data.slug);
  else exclus.delete(parsed.data.slug);

  const { error } = await supabase
    .from("prospection_demandes")
    .update({ envoi_exclus: [...exclus] })
    .eq("id", parsed.data.id)
    .is("envoi_valide_le", null);
  if (error) return fail("Le changement n'a pas pu être enregistré. Réessaie dans un instant.");

  revalidatePath("/admin/prospection");
  return ok();
}
