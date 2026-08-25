import { ArrowLeft, SquareKanban } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export default async function KanbanPage({
  params,
}: PageProps<"/app/[orgSlug]/kanban">) {
  const { orgSlug } = await params;

  return (
    <>
      <PageHeader
        title="Kanban"
        description="Tableaux, listes et cartes pour piloter un projet à plusieurs."
        action={
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}`} prefetch>
              <ArrowLeft aria-hidden="true" />
              Tes outils
            </Link>
          </Button>
        }
      />

      <EmptyState
        icon={SquareKanban}
        title="Le kanban arrive bientôt."
        description="L'outil est en cours de construction. Tu y retrouveras tes tableaux dès qu'il sera prêt."
      />
    </>
  );
}
