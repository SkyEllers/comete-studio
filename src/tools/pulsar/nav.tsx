"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Les écrans de Pulsar, en trois liens.
 *
 * Aujourd'hui, Par client, Comète. On vient ici pour lancer un chronomètre
 * bien plus souvent que pour lire des chiffres : le premier lien est donc
 * l'écran d'accueil, et les deux autres se trouvent sans les chercher. Ils
 * vont du plus fréquent au plus rare, et du plus fin au plus large.
 *
 * `startsWith` sur les clients : le détail d'un client reste sous cet onglet,
 * qui doit rester allumé pendant qu'on s'y promène.
 */
export function NavPulsar({ orgSlug }: { orgSlug: string }) {
  const chemin = usePathname();
  const racine = `/app/${orgSlug}/temps`;

  const entrees = [
    { href: racine, label: "Aujourd'hui", actif: chemin === racine },
    {
      href: `${racine}/clients`,
      label: "Par client",
      actif: chemin.startsWith(`${racine}/clients`),
    },
    {
      href: `${racine}/comete`,
      label: "Comète",
      actif: chemin.startsWith(`${racine}/comete`),
    },
  ];

  return (
    <nav aria-label="Pulsar" className="flex gap-1">
      {entrees.map(({ href, label, actif }) => (
        <Link
          key={href}
          href={href}
          prefetch
          aria-current={actif ? "page" : undefined}
          className={cn(
            "rounded-full border px-3 py-1 text-sm transition-colors",
            actif
              ? "border-ember text-ember"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
