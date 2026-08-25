"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, failFromZod, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, nextPathSchema } from "@/lib/validations/common";

const signInSchema = z.object({
  email: emailSchema,
  // Pas de contrainte de longueur ici : ce serait dire au visiteur ce qu'on
  // attend, et ça donnerait deux erreurs différentes selon le mot de passe.
  password: z.string({ error: "Saisis ton mot de passe." }).min(1, {
    error: "Saisis ton mot de passe.",
  }),
  next: z.string().optional(),
});

export async function signIn(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // Message unique et volontairement vague : on ne révèle jamais si une adresse
  // correspond à un compte.
  if (error) return fail("Email ou mot de passe incorrect.");

  const next = nextPathSchema.safeParse(parsed.data.next ?? "");
  redirect(next.success ? next.data : "/app");
}
