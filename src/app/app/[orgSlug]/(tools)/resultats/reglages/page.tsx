import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/app/page-header";
import { TableSkeleton } from "@/components/app/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { dateHeure, depuis } from "@/tools/resultats/format";
import { getCanaux, getReglages } from "@/tools/resultats/queries";

/**
 * Les réglages, en lecture seule.
 *
 * Le client ne les change pas — ils viennent du contrat — mais il doit pouvoir
 * les lire sans demander. Une commission qu'on ne peut pas vérifier soi-même
 * est une commission qu'on finit par contester.
 */

async function Reglages({ organizationId }: { organizationId: string }) {
  const [reglages, canaux] = await Promise.all([
    getReglages(organizationId),
    getCanaux(organizationId),
  ]);

  const comete = canaux.filter((canal) => canal.is_comete);
  const autres = canaux.filter((canal) => !canal.is_comete);

  return (
    <div className="space-y-8">
      <section className="border-line bg-surface-1 space-y-4 rounded-lg border p-5">
        <h2 className="text-sm">Comment la commission se calcule</h2>

        {/* Les deux règles, dites en français simple (décision 6 de la phase
            7). Le client n'a pas à savoir qu'il existe un « mode » : il lit
            celle qui le concerne, et rien d'autre. */}
        {reglages.commission_basis === "ventes" ? (
          <>
            <p className="text-muted-foreground text-sm">
              Comète est payé sur les <strong className="text-foreground font-medium">ventes
              que tu déclares</strong>, jamais sur les rendez-vous eux-mêmes : tes
              diagnostics sont offerts, et c&apos;est l&apos;accompagnement vendu
              derrière qui compte. Une vente entre dans le calcul si le rendez-vous
              qui l&apos;a amenée vient d&apos;un canal Comète et qu&apos;il a bien
              eu lieu.
            </p>
            <p className="text-muted-foreground text-sm">
              Une vente appartient au mois où tu l&apos;as conclue, pas à celui du
              rendez-vous. Un diagnostic du 28 août vendu le 3 septembre est donc
              facturé en septembre — et son relevé le dit, avec les deux dates.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Comète est payé sur les séances qu&apos;il t&apos;apporte, jamais sur les
            autres. Une séance entre dans le calcul si elle remplit les quatre
            conditions à la fois : elle a eu lieu, elle a été payée, elle vient
            d&apos;un canal Comète, et c&apos;est le mois de la séance qui compte —
            pas celui de la réservation.
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          Quelqu&apos;un qui revient dans les {reglages.window_days} jours suivant
          sa séance précédente reste rattaché au canal qui l&apos;avait amené :
          c&apos;est la même personne, revenue sans qu&apos;il ait fallu la
          rechercher.
        </p>
        <p className="text-muted-foreground text-sm">
          Chaque mois, tu reçois un relevé ligne à ligne. Tu le valides, ou tu le
          contestes en disant ce qui te semble faux.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="border-line bg-surface-1 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">Taux</p>
          <p className="font-display mt-2 text-2xl font-semibold tabular-nums">
            {reglages.commission_rate} %
          </p>
        </div>
        <div className="border-line bg-surface-1 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">Fenêtre de récurrence</p>
          <p className="font-display mt-2 text-2xl font-semibold tabular-nums">
            {reglages.window_days} jours
          </p>
        </div>
        <div className="border-line bg-surface-1 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">Devise</p>
          <p className="font-display mt-2 text-2xl font-semibold">{reglages.currency}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm">Tes canaux</h2>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">Apportés par Comète :</span>
            {comete.length > 0 ? (
              comete.map((canal) => (
                <Badge key={canal.id}>{canal.label}</Badge>
              ))
            ) : (
              <span className="text-muted-foreground text-xs">aucun pour l&apos;instant</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">Hors commission :</span>
            {autres.map((canal) => (
              <Badge key={canal.id} variant="outline">
                {canal.label}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm">Connexion à ton agenda</h2>
        <div className="border-line bg-surface-1 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={reglages.connected_at ? "default" : "outline"}>
              {reglages.connected_at ? "Calendly relié" : "Pas encore relié"}
            </Badge>
            {reglages.connected_at ? (
              <p className="text-muted-foreground font-mono text-xs">
                depuis le {dateHeure(reglages.connected_at)} · dernier rendez-vous
                reçu {depuis(reglages.last_webhook_at)}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Louis s&apos;en occupe : rien à faire de ton côté.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default async function ReglagesRadarPage({
  params,
}: PageProps<"/app/[orgSlug]/resultats/reglages">) {
  const { orgSlug } = await params;
  const { org } = await requireMembership(orgSlug);

  return (
    <>
      <PageHeader
        title="Réglages"
        description="Ce qui a été convenu, et comment Radar s'en sert."
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
        <Reglages organizationId={org.id} />
      </Suspense>
    </>
  );
}
