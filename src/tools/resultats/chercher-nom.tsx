import { Search, X } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * « Chercher un nom ».
 *
 * Un formulaire en `GET`, sans état ni JavaScript : il navigue vers la même
 * page avec un paramètre de plus, et la liste se rend côté serveur comme les
 * filtres canal et statut juste à côté. Une recherche se met donc en favori et
 * se partage, et elle marche avant que le navigateur ait fini de charger quoi
 * que ce soit.
 *
 * Les autres paramètres de la page voyagent en champs cachés : un formulaire
 * `GET` remplace la query string de son action par ses propres champs, et sans
 * eux, chercher un nom effacerait silencieusement le filtre de canal.
 */
export function ChercherNom({
  action,
  valeur,
  caches = {},
  effacer,
}: {
  /** Le chemin de la page, sans query string. */
  action: string;
  valeur?: string;
  /** Ce que la page portait déjà et qui doit survivre à la recherche. */
  caches?: Record<string, string | undefined>;
  /** Où mène « effacer ». Absent quand rien n'est cherché. */
  effacer?: string;
}) {
  return (
    <form action={action} method="get" className="flex items-center gap-2">
      {Object.entries(caches).map(([nom, contenu]) =>
        contenu ? <input key={nom} type="hidden" name={nom} value={contenu} /> : null,
      )}

      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        />
        <Input
          type="search"
          name="q"
          defaultValue={valeur}
          maxLength={60}
          placeholder="Chercher un nom"
          aria-label="Chercher un nom"
          className="pl-8"
        />
      </div>

      <Button type="submit" variant="outline" size="sm">
        Chercher
      </Button>

      {effacer ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={effacer} prefetch>
            <X aria-hidden="true" />
            Effacer
          </Link>
        </Button>
      ) : null}
    </form>
  );
}
