"use server";

import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { renumerote } from "./positions";

/**
 * Renumérotation des positions.
 *
 * Insérer entre deux éléments prend le milieu ; au bout d'une cinquantaine
 * d'insertions au même endroit, l'écart devient trop petit pour un flottant.
 * On repart alors sur 1024, 2048, 3072…
 *
 * Côté serveur parce que ça réécrit toute une série d'un coup : le navigateur
 * n'a pas à porter cette rafale. La RLS s'applique quand même — le client
 * utilisé est celui de la session, pas la clé secrète.
 */

const identifiant = z.uuid({ error: "Élément introuvable." });

export async function renormalizeList(
  listId: string,
): Promise<ActionResult<Record<string, number>>> {
  await requireUser();
  if (!identifiant.safeParse(listId).success) return fail("Liste introuvable.");

  const supabase = await createClient();
  const { data: cards } = await supabase
    .from("cards")
    .select("id")
    .eq("list_id", listId)
    .eq("is_archived", false)
    .order("position");

  if (!cards || cards.length === 0) return ok({});

  const positions = renumerote(cards.map((c) => c.id));

  for (const [id, position] of Object.entries(positions)) {
    const { error } = await supabase.from("cards").update({ position }).eq("id", id);
    if (error) return fail("La renumérotation des cartes a échoué.");
  }

  return ok(positions);
}

export async function renormalizeBoardLists(
  boardId: string,
): Promise<ActionResult<Record<string, number>>> {
  await requireUser();
  if (!identifiant.safeParse(boardId).success) return fail("Tableau introuvable.");

  const supabase = await createClient();
  const { data: lists } = await supabase
    .from("lists")
    .select("id")
    .eq("board_id", boardId)
    .eq("is_archived", false)
    .order("position");

  if (!lists || lists.length === 0) return ok({});

  const positions = renumerote(lists.map((l) => l.id));

  for (const [id, position] of Object.entries(positions)) {
    const { error } = await supabase.from("lists").update({ position }).eq("id", id);
    if (error) return fail("La renumérotation des listes a échoué.");
  }

  return ok(positions);
}
