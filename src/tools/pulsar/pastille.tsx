"use client";

import { Square } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { arreter } from "@/app/app/[orgSlug]/(tools)/temps/actions";
import { Button } from "@/components/ui/button";

import { Compteur } from "./chrono";
import { formatDuree } from "./duree";
import { libelleTache, type Tache } from "./types";

/**
 * Le chronomètre en marche, rappelé dans l'en-tête de l'outil.
 *
 * Elle ne s'affiche pas sur l'écran d'accueil : la grande carte y dit déjà
 * tout, et deux compteurs qui défilent côte à côte se contrediraient d'une
 * seconde. Sur les autres écrans — les clients, la vue Comète — elle est le
 * seul rappel qu'un chronomètre tourne, avec son arrêt en un tap.
 *
 * Elle arrête sans toucher à la note : celle qu'on a pu taper sur l'écran
 * d'accueil est déjà en base, et la pastille n'en sait rien.
 */
export function PastilleChrono({
  orgSlug,
  client,
  task,
  depuis,
}: {
  orgSlug: string;
  client: string;
  task: Tache;
  depuis: string;
}) {
  const chemin = usePathname();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (chemin === `/app/${orgSlug}/temps`) return null;

  const stopper = () =>
    startTransition(async () => {
      const resultat = await arreter(orgSlug);

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      if (resultat.data) {
        toast.success(
          `${resultat.data.client} : ${formatDuree(resultat.data.minutes)} comptées.`,
        );
      }
      router.refresh();
    });

  return (
    <div className="border-ember/40 bg-surface-1 flex items-center gap-2 rounded-full border py-1 pr-1 pl-3">
      <span className="min-w-0 truncate text-sm">
        <span className="font-medium">{client}</span>
        <span className="text-muted-foreground max-sm:hidden">
          {" · "}
          {libelleTache(task)}
        </span>
      </span>

      <Compteur depuis={depuis} className="font-mono text-sm tabular-nums" />

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={stopper}
        disabled={pending}
        aria-label="Arrêter le chronomètre"
      >
        <Square aria-hidden="true" />
      </Button>
    </div>
  );
}
