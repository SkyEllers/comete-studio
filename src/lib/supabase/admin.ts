import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Client Supabase avec la clé secrète : il contourne la RLS.
 *
 * Réservé aux Server Actions d'administration, et toujours APRÈS un
 * `requireAdmin()`. Ce fichier commence par `import "server-only"` : toute
 * tentative de l'importer dans un composant client casse le build (CLAUDE.md §8).
 *
 * Rappel : `has_tool()` renvoie `false` avec cette clé (auth.uid() est nul).
 * Les Server Actions d'administration lisent `organization_tools` directement.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Configuration Supabase incomplète : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont attendues côté serveur.",
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
