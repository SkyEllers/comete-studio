"use server";

import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { passwordSchema } from "@/lib/validations/common";

const schema = z
  .object({
    password: passwordSchema,
    confirmation: z.string(),
  })
  .refine((data) => data.password === data.confirmation, {
    error: "Les deux mots de passe ne sont pas identiques.",
    path: ["confirmation"],
  });

export async function updatePassword(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = schema.safeParse({
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
      return fail(
        "Choisis un mot de passe différent de l'ancien.",
        "password",
      );
    }
    return fail(
      "Impossible de mettre à jour le mot de passe. Le lien a peut-être expiré : demande-en un nouveau.",
    );
  }

  return ok();
}
