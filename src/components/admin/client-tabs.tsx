import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
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
 *
 * Horizon lit son activation ici plutôt que de la recevoir : trois pages
 * appellent ces onglets, et aucune n'a d'autre raison de connaître cet outil.
 */
export async function ClientTabs({
  organizationId,
  actif,
  radarActif,
  sondeActif,
}: {
  organizationId: string;
  actif: "fiche" | "radar" | "sonde" | "finances";
  radarActif: boolean;
  sondeActif?: boolean;
}) {
  const supabase = await createClient();
  const { data: horizon } = await supabase
    .from("organization_tools")
    .select("enabled, tools!inner(slug)")
    .eq("organization_id", organizationId)
    .eq("tools.slug", "finances")
    .maybeSingle();

  const onglets = [
    { cle: "fiche" as const, libelle: "Fiche", affiche: true },
    { cle: "radar" as const, libelle: "Radar", affiche: radarActif },
    { cle: "sonde" as const, libelle: "Sonde", affiche: Boolean(sondeActif) },
    { cle: "finances" as const, libelle: "Horizon", affiche: Boolean(horizon?.enabled) },
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
