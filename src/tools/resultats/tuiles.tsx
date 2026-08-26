import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { libelleMois } from "./mois";
import { montant } from "./format";
import type { PartCanal } from "./queries";

/**
 * Les blocs du tableau de bord.
 *
 * Mobile d'abord : deux tuiles par ligne sur un téléphone, quatre sur un
 * écran. Les comparaisons sont écrites en toutes lettres — « 3 de plus qu'en
 * juillet » plutôt qu'un « +3 » qui demande de deviner par rapport à quoi.
 */

export function SelecteurMois({
  mois,
  choix,
  href,
}: {
  mois: string;
  choix: string[];
  /** La page qui reçoit le mois : le tableau de bord ou la liste. */
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

export function Tuile({
  icon: Icon,
  label,
  valeur,
  comparaison,
}: {
  icon: LucideIcon;
  label: string;
  valeur: string;
  comparaison?: string | null;
}) {
  return (
    <div className="border-line bg-surface-1 rounded-lg border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {label}
      </div>
      <p className="font-display mt-2 text-2xl font-semibold tabular-nums">{valeur}</p>
      {comparaison ? (
        <p className="text-muted-foreground mt-1 text-xs">{comparaison}</p>
      ) : null}
    </div>
  );
}

/** « 3 de plus qu'en juillet », ou rien quand il n'y a rien à comparer. */
export function comparer(
  actuel: number,
  precedent: number,
  moisPrecedent: string,
): string | null {
  if (actuel === precedent) {
    return precedent === 0 ? null : `autant qu'en ${libelleMois(moisPrecedent).split(" ")[0]}`;
  }

  const nom = libelleMois(moisPrecedent).split(" ")[0];
  const ecart = Math.abs(actuel - precedent);
  return actuel > precedent
    ? `${ecart} de plus qu'en ${nom}`
    : `${ecart} de moins qu'en ${nom}`;
}

export function comparerMontant(
  actuel: number,
  precedent: number,
  moisPrecedent: string,
  devise: string,
): string | null {
  if (actuel === precedent) return null;

  const nom = libelleMois(moisPrecedent).split(" ")[0];
  const ecart = Math.abs(actuel - precedent);
  return actuel > precedent
    ? `${montant(ecart, devise)} de plus qu'en ${nom}`
    : `${montant(ecart, devise)} de moins qu'en ${nom}`;
}

/**
 * La répartition par canal.
 *
 * Des barres et non un camembert : on compare des longueurs bien mieux que des
 * angles, et sur un téléphone un camembert de sept parts est illisible.
 */
export function RepartitionCanaux({
  parts,
  devise,
}: {
  parts: PartCanal[];
  devise: string;
}) {
  const maximum = Math.max(...parts.map((part) => part.rendezVous), 1);

  return (
    <ul className="space-y-3">
      {parts.map((part) => (
        <li key={part.canal?.id ?? "aucun"} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className={cn(part.canal?.is_comete && "text-ember")}>
              {part.canal?.label ?? "Sans canal"}
            </span>
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              {part.rendezVous} · {montant(part.montant, devise)}
            </span>
          </div>
          <div
            className="bg-surface-2 h-1.5 overflow-hidden rounded-full"
            role="presentation"
          >
            <div
              className={cn("h-full rounded-full", part.canal?.is_comete ? "bg-ember" : "bg-muted-foreground")}
              style={{ width: `${Math.round((part.rendezVous / maximum) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
