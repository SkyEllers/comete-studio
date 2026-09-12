import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireToolAccess } from "@/lib/access";
import { PastilleChrono } from "@/tools/pulsar/pastille";
import { getClients, getEnCours } from "@/tools/pulsar/queries";

/**
 * Garde de l'outil : membre de l'organisation ET Pulsar activé pour elle,
 * sinon 404 — y compris pour Louis, qui dans un espace client voit ce que le
 * client voit. Pulsar n'est destiné qu'à Comète Studio, mais c'est
 * l'activation qui le dit, pas ce fichier.
 *
 * L'en-tête porte le chronomètre en marche. Il est lu ici plutôt que dans
 * chaque page : les lectures sont mémoïsées par requête, la page d'accueil ne
 * le redemande donc pas, et les écrans à venir en héritent sans y penser.
 */
export default async function PulsarLayout({
  children,
  params,
}: LayoutProps<"/app/[orgSlug]/temps">) {
  const { orgSlug } = await params;
  const { org, userId } = await requireToolAccess(orgSlug, "temps");

  const enCours = await getEnCours(org.id, userId);
  const clients = enCours ? await getClients(org.id) : [];
  const nomEnCours =
    clients.find((client) => client.id === enCours?.client_id)?.name ?? null;

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
          {enCours && nomEnCours ? (
            <PastilleChrono
              orgSlug={orgSlug}
              client={nomEnCours}
              task={enCours.task}
              depuis={enCours.started_at}
            />
          ) : null}

          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/${orgSlug}`} prefetch>
              Tes outils
            </Link>
          </Button>
        </div>
      </div>

      {children}
    </div>
  );
}
