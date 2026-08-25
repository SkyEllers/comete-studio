"use server";

import { revalidatePath } from "next/cache";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrganizationSchema } from "@/lib/validations/admin";

export async function createOrganization(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireAdmin();

  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });

  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("organizations")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 : violation de contrainte d'unicité sur le slug.
    if (error.code === "23505") {
      return fail(
        `L'identifiant « ${parsed.data.slug} » est déjà pris.`,
        "slug",
      );
    }
    return fail("Impossible de créer ce client pour le moment.");
  }

  revalidatePath("/admin/clients");
  revalidatePath("/admin");
  return ok({ id: data.id });
}
