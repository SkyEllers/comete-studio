"use client";

import { Boxes, PenLine } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * La navigation basse, sur téléphone.
 *
 * Deux entrées, pas plus : on vient ici pour vider sa tête, ou pour retrouver
 * ce qu'on y a mis. Elle est fixée en bas parce que c'est là que le pouce
 * tombe, et absente sur grand écran, où les liens du haut de page suffisent.
 *
 * `startsWith` sur les boîtes plutôt qu'une égalité : une boîte ouverte, la
 * pile « À ranger » et Perso sont toutes des façons de retrouver, et l'onglet
 * doit rester allumé pendant qu'on s'y promène.
 */
export function NavBasse({ orgSlug }: { orgSlug: string }) {
  const chemin = usePathname();
  const racine = `/app/${orgSlug}/sas`;

  const entrees = [
    { href: racine, label: "Capture", icone: PenLine, actif: chemin === racine },
    {
      href: `${racine}/boites`,
      label: "Boîtes",
      icone: Boxes,
      actif: chemin.startsWith(`${racine}/boites`) || chemin === `${racine}/perso`,
    },
  ];

  return (
    <nav
      aria-label="Sas"
      className="border-line bg-void/95 supports-[backdrop-filter]:bg-void/80 fixed inset-x-0 bottom-0 z-40 grid h-14 grid-cols-2 border-t backdrop-blur sm:hidden"
    >
      {entrees.map(({ href, label, icone: Icone, actif }) => (
        <Link
          key={href}
          href={href}
          prefetch
          aria-current={actif ? "page" : undefined}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 text-xs transition-colors",
            actif ? "text-ember" : "text-muted-foreground",
          )}
        >
          <Icone aria-hidden="true" className="size-5" strokeWidth={1.75} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
