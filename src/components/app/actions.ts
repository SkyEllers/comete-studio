"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Déconnexion. Partagée par le menu utilisateur et la page profil : le cookie
 * de session est effacé côté serveur, puis on repart de la page de connexion.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
