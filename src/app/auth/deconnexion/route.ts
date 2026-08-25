import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Sortie de secours pour un jeton orphelin.
 *
 * Depuis que la signature est vérifiée localement, un jeton reste valide
 * jusqu'à son expiration même si le compte a disparu entre-temps. Le proxy y
 * voit une session, renvoie vers l'espace, qui ne trouve aucun profil et
 * renvoie vers la connexion : les deux se relancent indéfiniment.
 *
 * Une route peut écrire des cookies, contrairement à un Server Component :
 * c'est ici qu'on efface la session pour de bon.
 */
export async function GET() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
