"use server";

import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fullNameSchema, passwordSchema } from "@/lib/validations/common";

const schema = z
  .object({
    fullName: fullNameSchema,
    password: passwordSchema,
    confirmation: z.string(),
  })
  .refine((data) => data.password === data.confirmation, {
    error: "Les deux mots de passe ne sont pas identiques.",
    path: ["confirmation"],
  });

/**
 * Fin du parcours d'invitation : le compte existe déjà (créé par Louis), il
 * reçoit ici son mot de passe et son nom définitif.
 */
export async function acceptInvitation(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = schema.safeParse({
    fullName: formData.get("fullName"),
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });

  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail(
      "Ton lien d'invitation a expiré. Demande à Louis de t'en renvoyer un.",
    );
  }

  const { error: passwordError } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (passwordError) {
    return fail(
      "Impossible d'enregistrer ce mot de passe. Le lien a peut-être expiré : demande-en un nouveau.",
    );
  }

  // La RLS n'autorise que full_name et avatar_url : is_admin reste hors portée.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", user.id);

  if (profileError) {
    return fail("Ton mot de passe est enregistré, mais pas ton nom. Tu pourras le corriger depuis ton profil.");
  }

  return ok();
}
