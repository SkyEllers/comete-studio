import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";

import { marquerEcriture } from "./echo";
import { BOARD_COLORS, type BoardColor } from "./palette";
import type { BoardLabel } from "./types";

/**
 * Écritures de la fiche carte, côté navigateur : même exception que le reste
 * du kanban (CLAUDE.md §7), la RLS protège et zod valide avant l'envoi.
 */

const identifiant = z.uuid({ error: "Élément introuvable." });
const couleur = z.enum(BOARD_COLORS, { error: "Cette couleur n'existe pas." });

export type TypeActivite =
  | "card.created"
  | "card.moved"
  | "card.completed"
  | "card.due_set"
  | "card.archived"
  | "card.commented"
  | "card.assigned"
  | "card.labeled";

/** Les valeurs d'un `payload` sont écrites en jsonb : rien d'imbriqué. */
type PayloadActivite = Record<string, string | number | boolean | null>;

/**
 * Une trace dans le journal de la carte.
 *
 * L'identifiant est tiré ici plutôt que par la base : c'est lui qui permet au
 * canal temps réel de reconnaître l'écho de notre propre écriture, y compris
 * quand le même compte est ouvert sur un autre appareil.
 */
export async function tracer(
  cardId: string,
  boardId: string,
  userId: string,
  type: TypeActivite,
  payload: PayloadActivite = {},
) {
  const supabase = createClient();
  const id = crypto.randomUUID();
  marquerEcriture("card_activities", id);

  await supabase
    .from("card_activities")
    .insert({ id, card_id: cardId, board_id: boardId, user_id: userId, type, payload });
}

// --------------------------------- La carte ---------------------------------

export async function updateCardTitle(
  cardId: string,
  title: string,
): Promise<ActionResult> {
  const parsed = z
    .object({
      cardId: identifiant,
      title: z
        .string({ error: "Donne un titre à cette carte." })
        .trim()
        .min(1, { error: "Donne un titre à cette carte." })
        .max(200, { error: "Le titre ne peut pas dépasser 200 caractères." }),
    })
    .safeParse({ cardId, title });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  marquerEcriture("cards", parsed.data.cardId);

  const { error } = await supabase
    .from("cards")
    .update({ title: parsed.data.title })
    .eq("id", parsed.data.cardId);

  if (error) return fail("Impossible de renommer cette carte.");
  return ok();
}

export async function updateCardDescription(
  cardId: string,
  description: string,
): Promise<ActionResult> {
  const parsed = z
    .object({
      cardId: identifiant,
      description: z
        .string()
        .max(20000, { error: "La description est trop longue." }),
    })
    .safeParse({ cardId, description });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  marquerEcriture("cards", parsed.data.cardId);

  const { error } = await supabase
    .from("cards")
    .update({ description: parsed.data.description })
    .eq("id", parsed.data.cardId);

  if (error) return fail("Impossible d'enregistrer la description.");
  return ok();
}

export async function toggleCardCompleted(input: {
  cardId: string;
  boardId: string;
  userId: string;
  isCompleted: boolean;
}): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("cards", input.cardId);

  const { error } = await supabase
    .from("cards")
    .update({ is_completed: input.isCompleted })
    .eq("id", input.cardId);

  if (error) return fail("Impossible de changer l'état de cette carte.");

  await tracer(input.cardId, input.boardId, input.userId, "card.completed", {
    completed: input.isCompleted,
  });
  return ok();
}

export async function setCardDueDate(input: {
  cardId: string;
  boardId: string;
  userId: string;
  /** `null` retire l'échéance. */
  dueDate: string | null;
}): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("cards", input.cardId);

  const { error } = await supabase
    .from("cards")
    .update({ due_date: input.dueDate })
    .eq("id", input.cardId);

  if (error) return fail("Impossible de changer l'échéance.");

  await tracer(input.cardId, input.boardId, input.userId, "card.due_set", {
    due_date: input.dueDate,
  });
  return ok();
}

