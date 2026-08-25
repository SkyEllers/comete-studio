import "server-only";

import { tempsRelatif } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export type BoardSummary = {
  id: string;
  name: string;
  description: string;
  color: string;
  position: number;
  isArchived: boolean;
  cardCount: number;
  /** Déjà formaté côté serveur : un calcul côté navigateur divergerait au rendu. */
  updatedLabel: string;
};

/**
 * Tableaux d'une organisation, actifs et archivés, avec le nombre de cartes
 * vivantes. La RLS fait le tri : si l'outil est coupé pour l'organisation,
 * cette lecture ne renvoie rien.
 */
export async function getBoards(organizationId: string): Promise<{
  active: BoardSummary[];
  archived: BoardSummary[];
}> {
  const supabase = await createClient();

  const [{ data: boards }, { data: cards }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name, description, color, position, is_archived, updated_at")
      .eq("organization_id", organizationId)
      .order("position")
      .order("name"),
    supabase.from("cards").select("board_id").eq("is_archived", false),
  ]);

  const cardCount = new Map<string, number>();
  for (const card of cards ?? []) {
    cardCount.set(card.board_id, (cardCount.get(card.board_id) ?? 0) + 1);
  }

  const maintenant = new Date();
  const resume = (board: NonNullable<typeof boards>[number]): BoardSummary => ({
    id: board.id,
    name: board.name,
    description: board.description,
    color: board.color,
    position: board.position,
    isArchived: board.is_archived,
    cardCount: cardCount.get(board.id) ?? 0,
    updatedLabel: tempsRelatif(board.updated_at, maintenant),
  });

  return {
    active: (boards ?? []).filter((b) => !b.is_archived).map(resume),
    archived: (boards ?? []).filter((b) => b.is_archived).map(resume),
  };
}
