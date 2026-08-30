import { ArrowLeft, Boxes, PenLine } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * L'en-tête commun aux écrans de Sas.
 *
 * Les mêmes liens que la navigation basse, mais pour le clavier et la souris :
 * sur grand écran, la barre du bas n'existe pas. Le lien vers l'écran courant
 * n'est pas répété — un bouton qui ramène là où l'on est déjà n'aide personne.
 */
export function EnteteSas({
  orgSlug,
  titre,
  description,
  courant,
  retour,
}: {
  orgSlug: string;
  titre: string;
  description?: string;
  courant: "capture" | "boites";
  /** Lien de remontée, sur les listes : vers les boîtes. */
  retour?: { href: string; label: string };
}) {
  const racine = `/app/${orgSlug}/sas`;

  return (
    <div className="mb-5 space-y-3">
      {retour ? (
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={retour.href} prefetch>
            <ArrowLeft aria-hidden="true" />
            {retour.label}
          </Link>
        </Button>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl">{titre}</h1>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {courant === "capture" ? (
            <Button asChild variant="outline" size="sm" className="max-sm:hidden">
              <Link href={`${racine}/boites`} prefetch>
                <Boxes aria-hidden="true" />
                Boîtes
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm" className="max-sm:hidden">
              <Link href={racine} prefetch>
                <PenLine aria-hidden="true" />
                Capture
              </Link>
            </Button>
          )}

          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/${orgSlug}`} prefetch>
              Tes outils
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
