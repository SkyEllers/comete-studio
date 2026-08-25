import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import type { Database } from "./supabase/database.types";
import { createClient } from "./supabase/server";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Session = { userId: string; email: string; profile: Profile };

/**
 * Deux façons de n'avoir personne : aucun jeton, ou un jeton qui se vérifie
 * mais dont le compte n'existe plus. Le second cas demande un traitement à
 * part, sans quoi le proxy et les pages se renvoient la balle sans fin.
 */
type Lecture =
  | { session: Session; jetonOrphelin: false }
  | { session: null; jetonOrphelin: boolean };

/**
 * Utilisateur courant et son profil.
 *
 * `getClaims()` vérifie la signature du jeton **localement** : le projet signe
 * en ES256 et publie ses clés publiques, donc plus besoin d'un aller-retour
 * vers le serveur d'authentification à chaque requête. Reste une lecture de
 * `profiles`, qui demeure la source de vérité pour `is_admin`.
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
const lireSession = cache(async (): Promise<Lecture> => {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) return { session: null, jetonOrphelin: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", claims.sub)
    .maybeSingle();

  // Jeton valide mais compte disparu : il faut effacer la session, pas la subir.
  if (!profile) return { session: null, jetonOrphelin: true };

  return {
    session: {
      userId: claims.sub,
      email: profile.email || (claims.email ?? ""),
      profile,
    },
    jetonOrphelin: false,
  };
});

export async function getUser(): Promise<Session | null> {
  return (await lireSession()).session;
}

/** Session obligatoire, sinon retour à la page de connexion. */
export async function requireUser(): Promise<Session> {
  const lecture = await lireSession();
  if (lecture.session) return lecture.session;

  // Un jeton orphelin doit être effacé, sinon le proxy nous renverra ici en
  // boucle : seule une route peut écrire les cookies.
  redirect(lecture.jetonOrphelin ? "/auth/deconnexion" : "/");
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
