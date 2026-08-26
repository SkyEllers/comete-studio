import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { TableSkeleton } from "@/components/app/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { jour, montant } from "@/tools/resultats/format";
import { libelleMois } from "@/tools/resultats/mois";

/**
 * Les relevés du client, du plus récent au plus ancien.
 *
 * Une liste courte et lisible : le mois, ce qu'il doit, où en est le relevé.
 * Le détail ligne à ligne est à un tap.
 */

export const ETATS: Record<string, { libelle: string; ton: "default" | "outline" }> = {
  cloture: { libelle: "À vérifier", ton: "default" },
  conteste: { libelle: "Signalé, en cours", ton: "outline" },
  valide: { libelle: "Validé", ton: "outline" },
  paye: { libelle: "Payé", ton: "outline" },
};

async function Liste({
  organizationId,
  orgSlug,
}: {
  organizationId: string;
  orgSlug: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_statements")
    .select("id, month, status, base_cents, commission_cents, commission_rate, paid_at")
    .eq("organization_id", organizationId)
    .order("month", { ascending: false })
    .limit(36);

  const releves = data ?? [];

  if (releves.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Aucun relevé pour l'instant."
        description="Le premier arrivera au début du mois prochain."
      />
    );
  }

  return (
    <ul className="border-line divide-line divide-y overflow-hidden rounded-lg border">
      {releves.map((releve) => {
        const etat = ETATS[releve.status] ?? { libelle: releve.status, ton: "outline" as const };

        return (
          <li key={releve.id}>
            <Link
              href={`/app/${orgSlug}/resultats/releves/${releve.id}`}
              prefetch
              className="hover:bg-surface-2 flex items-center gap-3 p-4 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{libelleMois(releve.month)}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {Number(releve.commission_rate)} % de{" "}
                  {montant(releve.base_cents)} de séances apportées
                  {releve.paid_at ? ` · payé le ${jour(releve.paid_at)}` : ""}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="font-mono text-sm tabular-nums">
                  {montant(releve.commission_cents)}
                </p>
                <Badge variant={etat.ton} className="mt-1">
                  {etat.libelle}
                </Badge>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function RelevesPage({
  params,
}: PageProps<"/app/[orgSlug]/resultats/releves">) {
  const { orgSlug } = await params;
  const { org } = await requireMembership(orgSlug);

  return (
    <>
      <PageHeader
        title="Tes relevés"
        description="Ce que Comète te facture chaque mois, ligne à ligne."
        action={
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}/resultats`} prefetch>
              <ArrowLeft aria-hidden="true" />
              Tableau de bord
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<TableSkeleton rows={3} />}>
        <Liste organizationId={org.id} orgSlug={orgSlug} />
      </Suspense>
    </>
  );
}
