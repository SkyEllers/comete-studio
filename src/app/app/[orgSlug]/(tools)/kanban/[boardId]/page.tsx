import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/access";
import { BoardView } from "@/tools/kanban/board-view";
import { getBoardData } from "@/tools/kanban/queries";

export default async function BoardPage({
  params,
}: PageProps<"/app/[orgSlug]/kanban/[boardId]">) {
  const { orgSlug, boardId } = await params;

  // Gardes hors de tout `<Suspense>` : ce sont elles qui décident du statut.
  const { org, role, userId } = await requireMembership(orgSlug);

  const data = await getBoardData(
    org.id,
    boardId,
    role === "owner" || role === "admin",
  );

  // Tableau inconnu, ou appartenant à un autre client : même réponse.
  if (!data) notFound();

  return <BoardView initial={data} orgSlug={orgSlug} userId={userId} />;
}
