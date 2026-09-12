import { SelecteurMois } from "@/components/app/selecteur-mois";
import { requireMembership } from "@/lib/access";
import { moisAOffrir, moisDemande } from "@/lib/mois";
import { formatDuree } from "@/tools/pulsar/duree";
import { ListeClients } from "@/tools/pulsar/liste-clients";
import {
  getClients,
  getEntreesDuMois,
  getHeuresCumulees,
  getMoisConnus,
  getReglages,
} from "@/tools/pulsar/queries";
import { bilansDuMois, euros } from "@/tools/pulsar/revenus";

/**
 * Par client : ce que chaque dossier a pris, et ce qu'il a rapporté.
 *
 * Le mois voyage par l'URL, comme dans Radar — « les heures de juillet » se
 * met en favori et se partage. Tout le reste est calculé ici, côté serveur, à
 * partir de trois lectures : les fiches, les heures du mois, et le cumul
 * depuis le début. Les chiffres eux-mêmes sortent de `revenus.ts`, qui ne
 * connaît ni la base ni l'heure qu'il est.
 */
export default async function ClientsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/temps/clients">) {
  const { orgSlug } = await params;
  const { org } = await requireMembership(orgSlug);

  const mois = moisDemande((await searchParams).mois);

  const [clients, entrees, cumuls, reglages, moisConnus] = await Promise.all([
    getClients(org.id),
    getEntreesDuMois(org.id, mois),
    getHeuresCumulees(org.id),
    getReglages(org.id),
    getMoisConnus(org.id),
  ]);

  const bilans = bilansDuMois(clients, entrees, cumuls, mois, reglages);

  const minutesDuMois = bilans.reduce((somme, bilan) => somme + bilan.minutesDuMois, 0);
  /*
   * L'encaissé du mois additionne les récurrents du mois et les one-shot qui
   * tombent dedans — jamais le cumulé d'un one-shot, qui compterait plusieurs
   * fois le même virement au fil des mois affichés.
   */
  const encaisseDuMois = bilans.reduce(
    (somme, bilan) => somme + (bilan.base === "mois" ? bilan.encaisseCents : 0),
    0,
  );

  return (
    <div className="space-y-6">
      <SelecteurMois
        mois={mois}
        choix={moisAOffrir(moisConnus)}
        href={(valeur) => `/app/${orgSlug}/temps/clients?mois=${valeur}`}
      />

      <dl className="border-line bg-surface-1 flex divide-x divide-[var(--line)] rounded-lg border">
        <div className="flex-1 px-4 py-3">
          <dt className="text-muted-foreground font-mono text-xs">Heures du mois</dt>
          <dd className="mt-0.5 font-mono text-xl tabular-nums">
            {formatDuree(minutesDuMois)}
          </dd>
        </div>
        <div className="flex-1 px-4 py-3">
          <dt className="text-muted-foreground font-mono text-xs">Encaissé du mois</dt>
          <dd className="mt-0.5 font-mono text-xl tabular-nums">
            {euros(encaisseDuMois)}
          </dd>
        </div>
      </dl>

      <ListeClients orgSlug={orgSlug} bilans={bilans} mois={mois} />
    </div>
  );
}
