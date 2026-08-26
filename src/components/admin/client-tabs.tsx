import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Les deux faces d'une fiche client.
 *
 * Deux routes plutôt qu'un composant à onglets : la partie Radar interroge
 * Calendly et une demi-douzaine de tables, et n'a pas à être chargée quand on
 * vient renommer un client.
 */
export function ClientTabs({
  organizationId,
  actif,
  radarActif,
}: {
  organizationId: string;
  actif: "fiche" | "radar";
  /** Sans l'outil, l'onglet n'a rien à montrer : on ne l'affiche pas. */
  radarActif: boolean;
}) {
  if (!radarActif) return null;

  const onglets = [
    { cle: "fiche" as const, libelle: "Fiche", href: `/admin/clients/${organizationId}` },
    { cle: "radar" as const, libelle: "Radar", href: `/admin/clients/${organizationId}/radar` },
  ];

  return (
    <nav className="border-line -mb-px flex gap-1 border-b" aria-label="Sections du client">
      {onglets.map((onglet) => (
        <Link
          key={onglet.cle}
          href={onglet.href}
          prefetch
          aria-current={actif === onglet.cle ? "page" : undefined}
          className={cn(
            "border-b-2 px-3 py-2 text-sm transition-colors",
            actif === onglet.cle
              ? "border-ember text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {onglet.libelle}
        </Link>
      ))}
    </nav>
  );
}