export async function setCardCover(
  cardId: string,
  coverColor: BoardColor | null,
): Promise<ActionResult> {
  if (coverColor && !couleur.safeParse(coverColor).success) {
    return fail("Cette couleur n'existe pas.");
  }

  const supabase = createClient();
  marquerEcriture("cards", cardId);

  const { error } = await supabase
    .from("cards")
    .update({ cover_color: coverColor })
    .eq("id", cardId);

  if (error) return fail("Impossible de changer la couverture.");
  return ok();
}

export async function moveCardToList(input: {
  cardId: string;
  boardId: string;
  listId: string;
  position: number;
  userId: string;
  fromListName: string;
  toListName: string;
}): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("cards", input.cardId);

  const { error } = await supabase
    .from("cards")
    .update({ list_id: input.listId, position: input.position })
    .eq("id", input.cardId);

  if (error) return fail("Impossible de déplacer cette carte.");

  if (input.fromListName !== input.toListName) {
    await tracer(input.cardId, input.boardId, input.userId, "card.moved", {
      from_list: input.fromListName,
      to_list: input.toListName,
    });
  }
  return ok();
}

export async function archiveCardById(input: {
  cardId: string;
  boardId: string;
  userId: string;
}): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("cards", input.cardId);

  const { error } = await supabase
    .from("cards")
    .update({ is_archived: true })
    .eq("id", input.cardId);

  if (error) return fail("Impossible d'archiver cette carte.");

  await tracer(input.cardId, input.boardId, input.userId, "card.archived", {});
  return ok();
}

export async function restoreCard(cardId: string): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("cards", cardId);

  const { error } = await supabase
    .from("cards")
    .update({ is_archived: false })
    .eq("id", cardId);

  if (error) return fail("Impossible de restaurer cette carte.");
  return ok();
}

/** Suppression définitive : réservée aux propriétaires par la RLS de `boards`. */
export async function deleteCard(cardId: string): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("cards", cardId);

  const { data, error } = await supabase
    .from("cards")
    .delete()
    .eq("id", cardId)
    .select("id");

  if (error) return fail("Impossible de supprimer cette carte.");
  if (!data || data.length === 0) return fail("Cette carte n'existe plus.");
  return ok();
}

// -------------------------------- Étiquettes --------------------------------

export async function createLabel(input: {
  boardId: string;
  name: string;
  color: BoardColor;
}): Promise<ActionResult<BoardLabel>> {
  const parsed = z
    .object({
      boardId: identifiant,
      name: z.string().trim().max(40, { error: "Nom trop long." }),
      color: couleur,
    })
    .safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("labels")
    .insert({
      board_id: parsed.data.boardId,
      name: parsed.data.name,
      color: parsed.data.color,
    })
    .select("id, name, color")
    .single();

  if (error || !data) return fail("Impossible de créer cette étiquette.");
  return ok(data);
}

export async function renameLabel(
  labelId: string,
  name: string,
): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("labels", labelId);

  const { error } = await supabase
    .from("labels")
    .update({ name: name.trim().slice(0, 40) })
    .eq("id", labelId);

  if (error) return fail("Impossible de renommer cette étiquette.");
  return ok();
}

export async function toggleCardLabel(input: {
  cardId: string;
  boardId: string;
  labelId: string;
  userId: string;
  actif: boolean;
}): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("card_labels", `${input.cardId}:${input.labelId}`);

  const { error } = input.actif
    ? await supabase
        .from("card_labels")
        .insert({ card_id: input.cardId, label_id: input.labelId, board_id: input.boardId })
    : await supabase
        .from("card_labels")
        .delete()
        .eq("card_id", input.cardId)
        .eq("label_id", input.labelId);

  if (error) return fail("Impossible de changer cette étiquette.");

  await tracer(input.cardId, input.boardId, input.userId, "card.labeled", {
    label_id: input.labelId,
    actif: input.actif,
  });
  return ok();
}

