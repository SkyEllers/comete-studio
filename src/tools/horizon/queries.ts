import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import { lireContenu, type ContenuReleve } from "./contenu.ts";

export type Releve = {
  id: string;
  mois: string;
  publie: boolean;
  contenu: ContenuReleve;
  updatedAt: string;
};

/**
 * Les relevés d'une organisation, du plus récent au plus ancien.
 *
 * Lus à travers la RLS de qui regarde : un client ne reçoit que les relevés
 * publiés, Louis reçoit aussi ses brouillons. Un contenu qui ne passe plus le
 * schéma est écarté plutôt que de casser la page — il reste en base, et
 * l'administration le signale.
 */
export const getReleves = cache(async (organizationId: string): Promise<Releve[]> => {
  const supabase = await createClient();

  const { data } = await supabase
    .from("horizon_releves")
    .select("id, mois, publie, contenu, updated_at")
    .eq("organization_id", organizationId)
    .order("mois", { ascending: false });

  return (data ?? []).flatMap((ligne) => {
    const contenu = lireContenu(ligne.contenu);
    return contenu
      ? [{ id: ligne.id, mois: ligne.mois, publie: ligne.publie, contenu, updatedAt: ligne.updated_at }]
      : [];
  });
});
