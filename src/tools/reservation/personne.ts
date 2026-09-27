import "server-only";

import { getOrgBySlug } from "@/lib/access";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * La fiche de réservation de la personne connectée chez ce client, lue avec
 * sa propre session (la RLS ne lui montre que la sienne). Louis n'en a pas
 * chez Peggy : il ne connecte jamais l'agenda de quelqu'un d'autre.
 */
export async function maFiche(orgSlug: string) {
  const session = await getUser();
  if (!session) return null;

  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("reservation_personnes")
    .select("id, role, actif, google_email, google_connecte_le")
    .eq("organization_id", org.id)
    .eq("user_id", session.userId)
    .maybeSingle();

  return data ? { session, org, fiche: data } : null;
}