// --------------------------------- Membres ----------------------------------

export async function toggleCardAssignee(input: {
  cardId: string;
  boardId: string;
  memberId: string;
  memberName: string;
  userId: string;
  actif: boolean;
}): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("card_assignees", `${input.cardId}:${input.memberId}`);

  const { error } = input.actif
    ? await supabase
        .from("card_assignees")
        .insert({ card_id: input.cardId, user_id: input.memberId, board_id: input.boardId })
    : await supabase
        .from("card_assignees")
        .delete()
        .eq("card_id", input.cardId)
        .eq("user_id", input.memberId);

  if (error) return fail("Impossible de changer cette assignation.");

  await tracer(input.cardId, input.boardId, input.userId, "card.assigned", {
    member: input.memberName,
    actif: input.actif,
  });
  return ok();
}

// -------------------------------- Checklists --------------------------------

export type ChecklistItem = {
  id: string;
  text: string;
  isDone: boolean;
  position: number;
};

export type Checklist = {
  id: string;
  title: string;
  position: number;
  items: ChecklistItem[];
};

export async function createChecklist(input: {
  cardId: string;
  boardId: string;
  title: string;
  position: number;
}): Promise<ActionResult<Checklist>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklists")
    .insert({
      card_id: input.cardId,
      board_id: input.boardId,
      title: input.title.trim() || "Checklist",
      position: input.position,
    })
    .select("id, title, position")
    .single();

  if (error || !data) return fail("Impossible d'ajouter cette checklist.");
  return ok({ ...data, items: [] });
}

export async function renameChecklist(
  checklistId: string,
  title: string,
): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("checklists", checklistId);

  const { error } = await supabase
    .from("checklists")
    .update({ title: title.trim() || "Checklist" })
    .eq("id", checklistId);

  if (error) return fail("Impossible de renommer cette checklist.");
  return ok();
}

export async function deleteChecklist(checklistId: string): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("checklists", checklistId);

  const { error } = await supabase.from("checklists").delete().eq("id", checklistId);
  if (error) return fail("Impossible de supprimer cette checklist.");
  return ok();
}

export async function createChecklistItem(input: {
  checklistId: string;
  boardId: string;
  text: string;
  position: number;
}): Promise<ActionResult<ChecklistItem>> {
  const parsed = z
    .object({
      checklistId: identifiant,
      boardId: identifiant,
      text: z
        .string({ error: "Écris quelque chose." })
        .trim()
        .min(1, { error: "Écris quelque chose." })
        .max(500, { error: "Trop long." }),
      position: z.number(),
    })
    .safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklist_items")
    .insert({
      checklist_id: parsed.data.checklistId,
      board_id: parsed.data.boardId,
      text: parsed.data.text,
      position: parsed.data.position,
    })
    .select("id, text, is_done, position")
    .single();

  if (error || !data) return fail("Impossible d'ajouter cette ligne.");
  return ok({ id: data.id, text: data.text, isDone: data.is_done, position: data.position });
}

export async function updateChecklistItem(input: {
  itemId: string;
  text?: string;
  isDone?: boolean;
}): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("checklist_items", input.itemId);

  const { error } = await supabase
    .from("checklist_items")
    .update({
      ...(input.text !== undefined ? { text: input.text.trim().slice(0, 500) } : {}),
      ...(input.isDone !== undefined ? { is_done: input.isDone } : {}),
    })
    .eq("id", input.itemId);

  if (error) return fail("Impossible de modifier cette ligne.");
  return ok();
}

export async function deleteChecklistItem(itemId: string): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("checklist_items", itemId);

  const { error } = await supabase.from("checklist_items").delete().eq("id", itemId);
  if (error) return fail("Impossible de supprimer cette ligne.");
  return ok();
}

// ------------------------------- Commentaires -------------------------------

