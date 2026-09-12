import Link from "next/link";

import { libelleMois } from "@/lib/mois";
import { cn } from "@/lib/utils";

/**
 * Les puces de mois, partagées par les outils qui lisent leur mois.
 *
 * Écrites pour Radar, reprises telles quelles par Pulsar : un client qui passe
 * de l'un à l'autre ne doit pas avoir à réapprendre où se change le mois.
 *
 * Le mois voyage par l'URL et non par un état de composant — « les heures de
 * juillet » se met en favori, se partage, et la page reste rendue côté
 * serveur. Le rail défile horizontalement sur téléphone, où douze mois ne
 * tiennent pas.
 */
export function SelecteurMois({
  mois,
  choix,
  href,
}: {
  mois: string;
  choix: string[];
  /** La page qui reçoit le mois : le tableau de bord, la liste, les clients. */
  href: (mois: string) => string;
}) {
  return (
    <nav
      aria-label="Choisir le mois"
      className="-mx-4 mb-6 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      {choix.map((valeur) => (
        <Link
          key={valeur}
          href={href(valeur)}
          prefetch
          aria-current={valeur === mois ? "page" : undefined}
          className={cn(
            "shrink-0 snap-start rounded-full border px-3 py-1.5 text-sm transition-colors",
            valeur === mois
              ? "border-ember bg-ember text-void font-medium"
              : "border-line text-muted-foreground hover:text-foreground",
          )}
        >
          {libelleMois(valeur)}
        </Link>
      ))}
    </nav>
  );
}
