import { SquareKanban, type LucideIcon } from "lucide-react";

/**
 * Catalogue des outils internes.
 *
 * Deux sources, deux rôles : ce registre décrit ce que le code sait faire
 * (icône, route), la table `tools` dit ce qui existe et pour qui c'est activé.
 * Un slug présent en base mais absent d'ici n'a pas de page : il est signalé
 * dans l'administration et n'apparaît jamais côté client.
 */
export type ToolMeta = {
  slug: string;
  name: string;
  description: string;
  icon: LucideIcon;
  href: (orgSlug: string) => string;
};

export const TOOL_REGISTRY: Record<string, ToolMeta> = {
  kanban: {
    slug: "kanban",
    name: "Kanban",
    description:
      "Tableaux, listes et cartes pour piloter un projet à plusieurs.",
    icon: SquareKanban,
    href: (orgSlug) => `/app/${orgSlug}/kanban`,
  },
};

export function getToolMeta(slug: string): ToolMeta | null {
  return TOOL_REGISTRY[slug] ?? null;
}
