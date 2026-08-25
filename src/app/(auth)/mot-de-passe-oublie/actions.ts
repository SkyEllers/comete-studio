"use server";

import { z } from "zod";

import { failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validations/common";

const schema = z.object({ email: emailSchema });

export async function requestPasswordReset(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: siteUrl
      ? `${siteUrl}/auth/confirm?next=/reinitialiser`
      : undefined,
  });

  // Même réponse dans tous les cas, y compris si l'adresse est inconnue :
  // sinon la page devient un moyen de savoir qui a un compte.
  return ok();
}
