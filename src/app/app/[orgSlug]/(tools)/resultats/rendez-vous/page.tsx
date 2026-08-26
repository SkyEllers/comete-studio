import { ArrowLeft, CalendarClock } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { TableSkeleton } from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { cn } from "@/lib/utils";
import { libelleMois, moisAOffrir, moisDemande } from "@/tools/resultats/mois";
import {
  getActivitesDuMois,
  getCanaux,
  getMoisConnus,
  getReleve,
  getRendezVous,
  getSourcesAttribution,
} from "@/tools/resultats/queries";
import { ListeRendezVous } from "@/tools/resultats/rendez-vous-client";
import { SelecteurMois } from "@/tools/resultats/tuiles";

/**
 * Tous les rendez-vous d'un mois, groupés par jour.
 *
 * Les filtres canal et statut passent par l'URL plutôt que par un état de
 * composant : un lien vers « les annulés de septembre » se partage et se met
 * en favori, et la page reste rendue côté serveur.
 */

const STATUTS = [
  { valeur: "honore", libelle: "Honorés" },
  { valeur: "confirme", libelle: "À venir" },
  { valeur: "no_show", libelle: "Non venus" },
  { valeur: "annule", libelle: "Annulés" },
];

const seul = (valeur: string | string[] | undefined) =>
  Array.isArray(valeur) ? valeur[0] : valeur;

function Filtres({
  base,
  actif,
  choix,
  tout,
}: {
  base: (valeur?: string) => string;
  actif?: string;
  choix: { valeur: string; libelle: string }[];
  tout: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={base()}
        prefetch
        className={cn(
          "rounded-full border px-3 py-1 text-xs transition-colors",
          actif ? "border-line text-muted-foreground hover:text-foreground" : "border-ember text-ember",
        )}
      >
        {tout}
      </Link>
      {choix.map((option) => (
        <Link
          key={option.valeur}
          href={base(option.valeur)}
          prefetch
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            actif === option.valeur
              ? "border-ember text-ember"
              : "border-line text-muted-foreground hover:text-foreground",
          )}
        >
          {option.libelle}
        </Link>
      ))}
    </div>
  );
}

async function Liste({
  organizationId,
  orgSlug,
  mois,
  canalFiltre,
  statutFiltre,
}: {
  organizationId: string;
  orgSlug: string;
  mois: string;
  canalFiltre?: string;
  statutFiltre?: string;
}) {
  const [canaux, toutes, moisConnus, releve] = await Promise.all([
    getCanaux(organizationId),
    getRendezVous(organizationId, mois),
    getMoisConnus(organizationId),
    getReleve(organizationId, mois),
  ]);

  const lignes = toutes.filter(
    (ligne) =>
      (!canalFiltre || ligne.channel_id === canalFiltre) &&
      (!statutFiltre || ligne.effective_status === statutFiltre),
  );

  const [activites, sources] = await Promise.all([
    getActivitesDuMois(lignes.map((ligne) => ligne.id)),
    getSourcesAttribution(lignes),
  ]);

  const lien = (parametres: Record<string, string | undefined>) => {
    const query = new URLSearchParams({ mois });
    for (const [cle, valeur] of Object.entries(parametres)) {
      if (valeur) query.set(cle, valeur);
    }
    return `/app/${orgSlug}/resultats/rendez-vous?${query}`;
  };

  return (
    <>
      <SelecteurMois
        mois={mois}
        choix={moisAOffrir(moisConnus)}
        href={(valeur) =>
          `/app/${orgSlug}/resultats/rendez-vous?mois=${valeur}${canalFiltre ? `&canal=${canalFiltre}` : ""}${statutFiltre ? `&statut=${statutFiltre}` : ""}`
        }
      />

      <div className="mb-6 space-y-2">
        <Filtres
          tout="Tous les canaux"
          actif={canalFiltre}
          choix={canaux.map((canal) => ({ valeur: canal.id, libelle: canal.label }))}
          base={(valeur) => lien({ canal: valeur, statut: statutFiltre })}
        />
        <Filtres
          tout="Tous les statuts"
          actif={statutFiltre}
          choix={STATUTS}
          base={(valeur) => lien({ canal: canalFiltre, statut: valeur })}
        />
      </div>

      {lignes.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Rien à afficher."
          description={
            toutes.length > 0
              ? "Aucun rendez-vous ne correspond à ces filtres."
              : `Aucun rendez-vous en ${libelleMois(mois)}.`
          }
        />
      ) : (
        <ListeRendezVous
          orgSlug={orgSlug}
          rendezVous={lignes}
          canaux={canaux}
          activites={activites}
          sourcesAttribution={sources}
          moisCloture={Boolean(releve)}
        />
      )}
    </>
  );
}

export default async function RendezVousPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/resultats/rendez-vous">) {
  const { orgSlug } = await params;
  const { mois, canal, statut } = await searchParams;
  const { org } = await requireMembership(orgSlug);

  return (
    <>
      <PageHeader
        title="Tes rendez-vous"
        description="Chaque séance reçue de Calendly, avec son canal d'origine."
        action={
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}/resultats`} prefetch>
              <ArrowLeft aria-hidden="true" />
              Tableau de bord
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<TableSkeleton rows={4} />}>
        <Liste
          organizationId={org.id}
          orgSlug={orgSlug}
          mois={moisDemande(mois)}
          canalFiltre={seul(canal)}
          statutFiltre={seul(statut)}
        />
      </Suspense>
    </>
  );
}
