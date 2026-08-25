import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";

import { BOARD_COLORS, DEFAULT_BOARD_COLOR, type BoardColor } from "./palette";

/**
 * Écritures du kanban, côté navigateur.
 *
 * C'est l'exception prévue par CLAUDE.md §7 : l'outil est collaboratif et
 * temps réel, il écrit donc via supabase-js et c'est la RLS qui protège. Les
 * entrées sont quand même validées avant d'atteindre la base.
 */

/** Écart entre deux positions voisines : laisse la place aux insertions. */
export const PAS_POSITION = 1024;

const LISTES_PAR_DEFAUT = ["À faire", "En cours", "Terminé"];

const nomTableau = z
  .string({ error: "Donne un nom à ce tableau." })
  .trim()
  .min(1, { error: "Donne un nom à ce tableau." })
  .max(80, { error: "Le nom ne peut pas dépasser 80 caractères." });

const couleur = z.enum(BOARD_COLORS, { error: "Cette couleur n'existe pas." });

const creationSchema = z.object({
  organizationId: z.uuid({ error: "Client introuvable." }),
  name: nomTableau,
  color: couleur,
  createdBy: z.uuid({ error: "Compte introuvable." }),
});

export async function createBoard(input: {
  organizationId: string;
  name: string;
  color: BoardColor;
  createdBy: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = creationSchema.safeParse(input);
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

const majSchema = z.object({
  boardId: z.uuid({ error: "Tableau introuvable." }),
  name: nomTableau.optional(),
  color: couleur.optional(),
  description: z.string().trim().max(500).optional(),
});

export async function updateBoard(input: {
  boardId: string;
  name?: string;
  color?: BoardColor;
  description?: string;
}): Promise<ActionResult> {
  const parsed = majSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const { boardId, ...champs } = parsed.data;
  const supabase = createClient();

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
  const parsed = z.uuid({ error: "Tableau introuvable." }).safeParse(boardId);
  if (!parsed.success) return fail("Tableau introuvable.");

  const supabase = createClient();
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

export { DEFAULT_BOARD_COLOR };
