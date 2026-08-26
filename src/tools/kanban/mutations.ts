import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";

import { tracer } from "./card-mutations";
import { marquerEcriture } from "./echo";

import { PAS_POSITION } from "./positions";
import { BOARD_COLORS, DEFAULT_BOARD_COLOR, type BoardColor } from "./palette";
import type { BoardCard, BoardList } from "./types";

/**
 * Écritures du kanban, côté navigateur.
 *
 * C'est l'exception prévue par CLAUDE.md §7 : l'outil est collaboratif et
 * temps réel, il écrit donc via supabase-js et c'est la RLS qui protège. Les
 * entrées sont quand même validées avant d'atteindre la base.
 */

const LISTES_PAR_DEFAUT = ["À faire", "En cours", "Terminé"];

const nom80 = z
  .string({ error: "Donne un nom." })
  .trim()
  .min(1, { error: "Donne un nom." })
  .max(80, { error: "Le nom ne peut pas dépasser 80 caractères." });

const titre200 = z
  .string({ error: "Donne un titre à cette carte." })
  .trim()
  .min(1, { error: "Donne un titre à cette carte." })
  .max(200, { error: "Le titre ne peut pas dépasser 200 caractères." });

const couleur = z.enum(BOARD_COLORS, { error: "Cette couleur n'existe pas." });
const identifiant = z.uuid({ error: "Élément introuvable." });

// --------------------------------- Tableaux ---------------------------------

const creationTableau = z.object({
  organizationId: identifiant,
  name: nom80,
  color: couleur,
  createdBy: identifiant,
});

export async function createBoard(input: {
  organizationId: string;
  name: string;
  color: BoardColor;
  createdBy: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = creationTableau.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();

  // Nouveau tableau = dernière position + un pas.
  const { data: dernier } = await supabase
    .from("boards")
    .select("position")
    .eq("organization_id", parsed.data.organizationId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: board, error } = await supabase
    .from("boards")
    .insert({
      organization_id: parsed.data.organizationId,
      name: parsed.data.name,
      color: parsed.data.color,
      position: (dernier?.position ?? 0) + PAS_POSITION,
      created_by: parsed.data.createdBy,
    })
    .select("id")
    .single();

  if (error || !board) {
    return fail("Impossible de créer ce tableau pour le moment.");
  }

  // Trois listes pour démarrer : on les renomme ou on les supprime ensuite.
  const { error: erreurListes } = await supabase.from("lists").insert(
    LISTES_PAR_DEFAUT.map((name, index) => ({
      board_id: board.id,
      name,
      position: (index + 1) * PAS_POSITION,
    })),
  );

  if (erreurListes) {
    return fail(
      "Le tableau est créé, mais ses trois listes n'ont pas pu l'être. Tu peux les ajouter à la main.",
    );
  }

  return ok({ id: board.id });
}

const majTableau = z.object({
  boardId: identifiant,
  name: nom80.optional(),
  color: couleur.optional(),
  description: z.string().trim().max(500).optional(),
});

export async function updateBoard(input: {
  boardId: string;
  name?: string;
  color?: BoardColor;
  description?: string;
}): Promise<ActionResult> {
  const parsed = majTableau.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const { boardId, ...champs } = parsed.data;
  const supabase = createClient();
  marquerEcriture("boards", boardId);

  const { error } = await supabase
    .from("boards")
    .update({
      ...(champs.name !== undefined ? { name: champs.name } : {}),
      ...(champs.color !== undefined ? { color: champs.color } : {}),
      ...(champs.description !== undefined
        ? { description: champs.description }
        : {}),
    })
    .eq("id", boardId);

  if (error) return fail("Impossible de modifier ce tableau pour le moment.");
  return ok();
}

async function basculerArchive(
  boardId: string,
  isArchived: boolean,
): Promise<ActionResult> {
  if (!identifiant.safeParse(boardId).success) return fail("Tableau introuvable.");

  const supabase = createClient();
  marquerEcriture("boards", boardId);

  const { error } = await supabase
    .from("boards")
    .update({ is_archived: isArchived })
    .eq("id", boardId);

  if (error) {
    return fail(
      isArchived
        ? "Impossible d'archiver ce tableau pour le moment."
        : "Impossible de restaurer ce tableau pour le moment.",
    );
  }

  return ok();
}

/** Archiver ne supprime rien : le tableau part dans la section archivée. */
export const archiveBoard = (boardId: string) => basculerArchive(boardId, true);
export const restoreBoard = (boardId: string) => basculerArchive(boardId, false);

/** Réservé au rôle owner et à Louis — c'est la RLS qui tranche. */
export async function deleteBoard(boardId: string): Promise<ActionResult> {
  if (!identifiant.safeParse(boardId).success) return fail("Tableau introuvable.");

  const supabase = createClient();
  marquerEcriture("boards", boardId);

  const { data, error } = await supabase
    .from("boards")
    .delete()
    .eq("id", boardId)
    .select("id");

  if (error) return fail("Impossible de supprimer ce tableau pour le moment.");
  if (!data || data.length === 0) {
    return fail("Seul un responsable du client peut supprimer un tableau.");
  }
  return ok();
}

// ---------------------------------- Listes ----------------------------------

export async function createList(input: {
  boardId: string;
  name: string;
  position: number;
}): Promise<ActionResult<BoardList>> {
  const parsed = z
    .object({ boardId: identifiant, name: nom80, position: z.number() })
    .safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("lists")
    .insert({
      board_id: parsed.data.boardId,
      name: parsed.data.name,
      position: parsed.data.position,
    })
    .select("id, name, position")
    .single();

  if (error || !data) return fail("Impossible d'ajouter cette liste.");
  return ok(data);
}

export async function renameList(
  listId: string,
  name: string,
): Promise<ActionResult> {
  const parsed = z.object({ listId: identifiant, name: nom80 }).safeParse({ listId, name });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  marquerEcriture("lists", parsed.data.listId);

  const { error } = await supabase
    .from("lists")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.listId);

  if (error) return fail("Impossible de renommer cette liste.");
  return ok();
}

