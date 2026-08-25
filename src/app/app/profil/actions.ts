"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fullNameSchema, passwordSchema } from "@/lib/validations/common";

const nameSchema = z.object({ fullName: fullNameSchema });

export async function updateFullName(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireUser();

  const parsed = nameSchema.safeParse({ fullName: formData.get("fullName") });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", session.userId);

  if (error) return fail("Impossible d'enregistrer ton nom pour le moment.");

  revalidatePath("/", "layout");
  return ok();
}

const passwordFormSchema = z
  .object({
    password: passwordSchema,
    confirmation: z.string(),
  })
  .refine((data) => data.password === data.confirmation, {
    error: "Les deux mots de passe ne sont pas identiques.",
    path: ["confirmation"],
  });

/**
 * Changement de mot de passe depuis une session déjà ouverte : l'ancien mot de
 * passe n'est pas redemandé, la session fait foi (c'est ce que Supabase permet).
 */
export async function changePassword(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();

  const parsed = passwordFormSchema.safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });

  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    if (error.code === "same_password") {
      return fail("Choisis un mot de passe différent de l'ancien.", "password");
    }
    return fail("Impossible de changer ton mot de passe pour le moment.");
  }

  return ok();
}
