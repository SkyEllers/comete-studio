import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";

/**
 * Client Supabase pour le navigateur (composants clients, outils temps réel).
 *
 * `createBrowserClient` est déjà un singleton : appeler `createClient()`
 * plusieurs fois dans la même page renvoie la même instance, donc une seule
 * connexion Realtime et un seul rafraîchissement de session.
 *
 * La clé publique est la seule utilisée ici. La clé secrète ne doit jamais
 * traverser cette frontière (CLAUDE.md §8).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Configuration Supabase incomplète : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont attendues.",
    );
  }

  return createBrowserClient<Database>(url, key);
}
