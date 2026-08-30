import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { Boite } from "./types";

/**
 * Ce que Sas lit. Pour l'instant : les boîtes, rien de plus.
 *
 * La lecture passe par la session, jamais par la clé secrète : c'est la RLS
 * qui décide, et `can_access_sas` rend la liste vide dès que l'outil est coupé.
 */

/** Plafond de sécurité : personne n'a mille boîtes, mais la requête est bornée. */
const PLAFOND = 200;

export async function getBoites(organizationId: string): Promise<Boite[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("sas_boxes")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name")
    .limit(PLAFOND);

  return data ?? [];
}
