import { FolderOpen, Radar, SquareKanban, type LucideIcon } from "lucide-react";

/**
 * Catalogue des outils internes.
 *
 * Deux sources, deux rôles : ce registre décrit ce que le code sait faire
 * (icône, route), la table `tools` dit ce qui existe et pour qui c'est activé.
 *
 * Le slug reste l'adresse — routes, chemins Storage, politiques RLS — et ne
 * suit pas les changements de nom : `kanban` porte Orbite, `fichiers` porte
 * Capsule. C'est la table qui fournit le nom affiché ; celui d'ici sert de
 * repère au développeur.
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
    name: "Orbite",
    description: "Tes tableaux de suivi : listes, cartes, avancement à plusieurs.",
    icon: SquareKanban,
    href: (orgSlug) => `/app/${orgSlug}/kanban`,
  },
  fichiers: {
    slug: "fichiers",
    name: "Capsule",
    description:
      "Tes photos, vidéos et documents, conservés en qualité d'origine.",
    icon: FolderOpen,
    href: (orgSlug) => `/app/${orgSlug}/fichiers`,
  },
  resultats: {
    slug: "resultats",
    name: "Radar",
    description: "Tes rendez-vous, d'où ils viennent, et le relevé du mois.",
    icon: Radar,
    href: (orgSlug) => `/app/${orgSlug}/resultats`,
  },
};

export function getToolMeta(slug: string): ToolMeta | null {
  return TOOL_REGISTRY[slug] ?? null;
}
