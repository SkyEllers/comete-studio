import { LayoutGrid, PanelsTopLeft } from "lucide-react";
import { Suspense } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { CardGridSkeleton } from "@/components/app/skeletons";
import { ToolCard } from "@/components/app/tool-card";
import { requireMembership } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { getToolMeta } from "@/tools/registry";

/**
 * La garde a déjà tranché dans le layout et juste au-dessus : cette partie
 * peut passer en flux, le statut de la réponse est déjà décidé.
 */
async function ToolsGrid({
  organizationId,
  orgSlug,
}: {
  organizationId: string;
  orgSlug: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_tools")
    .select("enabled, tools (slug, name, description, kind, href, is_active, sort_order)")
    .eq("organization_id", organizationId)
    .eq("enabled", true);

  const tools = (data ?? [])
    .map((row) => row.tools)
    .filter((tool) => tool !== null && tool.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  if (tools.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Aucun outil activé pour le moment."
        description="Ça viendra : Louis ouvre les outils au fur et à mesure."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((tool) => {
        if (tool.kind === "external") {
          // Un outil externe n'a pas de page chez nous : sans URL, il n'y a
          // rien à ouvrir, on ne l'affiche pas.
          if (!tool.href) return null;
          return (
            <ToolCard
              key={tool.slug}
              name={tool.name}
              description={tool.description}
              icon={PanelsTopLeft}
              href={tool.href}
              external
            />
          );
        }

        // Outil interne : sans entrée au registre, aucune route n'existe.
        // Il est signalé dans l'administration, jamais montré ici.
        const meta = getToolMeta(tool.slug);
        if (!meta) return null;

        return (
          <ToolCard
            key={tool.slug}
            name={tool.name}
            description={tool.description}
            icon={meta.icon}
            href={meta.href(orgSlug)}
          />
        );
      })}
    </div>
  );
}

export default async function EspacePage({
  params,
}: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  // Garde hors `<Suspense>` : c'est elle qui décide du statut de la réponse.
  const { org } = await requireMembership(orgSlug);

  return (
    <>
      <PageHeader
        title="Tes outils"
        description={`Ce que Louis a activé pour ${org.name}.`}
      />

      <Suspense fallback={<CardGridSkeleton />}>
        <ToolsGrid organizationId={org.id} orgSlug={orgSlug} />
      </Suspense>
    </>
  );
}
