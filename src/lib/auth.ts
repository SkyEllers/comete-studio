import "server-only";

import type { User } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import type { Database } from "./supabase/database.types";
import { createClient } from "./supabase/server";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Session = { user: User; profile: Profile };

/**
 * Utilisateur courant et son profil, ou `null`. Une seule requête sur
 * `profiles` : tout le reste de l'app part de là.
 *
 * `cache()` dédoublonne l'appel sur la durée d'une requête : un layout et sa
 * page peuvent tous deux appeler une garde sans relancer la lecture.
 */
export const getUser = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // Sans profil, le compte n'est pas exploitable : on le traite comme absent.
  if (!profile) return null;

  return { user, profile };
});

/** Session obligatoire, sinon retour à la page de connexion. */
export async function requireUser(): Promise<Session> {
  const session = await getUser();
  if (!session) redirect("/");
  return session;
}

/**
 * Réservé à Louis. On répond 404 et non 403 : un compte client n'a pas à
 * apprendre que `/admin` existe.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await requireUser();
  if (!session.profile.is_admin) notFound();
  return session;
}
