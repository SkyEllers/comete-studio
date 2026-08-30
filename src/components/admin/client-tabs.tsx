import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Les faces d'une fiche client.
 *
 * Des routes plutôt qu'un composant à onglets : la partie Radar interroge
 * Calendly et une demi-douzaine de tables, et n'a pas à être chargée quand on
 * vient renommer un client.
 *
 * Un onglet n'apparaît que si son outil est activé : sans lui, il n'aurait
 * rien à montrer, et une fiche pleine d'onglets vides se lit mal.
 */
export function ClientTabs({
  organizationId,
  actif,
  radarActif,
  sondeActif,
}: {
  organizationId: string;
  actif: "fiche" | "radar" | "sonde";
  radarActif: boolean;
  sondeActif?: boolean;
}) {
  const onglets = [
    { cle: "fiche" as const, libelle: "Fiche", affiche: true },
    { cle: "radar" as const, libelle: "Radar", affiche: radarActif },
    { cle: "sonde" as const, libelle: "Sonde", affiche: Boolean(sondeActif) },
  ].filter((onglet) => onglet.affiche);

  // Seule la fiche : il n'y a pas d'onglets, il y a une page.
  if (onglets.length < 2) return null;

  const adresse = (cle: string) =>
    cle === "fiche"
      ? `/admin/clients/${organizationId}`
      : `/admin/clients/${organizationId}/${cle}`;

  return (
    <nav className="border-line -mb-px flex gap-1 border-b" aria-label="Sections du client">
      {onglets.map((onglet) => (
        <Link
          key={onglet.cle}
          href={adresse(onglet.cle)}
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
