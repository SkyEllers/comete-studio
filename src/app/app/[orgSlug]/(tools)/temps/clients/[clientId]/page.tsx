import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SelecteurMois } from "@/components/app/selecteur-mois";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { heureParis, jourParis } from "@/lib/dates";
import { libelleMois, moisAOffrir, moisDemande } from "@/lib/mois";
import { formatDuree } from "@/tools/pulsar/duree";
import { LigneEntree } from "@/tools/pulsar/journee";
import { Repartition } from "@/tools/pulsar/liste-clients";
import {
  getClients,
  getEntreesDuMois,
  getHeuresCumulees,
  getMoisConnus,
  getReglages,
} from "@/tools/pulsar/queries";
import { bilanDuClient, euros, tauxLisible } from "@/tools/pulsar/revenus";
import {
  libelleModele,
  libelleProfil,
  libelleStatut,
  libelleTache,
} from "@/tools/pulsar/types";

/**
 * Le détail d'un client : les mêmes chiffres que la ligne, plus ses heures.
 *
 * C'est l'écran où l'on va quand un total surprend. La liste des entrées est
 * donc dans l'ordre du mois, la plus récente d'abord, avec la note telle
 * qu'elle a été tapée — c'est elle qui explique les chiffres, pas le total.
 *
 * Et c'est donc là qu'on corrige ce qui surprend : chaque heure terminée s'y
 * reprend en début, fin, durée et note, quel que soit son jour, sans repasser
 * par l'écran Aujourd'hui où elle n'est plus. Un chronomètre encore en marche
 * se corrige sur sa carte, pas ici.
 */
export default async function DetailClientPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/temps/clients/[clientId]">) {
  const { orgSlug, clientId } = await params;
  const { org } = await requireMembership(orgSlug);

  const mois = moisDemande((await searchParams).mois);

  const [clients, entrees, cumuls, reglages, moisConnus] = await Promise.all([
    getClients(org.id),
    getEntreesDuMois(org.id, mois),
    getHeuresCumulees(org.id),
    getReglages(org.id),
    getMoisConnus(org.id),
  ]);

  const client = clients.find((candidat) => candidat.id === clientId);
  if (!client) notFound();

  const bilan = bilanDuClient(
    client,
    entrees,
    cumuls.get(client.id) ?? 0,
    mois,
    reglages,
  );

  const siennes = entrees.filter((entree) => entree.client_id === client.id);
  const aujourdhui = jourParis();

  /* Le jour se lit à Paris : une entrée de 00 h 30 appartient à ce jour-là,
     pas à la veille d'UTC. Une saisie sans heure ne porte que sa date. */
  const repere = (instant: string, sansHeure: boolean) => {
    const jour = jourParis(instant);
    const date = `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
    return sansHeure ? date : `${date} ${heureParis(instant)}`;
  };

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/app/${orgSlug}/temps/clients?mois=${mois}`} prefetch>
          <ArrowLeft aria-hidden="true" />
          Tous les clients
        </Link>
      </Button>

      <div className="space-y-1">
        <h2 className="text-xl">{client.name}</h2>
        <p className="text-muted-foreground text-sm">
          {libelleModele(client.modele)}
          {" · "}
          {libelleStatut(client.statut)}
          {client.profil ? ` · ${libelleProfil(client.profil)}` : null}
          {client.montant_cents > 0 ? ` · ${euros(client.montant_cents)}` : null}
        </p>
      </div>

      <SelecteurMois
        mois={mois}
        choix={moisAOffrir(moisConnus)}
        href={(valeur) => `/app/${orgSlug}/temps/clients/${client.id}?mois=${valeur}`}
      />

      <dl className="border-line bg-surface-1 grid grid-cols-2 divide-x divide-y divide-[var(--line)] rounded-lg border sm:grid-cols-4 sm:divide-y-0">
        <div className="px-4 py-3">
          <dt className="text-muted-foreground font-mono text-xs">Heures du mois</dt>
          <dd className="mt-0.5 font-mono text-lg tabular-nums">
            {formatDuree(bilan.minutesDuMois)}
          </dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-muted-foreground font-mono text-xs">Cumulées</dt>
          <dd className="mt-0.5 font-mono text-lg tabular-nums">
            {formatDuree(bilan.minutesCumulees)}
          </dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-muted-foreground font-mono text-xs">
            Encaissé{bilan.base === "cumule" ? " cumulé" : ""}
          </dt>
          <dd className="mt-0.5 font-mono text-lg tabular-nums">
            {euros(bilan.encaisseCents)}
          </dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-muted-foreground font-mono text-xs">
            Taux réel{bilan.base === "cumule" ? " cumulé" : ""}
          </dt>
          <dd className="mt-0.5 font-mono text-lg tabular-nums">
            {tauxLisible(bilan.tauxCents)}
          </dd>
        </div>
      </dl>

      <Repartition bilan={bilan} />

      <section className="space-y-2">
        <h3 className="text-muted-foreground font-mono text-xs tracking-wide">
          Ses heures de {libelleMois(mois)}
        </h3>

        {siennes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aucune heure comptée sur ce client ce mois-ci.
          </p>
        ) : (
          <ul className="space-y-2">
            {siennes.map((entree) =>
              entree.ended_at === null ? (
                <li
                  key={entree.id}
                  className="border-line bg-surface-1 flex items-start gap-3 rounded-lg border p-3"
                >
                  <span className="text-muted-foreground mt-0.5 w-20 shrink-0 font-mono text-xs tabular-nums">
                    {repere(entree.started_at, false)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{libelleTache(entree.task)}</p>
                    {entree.note ? (
                      <p className="text-muted-foreground mt-0.5 text-sm break-words">
                        {entree.note}
                      </p>
                    ) : null}
                  </div>

                  <span className="text-muted-foreground shrink-0 font-mono text-sm">
                    en cours
                  </span>
                  {/* La place du menu, pour que les durées restent alignées. */}
                  <span className="w-7 shrink-0" aria-hidden="true" />
                </li>
              ) : (
                <LigneEntree
                  key={entree.id}
                  orgSlug={orgSlug}
                  entree={{
                    ...entree,
                    clientNom: client.name,
                    repere: repere(entree.started_at, entree.is_manual),
                  }}
                  clients={clients}
                  aujourdhui={aujourdhui}
                  avecClient={false}
                  largeurRepere="w-20"
                />
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
