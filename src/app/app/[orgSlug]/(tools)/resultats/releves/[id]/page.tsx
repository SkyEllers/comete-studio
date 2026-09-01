import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ETATS } from "@/app/app/[orgSlug]/(tools)/resultats/releves/page";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { dateHeure, jour, montant, statutLisible } from "@/tools/resultats/format";
import { libelleMois } from "@/tools/resultats/mois";
import { ExportCsv, ReponseReleve } from "@/tools/resultats/releve-client";
import type { LigneReleve } from "@/tools/resultats/releve";

/**
 * Un relevé, ligne à ligne.
 *
 * Toutes les séances du mois y figurent, comptées ou non, chacune avec sa
 * raison. C'est ce qui fait la différence entre une facture qu'on vérifie et
 * une facture qu'on subit.
 */

export default async function ReleveePage({
  params,
}: PageProps<"/app/[orgSlug]/resultats/releves/[id]">) {
  const { orgSlug, id } = await params;
  const { org } = await requireMembership(orgSlug);

  const supabase = await createClient();
  const { data: releve } = await supabase
    .from("radar_statements")
    .select(
      "id, month, status, base_cents, commission_cents, commission_rate, commission_basis, lines, closed_at, reviewed_at, review_comment, paid_at",
    )
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();

  if (!releve) notFound();

  const lignes = (releve.lines ?? []) as unknown as LigneReleve[];
  const etat = ETATS[releve.status] ?? { libelle: releve.status, ton: "outline" as const };
  const devise = lignes[0]?.devise ?? "EUR";

  return (
    <>
      <PageHeader
        title={`Relevé de ${libelleMois(releve.month)}`}
        description={`Clôturé le ${jour(releve.closed_at)} · ${lignes.length} séance${lignes.length > 1 ? "s" : ""} au total.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}/resultats/releves`} prefetch>
                <ArrowLeft aria-hidden="true" />
                Tes relevés
              </Link>
            </Button>
            <ExportCsv
              lignes={lignes}
              nom={`releve-${releve.month.slice(0, 7)}`}
              base={releve.commission_basis}
            />
          </div>
        }
      />

      <section className="border-line bg-surface-1 mb-8 rounded-lg border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm">Ce que Comète te facture</h2>
          <Badge variant={etat.ton}>{etat.libelle}</Badge>
        </div>

        <p className="font-display mt-3 text-3xl font-semibold tabular-nums">
          {montant(releve.commission_cents, devise)}
        </p>
        {/* La phrase suit la règle sous laquelle ce relevé a été clôturé, et
            non celle d'aujourd'hui : le mode d'un client peut changer, un
            relevé signé ne se relit pas autrement pour autant. */}
        <p className="text-muted-foreground mt-2 text-sm">
          {Number(releve.commission_rate)} % de {montant(releve.base_cents, devise)}{" "}
          {releve.commission_basis === "ventes"
            ? "de ventes que tu as déclarées, sur des rendez-vous venus des canaux Comète."
            : "de séances honorées, payées, et venues des canaux Comète."}
          {releve.paid_at ? ` Payé le ${jour(releve.paid_at)}.` : ""}
        </p>

        {releve.review_comment ? (
          <div className="border-line mt-4 rounded-lg border border-dashed p-3">
            <p className="text-muted-foreground text-xs">
              Ce que tu avais signalé
              {releve.reviewed_at ? ` le ${jour(releve.reviewed_at)}` : ""} :
            </p>
            <p className="mt-1 text-sm">{releve.review_comment}</p>
          </div>
        ) : null}

        <div className="mt-4">
          <ReponseReleve
            orgSlug={orgSlug}
            statementId={releve.id}
            repondable={releve.status === "cloture"}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm">Le détail</h2>

        <ul className="border-line divide-line divide-y overflow-hidden rounded-lg border">
          {lignes.map((ligne) => (
            <li key={ligne.id} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{ligne.seance}</p>
                <p className="text-muted-foreground mt-1 font-mono text-xs">
                  {dateHeure(ligne.date)} · {ligne.canal}
                </p>
                {/* Une vente porte deux dates : celle de la séance, et celle
                    du jour où elle a été conclue. Sans la seconde, le client
                    chercherait dans l'agenda de ce mois-ci une séance qui n'y
                    est pas. */}
                {ligne.date_vente ? (
                  <p className="text-success mt-1 font-mono text-xs">
                    vente du {jour(ligne.date_vente)}
                  </p>
                ) : null}
                {ligne.raison ? (
                  <p className="text-muted-foreground mt-1 text-xs">{ligne.raison}</p>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    !ligne.comptee && "text-muted-foreground line-through",
                  )}
                >
                  {montant(ligne.montant_cents, ligne.devise)}
                </p>
                <p
                  className={cn(
                    "mt-1 text-xs",
                    ligne.comptee ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {ligne.comptee ? "comptée" : statutLisible(ligne.statut)}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground text-xs">
          Les séances barrées n&apos;entrent pas dans le calcul. La raison est
          indiquée sous chacune.
        </p>
      </section>
    </>
  );
}
