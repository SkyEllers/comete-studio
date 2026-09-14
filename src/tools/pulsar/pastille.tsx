"use client";

import { Square } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { arreter } from "@/app/app/[orgSlug]/(tools)/temps/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Compteur } from "./chrono";
import { formatDuree } from "./duree";
import { libelleTache, type Tache } from "./types";

/**
 * Les chronomètres en marche, rappelés dans l'en-tête de l'outil.
 *
 * Elle ne s'affiche pas sur l'écran d'accueil : les cartes y disent déjà tout,
 * et deux compteurs qui défilent côte à côte se contrediraient d'une seconde.
 * Sur les autres écrans — les clients, la vue Comète — elle est le seul rappel
 * que quelque chose tourne.
 *
 * Un seul chronomètre : son client, son compteur, et l'arrêt en un tap, comme
 * avant. Plusieurs : leur nombre, qui ouvre la liste — chacun s'y arrête d'un
 * tap. Quatre noms et quatre compteurs ne tiennent pas dans un en-tête de
 * téléphone, et un nombre dit mieux qu'une file tronquée qu'il y en a
 * plusieurs.
 *
 * Elle arrête sans toucher à la note : celle qu'on a pu taper sur l'écran
 * d'accueil est déjà en base, et la pastille n'en sait rien.
 */

export type ChronoPastille = {
  id: string;
  client: string;
  task: Tache;
  depuis: string;
};

export function PastilleChrono({
  orgSlug,
  chronos,
}: {
  orgSlug: string;
  chronos: ChronoPastille[];
}) {
  const chemin = usePathname();

  if (chronos.length === 0 || chemin === `/app/${orgSlug}/temps`) return null;

  const [seul] = chronos;

  if (chronos.length === 1 && seul) {
    return (
      <div className="border-ember/40 bg-surface-1 flex items-center gap-2 rounded-full border py-1 pr-1 pl-3">
        <span className="min-w-0 truncate text-sm">
          <span className="font-medium">{seul.client}</span>
          <span className="text-muted-foreground max-sm:hidden">
            {" · "}
            {libelleTache(seul.task)}
          </span>
        </span>

        <Compteur depuis={seul.depuis} className="font-mono text-sm tabular-nums" />

        <BoutonArret orgSlug={orgSlug} chrono={seul} />
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${chronos.length} chronomètres en cours`}
          className="border-ember/40 bg-surface-1 hover:bg-surface-2 focus-visible:ring-ring flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <span className="bg-ember size-1.5 rounded-full" aria-hidden="true" />
          <span className="font-mono tabular-nums">{chronos.length}</span>
          <span>en cours</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <ul className="divide-y divide-[var(--line)]">
          {chronos.map((chrono) => (
            <li key={chrono.id} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{chrono.client}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {libelleTache(chrono.task)}
                </span>
              </span>

              <Compteur depuis={chrono.depuis} className="font-mono text-xs tabular-nums" />

              <BoutonArret orgSlug={orgSlug} chrono={chrono} />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** L'arrêt d'un chronomètre, avec sa propre attente : les autres restent cliquables. */
function BoutonArret({ orgSlug, chrono }: { orgSlug: string; chrono: ChronoPastille }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const stopper = () =>
    startTransition(async () => {
      const resultat = await arreter(orgSlug, chrono.id);

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
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={stopper}
      disabled={pending}
      aria-label={`Arrêter le chronomètre ${chrono.client}`}
    >
      <Square aria-hidden="true" />
    </Button>
  );
}
