import "server-only";

import { tempsRelatif } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import type { BoardCard, BoardData } from "./types";

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
    /*
     * `!inner` écarte les cartes dont la liste est archivée : elles ne sont pas
     * archivées elles-mêmes, mais elles ne sont pas sur le tableau non plus,
     * et le compte affiché doit dire ce qu'on y verra.
     */
    supabase
      .from("cards")
      .select("board_id, lists!inner (is_archived)")
      .eq("is_archived", false)
      .eq("lists.is_archived", false),
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

/**
 * Un tableau complet, en trois requêtes.
 *
 * Une seule attente pour la page, et le store côté navigateur démarre avec
 * tout ce qu'il lui faut : le tableau et ce qui lui appartient en propre
 * (listes, étiquettes), les cartes avec ce qui pend dessous (étiquettes,
 * membres, checklists, commentaires), et les membres de l'organisation. Le
 * reste est de l'agrégation en mémoire, sans aller-retour supplémentaire.
 *
 * Renvoie `null` si le tableau n'existe pas, s'il n'appartient pas à cette
 * organisation, ou si la RLS le cache (outil coupé, non-membre) : la page
 * répond alors 404 sans distinguer ces cas.
 */
export async function getBoardData(
  organizationId: string,
  boardId: string,
  canDelete: boolean,
): Promise<BoardData | null> {
  const supabase = await createClient();

  const [tableau, cartes, membres] = await Promise.all([
    supabase
      .from("boards")
      .select(
        "id, organization_id, name, description, color, is_archived, lists (id, name, position), labels (id, name, color)",
      )
      .eq("id", boardId)
      .eq("organization_id", organizationId)
      .eq("lists.is_archived", false)
      .order("position", { referencedTable: "lists" })
      .maybeSingle(),
    supabase
      .from("cards")
      .select(
        "id, list_id, title, description, position, due_date, is_completed, cover_color, card_labels (label_id), card_assignees (user_id), checklists (id, checklist_items (is_done)), comments (id)",
      )
      .eq("board_id", boardId)
      .eq("is_archived", false)
      .order("position"),
    supabase
      .from("memberships")
      .select("user_id, profiles (full_name, email)")
      .eq("organization_id", organizationId),
  ]);

  const board = tableau.data;
  if (!board) return null;

  const lists = board.lists ?? [];
  const listesActives = new Set(lists.map((liste) => liste.id));

  // Checklist → carte : le temps réel en a besoin, un événement d'item ne
  // porte que `checklist_id`.
  const checklistOwners: Record<string, string> = {};
  const cards: BoardCard[] = [];

  for (const card of cartes.data ?? []) {
    /*
     * Archiver une liste ne touche pas à ses cartes : elles restent actives,
     * simplement hors du tableau tant que leur liste l'est. C'est ce qui
     * permet à la restauration de tout ramener intact.
     */
    if (!listesActives.has(card.list_id)) continue;

    let checklistDone = 0;
    let checklistTotal = 0;

    for (const checklist of card.checklists ?? []) {
      checklistOwners[checklist.id] = card.id;
      for (const item of checklist.checklist_items ?? []) {
        checklistTotal += 1;
        if (item.is_done) checklistDone += 1;
      }
    }

    cards.push({
      id: card.id,
      listId: card.list_id,
      title: card.title,
      description: card.description,
      position: card.position,
      dueDate: card.due_date,
      isCompleted: card.is_completed,
      coverColor: card.cover_color,
      labelIds: (card.card_labels ?? []).map((l) => l.label_id),
      assigneeIds: (card.card_assignees ?? []).map((a) => a.user_id),
      checklistDone,
      checklistTotal,
      commentCount: (card.comments ?? []).length,
    });
  }

  return {
    board: {
      id: board.id,
      organizationId: board.organization_id,
      name: board.name,
      description: board.description,
      color: board.color,
      isArchived: board.is_archived,
    },
    lists,
    cards,
    labels: board.labels ?? [],
    members: (membres.data ?? []).map((m) => ({
      id: m.user_id,
      name: m.profiles?.full_name || m.profiles?.email || "—",
      email: m.profiles?.email ?? "",
    })),
    checklistOwners,
    canDelete,
  };
}
