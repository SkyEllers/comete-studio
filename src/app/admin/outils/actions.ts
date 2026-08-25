"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createExternalToolSchema,
  updateToolSchema,
} from "@/lib/validations/admin";

function refresh() {
  revalidatePath("/admin/outils");
  revalidatePath("/admin/clients", "layout");
  revalidatePath("/admin");
  revalidatePath("/app", "layout");
}

export async function updateTool(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = updateToolSchema.safeParse({
    toolId: formData.get("toolId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    sortOrder: formData.get("sortOrder"),
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("tools")
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      sort_order: parsed.data.sortOrder,
    })
    .eq("id", parsed.data.toolId);

  if (error) return fail("Impossible de modifier cet outil pour le moment.");

  refresh();
  return ok();
}

const setActiveSchema = z.object({
  toolId: z.uuid({ error: "Outil introuvable." }),
  isActive: z.boolean(),
});

/**
 * Retirer un outil du catalogue le retire de tous les espaces clients d'un
 * coup : `is_active` est vérifié à l'affichage comme dans `has_tool()`.
 */
export async function setToolActive(input: {
  toolId: string;
  isActive: boolean;
}): Promise<ActionResult> {
  await requireAdmin();

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("tools")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.toolId);

  if (error) return fail("Impossible de changer cet outil pour le moment.");

  refresh();
  return ok();
}

export async function createExternalTool(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = createExternalToolSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    href: formData.get("href"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  const { error } = await supabase.from("tools").insert({
    name: parsed.data.name,
    slug: parsed.data.slug,
    href: parsed.data.href,
    description: parsed.data.description,
    kind: "external",
  });

  if (error) {
    if (error.code === "23505") {
      return fail(`L'identifiant « ${parsed.data.slug} » est déjà pris.`, "slug");
    }
    return fail("Impossible de créer cet outil pour le moment.");
  }

  refresh();
  return ok();
}
