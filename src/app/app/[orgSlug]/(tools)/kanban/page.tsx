import { ArrowLeft, SquareKanban } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { CardGridSkeleton } from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { ArchivedBoards } from "@/tools/kanban/archived-boards";
import { BoardCard } from "@/tools/kanban/board-card";
import { NewBoardDialog } from "@/tools/kanban/new-board-dialog";
import { getBoards } from "@/tools/kanban/queries";

/**
 * Sous la garde du layout (`requireToolAccess`) et sous `requireMembership` :
 * cette partie peut passer en flux, le statut de la réponse est déjà décidé.
 */
async function BoardList({
  organizationId,
  orgSlug,
  canDelete,
}: {
  organizationId: string;
  orgSlug: string;
  canDelete: boolean;
}) {
  const { active, archived } = await getBoards(organizationId);

  return (
    <>
      {active.length === 0 ? (
        <EmptyState
          icon={SquareKanban}
          title="Aucun tableau."
          description="Crée le premier pour poser tes idées."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((board) => (
            <BoardCard
              key={board.id}
              id={board.id}
              name={board.name}
              color={board.color}
              cardCount={board.cardCount}
              updatedLabel={board.updatedLabel}
              orgSlug={orgSlug}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}

      <ArchivedBoards boards={archived} />
    </>
  );
}

export default async function KanbanPage({
  params,
}: PageProps<"/app/[orgSlug]/kanban">) {
  const { orgSlug } = await params;
  // Garde hors `<Suspense>` : c'est elle qui décide du statut de la réponse.
  const { org, userId, role } = await requireMembership(orgSlug);

  return (
    <>
      <PageHeader
        title="Orbite"
        description="Tes tableaux de suivi : listes, cartes, avancement à plusieurs."
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}`} prefetch>
                <ArrowLeft aria-hidden="true" />
                Tes outils
              </Link>
            </Button>
            <NewBoardDialog
              organizationId={org.id}
              createdBy={userId}
              orgSlug={orgSlug}
            />
          </div>
        }
      />

      <Suspense fallback={<CardGridSkeleton />}>
        <BoardList
          organizationId={org.id}
          orgSlug={orgSlug}
          canDelete={role === "owner" || role === "admin"}
        />
      </Suspense>
    </>
  );
}
