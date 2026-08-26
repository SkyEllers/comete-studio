"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  membershipRoleSchema,
  renameOrganizationSchema,
  toggleToolSchema,
} from "@/lib/validations/admin";
import { emailSchema, fullNameSchema } from "@/lib/validations/common";

function refresh(organizationId: string) {
  revalidatePath(`/admin/clients/${organizationId}`);
  revalidatePath("/admin/clients");
  revalidatePath("/admin");
  // L'espace client lui-même : la grille d'outils change.
  revalidatePath("/app", "layout");
}

export async function renameOrganization(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = renameOrganizationSchema.safeParse({
    organizationId: formData.get("organizationId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.organizationId);

  if (error) return fail("Impossible de renommer ce client pour le moment.");

  refresh(parsed.data.organizationId);
  return ok();
}

const inviteSchema = z.object({
  organizationId: z.uuid({ error: "Client introuvable." }),
  email: emailSchema,
  fullName: fullNameSchema,
  role: membershipRoleSchema,
});

/**
 * Invitation d'un membre.
 *
 * Deux cas : l'adresse est inconnue, on crée le compte et Supabase envoie
 * l'email d'invitation ; l'adresse a déjà un compte, on ajoute seulement
 * l'appartenance — pas d'email, et le message le dit.
 */
export async function inviteMember(
  _previous: ActionResult<{ status: "invited" | "added" }> | null,
  formData: FormData,
): Promise<ActionResult<{ status: "invited" | "added" }>> {
  await requireAdmin();

  const parsed = inviteSchema.safeParse({
    organizationId: formData.get("organizationId"),
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    role: formData.get("role"),
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", parsed.data.email)
    .maybeSingle();

  let userId = existing?.id ?? null;
  let status: "invited" | "added" = "added";

  if (!userId) {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(
      parsed.data.email,
      { data: { full_name: parsed.data.fullName } },
    );

    if (error || !data.user) {
      return fail(
        "L'email d'invitation n'est pas parti. Vérifie l'adresse, ou réessaie dans quelques minutes.",
        "email",
      );
    }

    userId = data.user.id;
    status = "invited";
  }

  const { error: membershipError } = await supabase.from("memberships").insert({
    organization_id: parsed.data.organizationId,
    user_id: userId,
    role: parsed.data.role,
  });

  if (membershipError) {
    if (membershipError.code === "23505") {
      return fail("Cette personne est déjà membre de ce client.", "email");
    }
    return fail("Impossible d'ajouter cette personne pour le moment.");
  }

  refresh(parsed.data.organizationId);
  return ok({ status });
}

const memberSchema = z.object({
  organizationId: z.uuid({ error: "Client introuvable." }),
  userId: z.uuid({ error: "Membre introuvable." }),
});

export async function removeMember(input: {
  organizationId: string;
  userId: string;
}): Promise<ActionResult> {
  await requireAdmin();

  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  // On retire l'appartenance, jamais le compte : la personne peut être membre
  // ailleurs, et son compte lui appartient.
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("organization_id", parsed.data.organizationId)
    .eq("user_id", parsed.data.userId);

  if (error) return fail("Impossible de retirer cette personne pour le moment.");

  refresh(parsed.data.organizationId);
  return ok();
}

/**
 * Renvoi d'invitation, pour un compte qui ne s'est jamais connecté.
 *
 * Supabase refuse une seconde invitation quand le compte existe déjà : on
 * bascule alors sur un lien de réinitialisation, qui mène au même endroit.
 */
export async function resendInvitation(input: {
  organizationId: string;
  userId: string;
}): Promise<ActionResult<{ via: "invitation" | "reinitialisation" }>> {
  await requireAdmin();

  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (!profile) return fail("Ce compte est introuvable.");

  const { error } = await supabase.auth.admin.inviteUserByEmail(profile.email, {
    data: { full_name: profile.full_name },
  });

  if (!error) return ok({ via: "invitation" as const });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(
    profile.email,
    {
      redirectTo: siteUrl
        ? `${siteUrl}/auth/confirm?next=/reinitialiser`
        : undefined,
    },
  );

  if (resetError) {
    return fail("L'email n'est pas parti. Réessaie dans quelques minutes.");
  }

  return ok({ via: "reinitialisation" as const });
}

export async function toggleTool(input: {
  organizationId: string;
  toolId: string;
  enabled: boolean;
}): Promise<ActionResult> {
  await requireAdmin();

  const parsed = toggleToolSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  const { error } = await supabase.from("organization_tools").upsert(
    {
      organization_id: parsed.data.organizationId,
      tool_id: parsed.data.toolId,
      enabled: parsed.data.enabled,
      enabled_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,tool_id" },
  );

  if (error) return fail("Impossible de changer cet outil pour le moment.");

  refresh(parsed.data.organizationId);
  return ok();
}

/**
 * Vider le préfixe Storage d'un client.
 *
 * La base cascade, le Storage non : sans ce ménage, les objets d'un client
 * supprimé resteraient dans le bucket pour toujours — invisibles, puisque leur
 * organisation n'existe plus et que la RLS s'appuie sur elle, mais bien
 * présents et bien facturés.
 *
 * On pagine : un client peut avoir plus de fichiers qu'une page de liste.
 */
const BUCKET = "fichiers";
const PAGE = 1000;

async function viderStockage(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<boolean> {
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(organizationId, { limit: PAGE });

    if (error) return false;

    // `id` nul = un préfixe, pas un objet. Notre rangement est plat, mais
    // mieux vaut ne pas tenter d'effacer ce qui n'est pas un fichier.
    const chemins = (data ?? [])
      .filter((objet) => objet.id !== null)
      .map((objet) => `${organizationId}/${objet.name}`);

    if (chemins.length === 0) return true;

    const { error: erreurSuppression } = await supabase.storage
      .from(BUCKET)
      .remove(chemins);

    if (erreurSuppression) return false;
    if ((data ?? []).length < PAGE) return true;
  }
}

const deleteSchema = z.object({
  organizationId: z.uuid({ error: "Client introuvable." }),
  confirmation: z.string(),
});

export async function deleteOrganization(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = deleteSchema.safeParse({
    organizationId: formData.get("organizationId"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", parsed.data.organizationId)
    .maybeSingle();

  if (!org) return fail("Ce client n'existe plus.");

  if (parsed.data.confirmation.trim() !== org.slug) {
    return fail(
      `Saisis « ${org.slug} » exactement pour confirmer.`,
      "confirmation",
    );
  }

  /*
   * Le Storage d'abord : si le ménage échoue, le client existe encore et on
   * peut recommencer. Dans l'autre sens, la ligne serait partie et plus rien
   * ne relierait les objets restants à qui que ce soit.
   */
  if (!(await viderStockage(supabase, parsed.data.organizationId))) {
    return fail(
      "Impossible de supprimer les fichiers de ce client. Rien n'a été supprimé.",
    );
  }

  // Les appartenances et les outils activés partent en cascade (migration 0001).
  const { error } = await supabase
    .from("organizations")
    .delete()
    .eq("id", parsed.data.organizationId);

  if (error) return fail("Impossible de supprimer ce client pour le moment.");

  revalidatePath("/admin/clients");
  revalidatePath("/admin");
  revalidatePath("/app", "layout");

  // Redirection côté serveur, et pas depuis le composant : toute action
  // re-rend la page courante, qui n'existe plus — on verrait un 404 le temps
  // qu'une navigation côté client arrive.
  redirect(`/admin/clients?supprime=${encodeURIComponent(org.slug)}`);
}