/**
 * Archiver une liste l'emmène avec ses cartes, sans y toucher : elles restent
 * `is_archived = false`, simplement rattachées à une liste qui n'est plus
 * chargée (`getBoardData` écarte les cartes des listes archivées).
 *
 * C'est ce qui rend la restauration exacte : la liste revient telle qu'elle
 * était, et une carte archivée à la main avant l'archivage de sa liste, elle,
 * reste dans les archives.
 */
async function basculerArchiveListe(
  listId: string,
  isArchived: boolean,
): Promise<ActionResult> {
  if (!identifiant.safeParse(listId).success) return fail("Liste introuvable.");

  const supabase = createClient();
  marquerEcriture("lists", listId);

  const { error } = await supabase
    .from("lists")
    .update({ is_archived: isArchived })
    .eq("id", listId);

  if (error) {
    return fail(
      isArchived
        ? "Impossible d'archiver cette liste."
        : "Impossible de restaurer cette liste.",
    );
  }
  return ok();
}

export const archiveList = (listId: string) => basculerArchiveListe(listId, true);
export const restoreList = (listId: string) => basculerArchiveListe(listId, false);

/** Suppression définitive : la liste emporte ses cartes (cascade en base). */
export async function deleteList(listId: string): Promise<ActionResult> {
  if (!identifiant.safeParse(listId).success) return fail("Liste introuvable.");

  const supabase = createClient();
  marquerEcriture("lists", listId);

  const { data, error } = await supabase
    .from("lists")
    .delete()
    .eq("id", listId)
    .select("id");

  if (error) return fail("Impossible de supprimer cette liste.");
  if (!data || data.length === 0) return fail("Cette liste n'existe plus.");
  return ok();
}

export async function moveList(
  listId: string,
  position: number,
): Promise<ActionResult> {
  const parsed = z
    .object({ listId: identifiant, position: z.number() })
    .safeParse({ listId, position });
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  marquerEcriture("lists", parsed.data.listId);

  const { error } = await supabase
    .from("lists")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.listId);

  if (error) return fail("Impossible de déplacer cette liste.");
  return ok();
}

// ---------------------------------- Cartes ----------------------------------

export async function createCard(input: {
  boardId: string;
  listId: string;
  title: string;
  position: number;
  createdBy: string;
}): Promise<ActionResult<BoardCard>> {
  const parsed = z
    .object({
      boardId: identifiant,
      listId: identifiant,
      title: titre200,
      position: z.number(),
      createdBy: identifiant,
    })
    .safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("cards")
    .insert({
      board_id: parsed.data.boardId,
      list_id: parsed.data.listId,
      title: parsed.data.title,
      position: parsed.data.position,
      created_by: parsed.data.createdBy,
    })
    .select(
      "id, list_id, title, description, position, due_date, is_completed, cover_color",
    )
    .single();

  if (error || !data) return fail("Impossible d'ajouter cette carte.");

  await tracer(data.id, parsed.data.boardId, parsed.data.createdBy, "card.created");

  return ok({
    id: data.id,
    listId: data.list_id,
    title: data.title,
    description: data.description,
    position: data.position,
    dueDate: data.due_date,
    isCompleted: data.is_completed,
    coverColor: data.cover_color,
    labelIds: [],
    assigneeIds: [],
    checklistDone: 0,
    checklistTotal: 0,
    commentCount: 0,
  });
}

export async function renameCard(
  cardId: string,
  title: string,
): Promise<ActionResult> {
  const parsed = z
    .object({ cardId: identifiant, title: titre200 })
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

export async function archiveCard(cardId: string): Promise<ActionResult> {
  if (!identifiant.safeParse(cardId).success) return fail("Carte introuvable.");

  const supabase = createClient();
  marquerEcriture("cards", cardId);

  const { error } = await supabase
    .from("cards")
    .update({ is_archived: true })
    .eq("id", cardId);

  if (error) return fail("Impossible d'archiver cette carte.");
  return ok();
}

/**
 * Déplacement d'une carte. Une seule écriture, plus une trace d'activité quand
 * la carte a changé de liste — c'est ce qui alimentera le journal de la fiche.
 */
export async function moveCard(input: {
  cardId: string;
  boardId: string;
  listId: string;
  position: number;
  userId: string;
  fromListName?: string;
  toListName?: string;
}): Promise<ActionResult> {
  const parsed = z
    .object({
      cardId: identifiant,
      boardId: identifiant,
      listId: identifiant,
      position: z.number(),
      userId: identifiant,
      fromListName: z.string().optional(),
      toListName: z.string().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const supabase = createClient();
  marquerEcriture("cards", parsed.data.cardId);

  const { error } = await supabase
    .from("cards")
    .update({ list_id: parsed.data.listId, position: parsed.data.position })
    .eq("id", parsed.data.cardId);

  if (error) return fail("Impossible de déplacer cette carte.");

  if (
    parsed.data.fromListName &&
    parsed.data.toListName &&
    parsed.data.fromListName !== parsed.data.toListName
  ) {
    await tracer(
      parsed.data.cardId,
      parsed.data.boardId,
      parsed.data.userId,
      "card.moved",
      {
        from_list: parsed.data.fromListName,
        to_list: parsed.data.toListName,
      },
    );
  }

  return ok();
}

export { DEFAULT_BOARD_COLOR };
