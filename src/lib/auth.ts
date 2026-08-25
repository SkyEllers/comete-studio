import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import type { Database } from "./supabase/database.types";
import { createClient } from "./supabase/server";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Session = { userId: string; email: string; profile: Profile };

/**
 * Utilisateur courant et son profil, ou `null`.
 *
 * `getClaims()` vérifie la signature du jeton **localement** : le projet signe
 * en ES256 et publie ses clés publiques, donc plus besoin d'un aller-retour
 * vers le serveur d'authentification à chaque requête. Restent une lecture de
 * `profiles`, qui reste la source de vérité pour `is_admin`.
 *
 * Contrepartie : un jeton révoqué (déconnexion depuis un autre appareil,
 * compte supprimé) reste accepté jusqu'à son expiration, une heure par défaut.
 * La base a de toute façon exactement la même fenêtre, PostgREST se fiant lui
 * aussi à la signature et à l'expiration — l'aller-retour supprimé ne
 * protégeait donc que la couche applicative.
 *
 * `cache()` dédoublonne l'appel sur la durée d'une requête : un layout et sa
 * page peuvent tous deux appeler une garde sans relancer la lecture.
 */
export const getUser = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", claims.sub)
    .maybeSingle();

  // Sans profil, le compte n'est pas exploitable : on le traite comme absent.
  if (!profile) return null;

  return {
    userId: claims.sub,
    email: profile.email || (claims.email ?? ""),
    profile,
  };
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
