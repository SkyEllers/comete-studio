import { ArrowLeft, CalendarClock } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { TableSkeleton } from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { cn } from "@/lib/utils";
import { ChercherNom } from "@/tools/resultats/chercher-nom";
import { libelleMois, moisAOffrir, moisDemande } from "@/tools/resultats/mois";
import {
  chercherRendezVous,
  getActivitesDuMois,
  getCanaux,
  getMoisClotures,
  getMoisConnus,
  getReleve,
  getRendezVous,
  getSourcesAttribution,
} from "@/tools/resultats/queries";
import { nettoyerRecherche } from "@/tools/resultats/recherche";
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
  recherche,
}: {
  organizationId: string;
  orgSlug: string;
  mois: string;
  canalFiltre?: string;
  statutFiltre?: string;
  recherche: string | null;
}) {
  const chemin = `/app/${orgSlug}/resultats/rendez-vous`;

  const [canaux, moisConnus] = await Promise.all([
    getCanaux(organizationId),
    getMoisConnus(organizationId),
  ]);

  /*
   * Chercher un nom sort du mois : on cherche justement parce qu'on ne sait
   * plus quand la personne est venue. Le sélecteur de mois s'efface alors, et
   * la liste couvre toute l'histoire du client, archives comprises.
   */
  const [toutes, moisClotures] = recherche
    ? await Promise.all([
        chercherRendezVous(organizationId, recherche),
        getMoisClotures(organizationId),
      ])
    : await Promise.all([
        getRendezVous(organizationId, mois),
        getReleve(organizationId, mois).then((releve) => (releve ? [mois] : [])),
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

  /*
   * Une adresse de cette page. La base dit dans quel monde on est — un mois,
   * ou une recherche — et les filtres s'y ajoutent. Les deux ne se mélangent
   * jamais : `q` et `mois` ensemble n'auraient aucun sens à lire.
   */
  const adresse = (
    base: Record<string, string>,
    parametres: Record<string, string | undefined>,
  ) => {
    const query = new URLSearchParams(base);
    for (const [cle, valeur] of Object.entries(parametres)) {
      if (valeur) query.set(cle, valeur);
    }
    return `${chemin}?${query}`;
  };

  const lien = (parametres: Record<string, string | undefined>) =>
    adresse(recherche ? { q: recherche } : { mois }, parametres);

  /** Quitter la recherche, en gardant les filtres et en revenant au mois. */
  const sansRecherche = adresse({ mois }, { canal: canalFiltre, statut: statutFiltre });

  return (
    <>
      {recherche ? null : (
        <SelecteurMois
          mois={mois}
          choix={moisAOffrir(moisConnus)}
          href={(valeur) =>
            `${chemin}?mois=${valeur}${canalFiltre ? `&canal=${canalFiltre}` : ""}${statutFiltre ? `&statut=${statutFiltre}` : ""}`
          }
        />
      )}

      <div className="mb-6 space-y-3">
        <ChercherNom
          action={chemin}
          valeur={recherche ?? undefined}
          caches={{ canal: canalFiltre, statut: statutFiltre }}
          effacer={recherche ? sansRecherche : undefined}
        />

        {recherche ? (
          <p className="text-muted-foreground text-xs">
            {lignes.length === 0
              ? "Aucun rendez-vous à ce nom"
              : `${lignes.length} rendez-vous à ce nom`}
            , tous mois confondus.
          </p>
        ) : null}

        <div className="space-y-2">
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
      </div>

      {lignes.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Rien à afficher."
          description={
            recherche
              ? "Aucun rendez-vous ne porte ce nom. Les séances reçues avant l'arrivée des noms n'en ont pas."
              : toutes.length > 0
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
          moisClotures={moisClotures}
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
  const { mois, canal, statut, q } = await searchParams;
  const { org } = await requireMembership(orgSlug);
  const recherche = nettoyerRecherche(seul(q));

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

      <Suspense
        key={`${seul(mois) ?? ""}|${seul(canal) ?? ""}|${seul(statut) ?? ""}|${recherche ?? ""}`}
        fallback={<TableSkeleton rows={4} />}
      >
        <Liste
          organizationId={org.id}
          orgSlug={orgSlug}
          mois={moisDemande(mois)}
          canalFiltre={seul(canal)}
          statutFiltre={seul(statut)}
          recherche={recherche}
        />
      </Suspense>
    </>
  );
}
