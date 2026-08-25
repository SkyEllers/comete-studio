import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { nextPathSchema } from "@/lib/validations/common";

/**
 * Point d'atterrissage des liens envoyés par email (invitation, récupération).
 *
 * On échange le `token_hash` contre une vraie session — possible ici parce
 * qu'une route peut écrire des cookies, contrairement à un Server Component —
 * puis on renvoie vers la page qui va bien.
 */
const typeSchema = z.enum([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const tokenHash = searchParams.get("token_hash");
  const type = typeSchema.safeParse(searchParams.get("type"));
  const next = nextPathSchema.safeParse(searchParams.get("next") ?? "/app");

  if (tokenHash && type.success) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type.data,
      token_hash: tokenHash,
    });

    if (!error) {
      redirect(next.success ? next.data : "/app");
    }
  }

  // Lien expiré, déjà consommé, ou trafiqué : la page de connexion le dira.
  redirect("/?erreur=lien-invalide");
}
