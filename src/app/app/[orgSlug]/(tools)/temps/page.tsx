import { requireMembership } from "@/lib/access";
import { heureParis, jourParis } from "@/lib/dates";
import { Chrono, type ChronoAffiche } from "@/tools/pulsar/chrono";
import { clientsActifs, ordonnerClients } from "@/tools/pulsar/clients";
import {
  entreesDeLaSemaine,
  entreesDuJour,
  formatDuree,
  totalMinutes,
} from "@/tools/pulsar/duree";
import { Journee, type EntreeAffichee } from "@/tools/pulsar/journee";
import {
  getClients,
  getEnCours,
  getRecence,
  getSemaine,
} from "@/tools/pulsar/queries";

/**
 * L'écran d'arrivée de Pulsar : les chronomètres, puis la journée.
 *
 * Pensé téléphone d'abord, et dans cet ordre-là : on vient ici pour lancer ou
 * arrêter, pas pour lire. La lecture — deux totaux, une liste — tient sous le
 * pouce, et le reste attend les écrans Par client et Comète.
 *
 * Tout le découpage se fait ici, côté serveur, à partir d'une seule lecture de
 * la semaine : la journée, la semaine, les noms de clients et les heures
 * d'affichage. Un libellé calculé deux fois — au rendu puis à l'hydratation —
 * diverge dès qu'un jour tourne entre les deux.
 */
export default async function PulsarPage({
  params,
}: PageProps<"/app/[orgSlug]/temps">) {
  const { orgSlug } = await params;
  const { org, userId } = await requireMembership(orgSlug);

  const [clients, semaine, recence, enCours] = await Promise.all([
    getClients(org.id),
    getSemaine(org.id),
    getRecence(org.id),
    getEnCours(org.id, userId),
  ]);

  const aujourdhui = jourParis();
  const noms = new Map(clients.map((client) => [client.id, client.name]));
  const tous = ordonnerClients(clients, recence);
  const actifs = clientsActifs(tous);

  const duJour = entreesDuJour(semaine, aujourdhui);

  /*
   * Les chronomètres en marche sont retirés de la liste : ils ont leurs cartes
   * au-dessus, et une ligne sans durée n'aurait rien à montrer dans une
   * colonne de durées. Ils ne comptent pas non plus dans les totaux —
   * `totalMinutes` ignore les entrées sans durée, et c'est le même silence.
   * Deux chronomètres sur le même créneau, une fois arrêtés, y comptent tous
   * les deux : la journée peut faire plus d'heures que l'horloge.
   */
  const lignes: EntreeAffichee[] = duJour
    .filter((entree) => entree.ended_at !== null)
    .map((entree) => ({
      ...entree,
      clientNom: noms.get(entree.client_id) ?? "Client retiré",
      repere: entree.is_manual ? "Saisie" : heureParis(entree.started_at),
    }));

  /*
   * « depuis 14:07 » — et la date quand il est parti un autre jour : c'est
   * précisément le chronomètre oublié hier soir qu'il faut reconnaître d'un
   * coup d'œil.
   */
  const chronos: ChronoAffiche[] = enCours.map((entree) => {
    const jour = jourParis(entree.started_at);
    const heure = heureParis(entree.started_at);

    return {
      ...entree,
      clientNom: noms.get(entree.client_id) ?? "Client retiré",
      depuis:
        jour === aujourdhui ? heure : `${jour.slice(8, 10)}/${jour.slice(5, 7)} ${heure}`,
    };
  });

  const totalJour = totalMinutes(duJour);
  const totalSemaine = totalMinutes(entreesDeLaSemaine(semaine, aujourdhui));

  return (
    <div className="space-y-8">
      <dl className="border-line bg-surface-1 flex divide-x divide-[var(--line)] rounded-lg border">
        <div className="flex-1 px-4 py-3">
          <dt className="text-muted-foreground font-mono text-xs">Aujourd&apos;hui</dt>
          <dd className="mt-0.5 font-mono text-xl tabular-nums">
            {formatDuree(totalJour)}
          </dd>
        </div>
        <div className="flex-1 px-4 py-3">
          <dt className="text-muted-foreground font-mono text-xs">Cette semaine</dt>
          <dd className="mt-0.5 font-mono text-xl tabular-nums">
            {formatDuree(totalSemaine)}
          </dd>
        </div>
      </dl>

      {actifs.length === 0 ? (
        <div className="border-line bg-surface-1 rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="font-display font-semibold">Ton carnet est vide</p>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Il faut au moins un client pour chronométrer quoi que ce soit.
          </p>
        </div>
      ) : (
        <>
          <Chrono
            orgSlug={orgSlug}
            clients={actifs}
            tous={tous}
            enCours={chronos}
            aujourdhui={aujourdhui}
          />

          <Journee
            orgSlug={orgSlug}
            entrees={lignes}
            clients={tous}
            aujourdhui={aujourdhui}
          />
        </>
      )}
    </div>
  );
}
