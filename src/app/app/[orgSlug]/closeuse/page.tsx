import type { Metadata } from "next";

import { requireCloseuse } from "@/lib/access";
import { EspaceCloseuseClient } from "@/tools/closeuse/espace-client";
import { getEspaceCloseuse } from "@/tools/closeuse/queries";
import { aujourdhuiAParis } from "@/tools/resultats/format";
import { moisCourant } from "@/tools/resultats/mois";

export const metadata: Metadata = {
  title: "Mon espace — Comète Studio",
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

  return (
    <EspaceCloseuseClient
      orgSlug={orgSlug}
      espace={espace}
      moisDuJour={moisCourant()}
      aujourdhui={aujourdhui}
      vueDeLouis={role === "admin"}
    />
  );
}
