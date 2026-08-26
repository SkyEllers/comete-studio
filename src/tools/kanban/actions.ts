"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { renumerote } from "./positions";
import { getBoardData } from "./queries";
import type { BoardData } from "./types";

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

/**
 * Fait tomber la liste des tableaux du cache de navigation.
 *
 * Créer, renommer, archiver, restaurer ou supprimer un tableau se fait depuis
 * le navigateur (RLS) : le serveur n'en sait rien, et la liste — rendue côté
 * serveur — reste servie depuis le cache client au retour, jusqu'à un F5.
 *
 * `revalidatePath` dans une Server Action est ce qui vide ce cache : c'est le
 * seul mécanisme qui traverse la frontière, et il vaut pour toutes les façons
 * de revenir — lien, bouton précédent du navigateur, redirection.
 *
 * Appelée depuis les mutations elles-mêmes plutôt que depuis leurs appelants :
 * une mutation qui change la liste ne peut pas oublier de la périmer.
 */
export async function invalidateBoardList(): Promise<void> {
  await requireUser();
  revalidatePath("/app/[orgSlug]/kanban", "page");
}

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

/**
 * Rechargement complet d'un tableau, après une reconnexion du canal temps réel.
 *
 * Pendant une coupure, les événements ne sont envoyés à personne : au retour,
 * seul un état frais garantit qu'on regarde la même chose que les autres.
 *
 * Les mêmes gardes que la page : l'organisation est relue à travers la RLS, et
 * si l'outil a été coupé ou l'accès retiré entre-temps, la lecture ne renvoie
 * rien et l'action échoue proprement.
 */
export async function refreshBoard(
  orgSlug: string,
  boardId: string,
): Promise<ActionResult<BoardData>> {
  if (!identifiant.safeParse(boardId).success) return fail("Tableau introuvable.");

  const access = await getMembership(orgSlug);
  if (!access) return fail("Cet espace n'est plus accessible.");

  const data = await getBoardData(
    access.org.id,
    boardId,
    access.role === "owner" || access.role === "admin",
  );

  if (!data) return fail("Ce tableau n'est plus accessible.");
  return ok(data);
}
