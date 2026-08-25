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

/**
 * Un tableau complet, en une passe : la page n'a qu'une attente, et le store
 * côté navigateur démarre avec tout ce qu'il lui faut.
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

  const { data: board } = await supabase
    .from("boards")
    .select("id, organization_id, name, description, color, is_archived")
    .eq("id", boardId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!board) return null;

  const [
    { data: lists },
    { data: cards },
    { data: labels },
    { data: checklists },
    { data: comments },
    { data: memberships },
  ] = await Promise.all([
    supabase
      .from("lists")
      .select("id, name, position")
      .eq("board_id", boardId)
      .eq("is_archived", false)
      .order("position"),
    supabase
      .from("cards")
      .select(
        "id, list_id, title, description, position, due_date, is_completed, cover_color, card_labels (label_id), card_assignees (user_id)",
      )
      .eq("board_id", boardId)
      .eq("is_archived", false)
      .order("position"),
    supabase.from("labels").select("id, name, color").eq("board_id", boardId),
    supabase
      .from("checklists")
      .select("id, card_id, checklist_items (is_done)")
      .eq("board_id", boardId),
    supabase.from("comments").select("card_id").eq("board_id", boardId),
    supabase
      .from("memberships")
      .select("user_id, profiles (full_name, email)")
      .eq("organization_id", organizationId),
  ]);

  // Checklists : on ne garde que le fait / total par carte, plus le lien
  // checklist → carte dont le temps réel a besoin.
  const checklistStats = new Map<string, { done: number; total: number }>();
  const checklistOwners: Record<string, string> = {};
  for (const checklist of checklists ?? []) {
    checklistOwners[checklist.id] = checklist.card_id;
    const stat = checklistStats.get(checklist.card_id) ?? { done: 0, total: 0 };
    for (const item of checklist.checklist_items ?? []) {
      stat.total += 1;
      if (item.is_done) stat.done += 1;
    }
    checklistStats.set(checklist.card_id, stat);
  }

  const commentCount = new Map<string, number>();
  for (const comment of comments ?? []) {
    commentCount.set(comment.card_id, (commentCount.get(comment.card_id) ?? 0) + 1);
  }

  const cartes: BoardCard[] = (cards ?? []).map((card) => ({
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
    checklistDone: checklistStats.get(card.id)?.done ?? 0,
    checklistTotal: checklistStats.get(card.id)?.total ?? 0,
    commentCount: commentCount.get(card.id) ?? 0,
  }));

  return {
    board: {
      id: board.id,
      organizationId: board.organization_id,
      name: board.name,
      description: board.description,
      color: board.color,
      isArchived: board.is_archived,
    },
    lists: lists ?? [],
    cards: cartes,
    labels: labels ?? [],
    members: (memberships ?? []).map((m) => ({
      id: m.user_id,
      name: m.profiles?.full_name || m.profiles?.email || "—",
      email: m.profiles?.email ?? "",
    })),
    checklistOwners,
    canDelete,
  };
}
