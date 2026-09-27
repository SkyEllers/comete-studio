"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * L'administration de la réservation d'un client, réservée à Louis (0042).
 * Client admin, organisation dans chaque filtre : un identifiant recopié
 * d'un autre onglet ne touche jamais un autre client.
 */

const organisation = z.uuid({ error: "Client introuvable." });

function rafraichir(organizationId: string) {
  revalidatePath(`/admin/clients/${organizationId}/reservation`);
}

/** Poser les réglages du client, réservation fermée : rien n'est proposé au public. */
export async function preparerReservation(organizationId: unknown): Promise<ActionResult> {
  await requireAdmin();
  const org = organisation.safeParse(organizationId);
  if (!org.success) return failFromZod(org.error);

  const admin = createAdminClient();
  const { error } = await admin
    .from("reservation_reglages")
    .upsert({ organization_id: org.data, actif: false }, { onConflict: "organization_id", ignoreDuplicates: true });
  if (error) return fail(`Réglages : ${error.message}`);

  rafraichir(org.data);
  return ok();
}

const ajoutSchema = z.object({ organizationId: organisation, userId: z.uuid({ error: "Choisis une personne." }) });

/**
 * Ajouter quelqu'un qui prendra des diagnostics : une closeuse du client
 * devient closeuse, une membre devient la titulaire (une seule par client).
 */
export async function ajouterPersonne(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = ajoutSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, userId } = parsed.data;

  const admin = createAdminClient();
  const { data: membre } = await admin
    .from("memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membre) return fail("Cette personne n'est pas dans l'espace de ce client.");

  const role = membre.role === "closeuse" ? "closeuse" : "titulaire";
  const { error } = await admin.from("reservation_personnes").insert({ organization_id: organizationId, user_id: userId, role });
  if (error) {
    return fail(
      error.code === "23505"
        ? role === "titulaire"
          ? "Ce client a déjà sa titulaire, ou cette personne est déjà ajoutée."
          : "Cette personne est déjà ajoutée."
        : `Ajout : ${error.message}`,
    );
  }

  rafraichir(organizationId);
  return ok();
}

const actifSchema = z.object({ organizationId: organisation, personneId: z.uuid(), actif: z.boolean() });

/** Sortir quelqu'un du roulement (ou l'y remettre). Ses rendez-vous restent. */
export async function basculerPersonne(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = actifSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, personneId, actif } = parsed.data;

  const admin = createAdminClient();
  const { error } = await admin
    .from("reservation_personnes")
    .update({ actif })
    .eq("id", personneId)
    .eq("organization_id", organizationId);
  if (error) return fail(`Mise à jour : ${error.message}`);

  rafraichir(organizationId);
  return ok();
}
