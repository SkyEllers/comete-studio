import { Activity, ArrowLeft, Eye, MousePointerClick, Percent, Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { CountersSkeleton } from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { cn } from "@/lib/utils";
/* La tuile de Radar, importée plutôt que recopiée : c'est la même chose à
   afficher, et deux copies finiraient par diverger. Le jour où un troisième
   outil en veut une, elle ira dans `components/app/`. */
import { Tuile } from "@/tools/resultats/tuiles";
import { Balise } from "@/tools/sonde/balise";
import { Graphique, Repartition } from "@/tools/sonde/graphique";
import { compte, periodeDemandee, periodesAOffrir, taux } from "@/tools/sonde/mesure";
import {
  getCanaux,
  getDetails,
  getJoursConnus,
  getMesure,
  getReservations,
  getSites,
} from "@/tools/sonde/queries";

/**
 * Ce que Sonde montre au client : qui est venu, d'où, et combien ont cliqué.
 *
 * Le client le voit comme Louis, sans réserve. Ses visiteurs ne sont pas un
 * secret pour lui — c'est la dépense publicitaire qui reste dans Radar, côté
 * administration.
 */

export default async function SondePage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/sonde">) {
  const { orgSlug } = await params;
  const { periode: demandee } = await searchParams;
  // Garde hors `<Suspense>` : c'est elle qui décide du statut de la réponse.
  const { org, role } = await requireMembership(orgSlug);

  const periode = periodeDemandee(demandee);

  return (
    <>
      <PageHeader
        title="Sonde"
        description="Qui visite tes pages, d'où, et qui clique pour réserver."
        action={
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}`} prefetch>
              <ArrowLeft aria-hidden="true" />
              Tes outils
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<CountersSkeleton compteurs={4} />}>
        <Mesure
          organizationId={org.id}
          orgSlug={orgSlug}
          periodeCle={periode.cle}
          estAdmin={role === "admin"}
        />
      </Suspense>
    </>
  );
}

async function Mesure({
  organizationId,
  orgSlug,
  periodeCle,
  estAdmin,
}: {
  organizationId: string;
  orgSlug: string;
  periodeCle: string;
  estAdmin: boolean;
}) {
  const periode = periodeDemandee(periodeCle);

  const [sites, joursConnus, canaux] = await Promise.all([
    getSites(organizationId),
    getJoursConnus(organizationId),
    getCanaux(organizationId),
  ]);

  const jamaisRienRecu = sites.every((site) => !site.last_event_at);

  if (sites.length === 0 || jamaisRienRecu) {
    return <Attente sites={sites} estAdmin={estAdmin} />;
  }

  const [{ mesure, tronquee }, details, reservations] = await Promise.all([
    getMesure(organizationId, periode),
    getDetails(organizationId, periode),
    getReservations(organizationId, periode),
  ]);

  const nomCanal = new Map(canaux.map((canal) => [canal.id, canal]));
  const SEAUX: Record<string, string> = {
    direct: "Direct",
    referent: "Autres sites",
    canal: "Sans canal",
  };

  return (
    <div className="space-y-8">
      <Puces orgSlug={orgSlug} courante={periode.cle} choix={periodesAOffrir(joursConnus)} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tuile icon={Users} label="Visiteurs" valeur={mesure.visiteurs.toLocaleString("fr-FR")} />
        <Tuile icon={Eye} label="Pages vues" valeur={mesure.pagesVues.toLocaleString("fr-FR")} />
        <Tuile
          icon={MousePointerClick}
          label="Clics « réserver »"
          valeur={mesure.clics.toLocaleString("fr-FR")}
        />
        <Tuile
          icon={Percent}
          label="Taux de clic"
          valeur={taux(mesure.clics, mesure.visiteurs)}
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm">Jour par jour</h2>
        <Graphique jours={mesure.jours} />
        <p className="text-muted-foreground text-xs">
          Un visiteur est compté une fois par jour. Quelqu&apos;un qui revient
          mardi puis jeudi compte deux fois : sans cookie, rien ne permet de
          savoir que c&apos;est la même personne — et c&apos;est le but.
          {tronquee ? " Cette période dépasse ce qu'on peut relire d'un coup : les derniers jours peuvent être incomplets." : ""}
        </p>
      </section>

      {reservations !== null ? (
        <Entonnoir
          visiteurs={mesure.visiteurs}
          clics={mesure.clics}
          reservations={reservations}
          periode={periode.libelle}
        />
      ) : null}

      <div className="grid gap-8 sm:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm">D&apos;où ils viennent</h2>
          <Repartition
            vide="Rien à répartir sur cette période."
            parts={mesure.parCanal.map((part) => {
              const canal = part.channelId ? nomCanal.get(part.channelId) : null;
              return {
                cle: part.cle,
                label: canal?.label ?? SEAUX[part.seau] ?? part.seau,
                valeur: part.visiteurs,
                detail: `${part.visiteurs} · ${part.clics} clic${part.clics > 1 ? "s" : ""}`,
                accent: canal?.is_comete,
              };
            })}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm">Pages les plus vues</h2>
          <Repartition
            vide={
              details.horsRetention
                ? "Le détail par page ne remonte pas au-delà de treize mois."
                : "Aucune page vue sur cette période."
            }
            parts={details.pages.map((part) => ({
              cle: part.label,
              label: part.label,
              valeur: part.visiteurs,
            }))}
          />
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm">Sites qui t&apos;envoient du monde</h2>
        <Repartition
          vide={
            details.horsRetention
              ? "Le détail par référent ne remonte pas au-delà de treize mois."
              : "Personne n'est arrivé depuis un autre site sur cette période."
          }
          parts={details.referents.map((part) => ({
            cle: part.label,
            label: part.label,
            valeur: part.visiteurs,
          }))}
        />
      </section>
    </div>
  );
}

/** Les puces de période, dans l'URL pour qu'un écran se partage et se recharge. */
function Puces({
  orgSlug,
  courante,
  choix,
}: {
  orgSlug: string;
  courante: string;
  choix: { cle: string; libelle: string }[];
}) {
  return (
    <nav
      aria-label="Choisir la période"
      className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      {choix.map((valeur) => (
        <Link
          key={valeur.cle}
          href={`/app/${orgSlug}/sonde?periode=${valeur.cle}`}
          prefetch
          aria-current={valeur.cle === courante ? "page" : undefined}
          className={cn(
            "shrink-0 snap-start rounded-full border px-3 py-1.5 text-sm transition-colors",
            valeur.cle === courante
              ? "border-ember bg-ember text-void font-medium"
              : "border-line text-muted-foreground hover:text-foreground",
          )}
        >
          {valeur.libelle}
        </Link>
      ))}
    </nav>
  );
}

/**
 * L'entonnoir, quand Radar est là pour en donner la fin.
 *
 * Trois nombres et deux taux, écrits comme on les dirait : trois cents
 * visiteurs, quarante et un ont cliqué, neuf ont réservé.
 */
function Entonnoir({
  visiteurs,
  clics,
  reservations,
  periode,
}: {
  visiteurs: number;
  clics: number;
  reservations: number;
  periode: string;
}) {
  const etapes = [
    { label: "Visiteurs", valeur: visiteurs, taux: null as string | null },
    { label: "Clics « réserver »", valeur: clics, taux: taux(clics, visiteurs) },
    { label: "Réservations", valeur: reservations, taux: taux(reservations, clics) },
  ];

  return (
    <section className="border-line bg-surface-1 space-y-4 rounded-lg border p-5">
      <div className="flex items-center gap-2">
        <Activity aria-hidden="true" className="text-muted-foreground size-4" />
        <h2 className="text-sm">De la visite à la séance, en {periode}</h2>
      </div>

      <ol className="grid grid-cols-3 gap-3">
        {etapes.map((etape) => (
          <li key={etape.label} className="space-y-1">
            <p className="font-display text-2xl font-semibold tabular-nums">
              {etape.valeur.toLocaleString("fr-FR")}
            </p>
            <p className="text-muted-foreground text-xs">{etape.label}</p>
            {etape.taux ? (
              <p className="text-ember font-mono text-xs">{etape.taux} de l&apos;étape d&apos;avant</p>
            ) : null}
          </li>
        ))}
      </ol>

      <p className="text-muted-foreground text-xs">
        Les réservations viennent de Radar, qui les reçoit de Calendly. Sonde
        s&apos;arrête au clic : ce qui se passe ensuite ne se mesure pas sur ta page.
      </p>
    </section>
  );
}

/**
 * L'écran d'avant la première visite.
 *
 * Il ne dit pas « aucune donnée » : il dit ce qu'il manque et ce qu'il faut
 * faire. À Louis, il donne la balise à copier ; au client, il dit qui s'en
 * occupe, parce que ce n'est pas à lui de toucher au code de sa page.
 */
function Attente({
  sites,
  estAdmin,
}: {
  sites: { id: string; name: string; token: string; is_active: boolean }[];
  estAdmin: boolean;
}) {
  const origine = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cometestudio.fr";

  if (sites.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="Aucune page n'est encore suivie."
        description={
          estAdmin
            ? "Déclare le site du client dans l'administration, puis pose la balise sur sa landing."
            : "Louis déclare la page à suivre, puis pose la mesure dessus. Il s'en occupe."
        }
      />
    );
  }

  return (
    <div className="border-line bg-surface-1 space-y-4 rounded-lg border border-dashed p-6">
      <div className="text-center">
        <Activity
          aria-hidden="true"
          className="text-muted-foreground mx-auto mb-3 size-6"
          strokeWidth={1.5}
        />
        <p className="font-display font-semibold">
          {compte(sites.length, "page déclarée", "pages déclarées")}, aucune visite reçue.
        </p>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {estAdmin
            ? "La balise n'est probablement pas encore en place sur la landing."
            : "La mesure est déclarée mais pas encore posée sur la page. Louis s'en occupe."}
        </p>
      </div>

      {estAdmin ? (
        <div className="space-y-3">
          {sites.map((site) => (
            <div key={site.id} className="space-y-1.5">
              <p className="text-muted-foreground font-mono text-xs">
                {site.name}
                {site.is_active ? "" : " · désactivé"}
              </p>
              <Balise jeton={site.token} origine={origine} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