export type Commentaire = {
  id: string;
  body: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export async function createComment(input: {
  cardId: string;
  boardId: string;
  userId: string;
  body: string;
}): Promise<ActionResult<Commentaire>> {
  const parsed = z
    .object({
      cardId: identifiant,
      boardId: identifiant,
      userId: identifiant,
      body: z
        .string({ error: "Écris quelque chose." })
        .trim()
        .min(1, { error: "Écris quelque chose." })
        .max(5000, { error: "Le commentaire ne peut pas dépasser 5000 caractères." }),
    })
    .safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();

  /*
   * Identifiant tiré avant l'insertion, pas après : l'événement temps réel
   * peut arriver avant la réponse HTTP, et c'est cette marque qui distingue
   * notre propre commentaire — déjà affiché — de celui du même compte ouvert
   * sur un autre appareil, qui doit apparaître.
   */
  const id = crypto.randomUUID();
  marquerEcriture("comments", id);

  const { data, error } = await supabase
    .from("comments")
    .insert({
      id,
      card_id: parsed.data.cardId,
      board_id: parsed.data.boardId,
      user_id: parsed.data.userId,
      body: parsed.data.body,
    })
    .select("id, body, user_id, created_at, updated_at")
    .single();

  if (error || !data) return fail("Impossible de publier ce commentaire.");

  await tracer(parsed.data.cardId, parsed.data.boardId, parsed.data.userId, "card.commented");

  return ok({
    id: data.id,
    body: data.body,
    userId: data.user_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}

export async function updateComment(
  commentId: string,
  body: string,
): Promise<ActionResult> {
  const parsed = z
    .object({
      commentId: identifiant,
      body: z.string().trim().min(1, { error: "Écris quelque chose." }).max(5000),
    })
    .safeParse({ commentId, body });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  marquerEcriture("comments", parsed.data.commentId);

  const { data, error } = await supabase
    .from("comments")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.commentId)
    .select("id");

  if (error) return fail("Impossible de modifier ce commentaire.");
  if (!data || data.length === 0) {
    return fail("Un commentaire ne se modifie que par son auteur.");
  }
  return ok();
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  const supabase = createClient();
  marquerEcriture("comments", commentId);

  const { data, error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId)
    .select("id");

  if (error) return fail("Impossible de supprimer ce commentaire.");
  if (!data || data.length === 0) {
    return fail("Un commentaire ne se supprime que par son auteur.");
  }
  return ok();
}

// ---------------------- Chargement à l'ouverture de la fiche ----------------

export type Activite = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  userId: string | null;
  createdAt: string;
};

export type FilCarte = {
  comments: Commentaire[];
  activities: Activite[];
  checklists: Checklist[];
};

/** Ce que le store ne porte pas : commentaires, activités, checklists. */
export async function loadCardThread(cardId: string): Promise<FilCarte> {
  const supabase = createClient();

  const [{ data: comments }, { data: activities }, { data: checklists }] =
    await Promise.all([
      supabase
        .from("comments")
        .select("id, body, user_id, created_at, updated_at")
        .eq("card_id", cardId)
        .order("created_at"),
      supabase
        .from("card_activities")
        .select("id, type, payload, user_id, created_at")
        .eq("card_id", cardId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("checklists")
        .select("id, title, position, checklist_items (id, text, is_done, position)")
        .eq("card_id", cardId)
        .order("position"),
    ]);

  return {
    comments: (comments ?? []).map((c) => ({
      id: c.id,
      body: c.body,
      userId: c.user_id,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
    activities: (activities ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      payload: (a.payload ?? {}) as Record<string, unknown>,
      userId: a.user_id,
      createdAt: a.created_at,
    })),
    checklists: (checklists ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      position: c.position,
      items: (c.checklist_items ?? [])
        .map((i) => ({ id: i.id, text: i.text, isDone: i.is_done, position: i.position }))
        .sort((a, b) => a.position - b.position),
    })),
  };
}
