import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/access";
import { BoardView } from "@/tools/kanban/board-view";
import { getBoardData } from "@/tools/kanban/queries";

export default async function BoardPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/kanban/[boardId]">) {
  const { orgSlug, boardId } = await params;
  const { card } = await searchParams;

  // Gardes hors de tout `<Suspense>` : ce sont elles qui décident du statut.
  const { org, role, userId } = await requireMembership(orgSlug);

  const data = await getBoardData(
    org.id,
    boardId,
    role === "owner" || role === "admin",
  );

  // Tableau inconnu, ou appartenant à un autre client : même réponse.
  if (!data) notFound();

  // `?card=` est vérifié ici, pas dans le navigateur : le lien d'une carte
  // d'un autre client doit répondre 404, pas ouvrir un tableau avec une fiche
  // vide.
  const cardId = typeof card === "string" ? card : null;
  if (cardId && !data.cards.some((c) => c.id === cardId)) notFound();

  return (
    <BoardView
      initial={data}
      orgSlug={orgSlug}
      userId={userId}
      initialCardId={cardId}
    />
  );
}
