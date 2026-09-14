import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireToolAccess } from "@/lib/access";
import { NavPulsar } from "@/tools/pulsar/nav";
import { PastilleChrono } from "@/tools/pulsar/pastille";
import { getClients, getEnCours } from "@/tools/pulsar/queries";

/**
 * Garde de l'outil : membre de l'organisation ET Pulsar activé pour elle,
 * sinon 404 — y compris pour Louis, qui dans un espace client voit ce que le
 * client voit. Pulsar n'est destiné qu'à Comète Studio, mais c'est
 * l'activation qui le dit, pas ce fichier.
 *
 * L'en-tête porte les chronomètres en marche. Ils sont lus ici plutôt que dans
 * chaque page : les lectures sont mémoïsées par requête, la page d'accueil ne
 * les redemande donc pas, et chaque écran en hérite sans y penser.
 */
export default async function PulsarLayout({
  children,
  params,
}: LayoutProps<"/app/[orgSlug]/temps">) {
  const { orgSlug } = await params;
  const { org, userId } = await requireToolAccess(orgSlug, "temps");

  const enCours = await getEnCours(org.id, userId);
  const clients = enCours.length > 0 ? await getClients(org.id) : [];
  const noms = new Map(clients.map((client) => [client.id, client.name]));

  const chronos = enCours.map((entree) => ({
    id: entree.id,
    client: noms.get(entree.client_id) ?? "Client retiré",
    task: entree.task,
    depuis: entree.started_at,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl">Pulsar</h1>
          <p className="text-muted-foreground text-sm">
            Où passe ton temps, et ce qu&apos;il rapporte.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <PastilleChrono orgSlug={orgSlug} chronos={chronos} />

          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/${orgSlug}`} prefetch>
              Tes outils
            </Link>
          </Button>
        </div>
      </div>

      <NavPulsar orgSlug={orgSlug} />

      {children}
    </div>
  );
}
