import {
  ArrowLeft,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  Coins,
  FileText,
  Radar,
  SlidersHorizontal,
  UserX,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { CountersSkeleton } from "@/components/app/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { montant } from "@/tools/resultats/format";
import { libelleMois, moisDemande, moisPrecedent } from "@/tools/resultats/mois";
import {
  aVendre,
  aVerifier,
  bilan,
  getBilanPrecedent,
  getCanaux,
  getMoisConnus,
  getReglages,
  getReleve,
  getRendezVous,
  getVentesDuMois,
  getVentesRefusees,
  parCanal,
} from "@/tools/resultats/queries";
import { AVerifier } from "@/tools/resultats/rendez-vous-client";
import {
  comparer,
  comparerMontant,
  RepartitionCanaux,
  SelecteurMois,
  Tuile,
} from "@/tools/resultats/tuiles";
import { moisAOffrir } from "@/tools/resultats/mois";

/**
 * Le tableau de bord de Radar.
 *
 * Ce que le client vient y chercher, dans l'ordre : combien de séances ce
 * mois-ci, combien ont eu lieu, ce que Comète lui a apporté, et ce que ça lui
 * coûtera. Le reste — la répartition, les séances à vérifier — vient après.
 */

const ETATS_RELEVE: Record<string, string> = {
  cloture: "Relevé clôturé, en attente de ta réponse",
  conteste: "Relevé contesté, Louis le corrige",
  valide: "Relevé validé",
  paye: "Relevé payé",
};

async function TableauDeBord({
  organizationId,
  orgSlug,
  mois,
}: {
  organizationId: string;
  orgSlug: string;
  mois: string;
}) {
  const [reglages, canaux, lignes, moisConnus] = await Promise.all([
    getReglages(organizationId),
    getCanaux(organizationId),
    getRendezVous(organizationId, mois),
    getMoisConnus(organizationId),
  ]);

  const surLesVentes = reglages.commission_basis === "ventes";

  /*
   * En mode « ventes », l'argent du mois ne se lit pas sur les séances du mois :
   * une vente appartient au mois où elle a été conclue. D'où cette seconde
   * requête, qui ne sert qu'à ce mode — les compteurs de séances, eux,
   * continuent de parler de l'agenda.
   */
  const [ventesDuMois, refusees, precedentBilan, releve] = await Promise.all([
    surLesVentes ? getVentesDuMois(organizationId, mois) : Promise.resolve(undefined),
    surLesVentes
      ? getVentesRefusees(lignes.map((ligne) => ligne.id))
      : Promise.resolve(new Set<string>()),
    getBilanPrecedent(
      organizationId,
      mois,
      reglages.commission_rate,
      reglages.currency,
      reglages.commission_basis,
    ),
    getReleve(organizationId, mois),
  ]);

  const courant = bilan(lignes, reglages.commission_rate, reglages.currency, ventesDuMois);

  const avant = moisPrecedent(mois);
  const parts = parCanal(lignes, canaux);

  /*
   * Les deux questions du bloc « À vérifier », réunies en une liste.
   *
   * « Cette séance a-t-elle eu lieu ? » vaut dans les deux modes. « A-t-elle
   * vendu ? » ne vaut qu'en mode `ventes`, et sur une fenêtre plus large. Une
   * même séance peut relever des deux : elle apparaît une fois, avec les deux
   * boutons, plutôt que deux fois dans deux listes.
   */
  const aRegarder = surLesVentes
    ? [
        ...new Map(
          [...aVerifier(lignes), ...aVendre(lignes, refusees)].map((rdv) => [rdv.id, rdv]),
        ).values(),
      ].sort((a, b) => Date.parse(b.scheduled_start) - Date.parse(a.scheduled_start))
    : aVerifier(lignes);

  return (
    <>
      <SelecteurMois
        mois={mois}
        choix={moisAOffrir(moisConnus)}
        href={(valeur) => `/app/${orgSlug}/resultats?mois=${valeur}`}
      />

      {lignes.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={`Aucun rendez-vous en ${libelleMois(mois)}.`}
          description={
            reglages.connected_at
              ? "Ils arrivent tout seuls dès qu'une réservation est prise."
              : "Ton Calendly n'est pas encore relié : Louis s'en occupe."
          }
        />
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tuile
              icon={CalendarClock}
              label="Rendez-vous"
              valeur={String(courant.rendezVous)}
              comparaison={comparer(courant.rendezVous, precedentBilan.rendezVous, avant)}
            />
            <Tuile
              icon={CalendarCheck2}
              label="Honorés"
              valeur={String(courant.honores)}
              comparaison={comparer(courant.honores, precedentBilan.honores, avant)}
            />
            {/* Deux échecs, deux tuiles. Une annulation se voit venir et se
                remplace ; une personne qui ne vient pas laisse un créneau
                perdu. Le total des deux ne se décidait pas. */}
            <Tuile
              icon={CalendarX2}
              label="Annulés"
              valeur={String(courant.annules)}
              comparaison={comparer(courant.annules, precedentBilan.annules, avant)}
            />
            <Tuile
              icon={UserX}
              label="Non venus"
              valeur={String(courant.noShows)}
              comparaison={comparer(courant.noShows, precedentBilan.noShows, avant)}
            />
            <Tuile
              icon={Wallet}
              label={surLesVentes ? "Ventes du mois" : "Apporté par Comète"}
              valeur={montant(courant.chiffreAffaires, courant.devise)}
              comparaison={comparerMontant(
                courant.chiffreAffaires,
                precedentBilan.chiffreAffaires,
                avant,
                courant.devise,
              )}
            />
          </div>

          <section className="border-line bg-surface-1 rounded-lg border p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex items-center gap-2">
                <Coins aria-hidden="true" className="text-muted-foreground size-4" />
                <h2 className="text-sm">
                  {releve ? "Commission du mois" : "Commission estimée"}
                </h2>
              </div>
              {releve ? (
                <Badge variant={releve.status === "paye" ? "default" : "outline"}>
                  {ETATS_RELEVE[releve.status] ?? releve.status}
                </Badge>
              ) : (
                <Badge variant="outline">Brouillon</Badge>
              )}
            </div>

            <p className="font-display mt-3 text-3xl font-semibold tabular-nums">
              {montant(
                releve ? releve.commission_cents : courant.commission,
                courant.devise,
              )}
            </p>

            <p className="text-muted-foreground mt-2 text-sm">
              {releve
                ? `${Number(releve.commission_rate)} % de ${montant(releve.base_cents, courant.devise)} ${
                    surLesVentes
                      ? "de ventes déclarées, sur des rendez-vous venus des canaux Comète."
                      : "de séances honorées et payées, venues des canaux Comète."
                  }`
                : `${reglages.commission_rate} % de ${montant(courant.chiffreAffaires, courant.devise)}. Ce chiffre bouge encore : il se fige quand Louis clôture le mois.`}
            </p>

            {releve ? (
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href={`/app/${orgSlug}/resultats/releves/${releve.id}`} prefetch>
                  Voir le relevé
                </Link>
              </Button>
            ) : null}
          </section>

          {aRegarder.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-sm">À vérifier</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {surLesVentes
                    ? "Ces séances sont passées et comptent comme honorées. Dis si l'une d'elles ne s'est pas tenue, et si elle a débouché sur une vente."
                    : "Ces séances sont passées et comptent comme honorées. Si l'une d'elles ne s'est pas tenue, dis-le maintenant."}
                </p>
              </div>
              <AVerifier
                orgSlug={orgSlug}
                lignes={aRegarder}
                canaux={canaux}
                demanderLaVente={surLesVentes}
              />
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-sm">D&apos;où viennent tes rendez-vous</h2>
            <RepartitionCanaux parts={parts} devise={courant.devise} />
          </section>
        </div>
      )}
    </>
  );
}

export default async function RadarPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/resultats">) {
  const { orgSlug } = await params;
  const { mois } = await searchParams;
  // Garde hors `<Suspense>` : c'est elle qui décide du statut de la réponse.
  const { org } = await requireMembership(orgSlug);

  return (
    <>
      <PageHeader
        title="Radar"
        description="Tes rendez-vous, d'où ils viennent, et le relevé du mois."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}`} prefetch>
                <ArrowLeft aria-hidden="true" />
                Tes outils
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}/resultats/rendez-vous`} prefetch>
                <Radar aria-hidden="true" />
                Rendez-vous
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}/resultats/releves`} prefetch>
                <FileText aria-hidden="true" />
                Relevés
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={`/app/${orgSlug}/resultats/reglages`} prefetch>
                <SlidersHorizontal aria-hidden="true" />
                Réglages
              </Link>
            </Button>
          </div>
        }
      />

      <Suspense fallback={<CountersSkeleton compteurs={4} />}>
        <TableauDeBord
          organizationId={org.id}
          orgSlug={orgSlug}
          mois={moisDemande(mois)}
        />
      </Suspense>
    </>
  );
}
