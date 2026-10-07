import type { Metadata } from "next";

import { requireCloseuse } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { EspaceCloseuseClient } from "@/tools/closeuse/espace-client";
import { getEspaceCloseuse } from "@/tools/closeuse/queries";
import { aujourdhuiAParis } from "@/tools/resultats/format";
import { moisCourant } from "@/tools/resultats/mois";

export const metadata: Metadata = {
  title: "Mon espace · Comète Studio",
};

/**
 * L'espace d'une closeuse chez un client. Elle y entre seule ; Louis y entre
 * aussi, pour voir ce qu'elle voit (`?c=<id>` s'il y en a plusieurs).
 */
export default async function CloseusePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const [{ orgSlug }, { c }] = await Promise.all([params, searchParams]);
  const { org, role, closeuseId } = await requireCloseuse(orgSlug, c);

  const aujourdhui = aujourdhuiAParis();
  const espace = await getEspaceCloseuse(org.id, closeuseId, aujourdhui);

  // Pour Louis : passer d'une closeuse à l'autre chez ce client (07/10/2026),
  // dans l'ordre de l'onglet Closeuses, en boucle.
  let voisines = null;
  if (role === "admin") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("radar_closeuses")
      .select("user_id")
      .eq("organization_id", org.id)
      .order("created_at");
    const ids = (data ?? []).map((l) => l.user_id);
    const i = ids.indexOf(closeuseId);
    if (ids.length > 1 && i >= 0) {
      voisines = {
        precedente: ids[(i - 1 + ids.length) % ids.length],
        suivante: ids[(i + 1) % ids.length],
        rang: i + 1,
        total: ids.length,
      };
    }
  }

  return (
    <EspaceCloseuseClient
      orgSlug={orgSlug}
      organizationId={org.id}
      espace={espace}
      moisDuJour={moisCourant()}
      aujourdhui={aujourdhui}
      vueDeLouis={role === "admin"}
      voisines={voisines}
    />
  );
}
