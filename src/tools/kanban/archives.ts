import { fail, ok, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";

/**
 * Ce que le tableau ne charge pas : ses archives.
 *
 * Lecture à la demande, à l'ouverture de la vue — un tableau vivant n'a pas à
 * transporter ce qu'on en a retiré. La RLS s'applique comme partout ailleurs.
 */

export type CarteArchivee = {
  id: string;
  title: string;
  listName: string;
  /** Sa liste est archivée aussi : la restaurer ne la ramènerait nulle part. */
  listArchived: boolean;
};

export type ListeArchivee = {
  id: string;
  name: string;
  /** Cartes qui reviendront avec elle. */
  cardCount: number;
};

export type Archives = { cards: CarteArchivee[]; lists: ListeArchivee[] };

export async function loadArchives(
  boardId: string,
): Promise<ActionResult<Archives>> {
  const supabase = createClient();

  const [listes, cartes] = await Promise.all([
    supabase
      .from("lists")
      .select("id, name, cards (id)")
      .eq("board_id", boardId)
      .eq("is_archived", true)
      .eq("cards.is_archived", false)
      .order("position"),
    supabase
      .from("cards")
      .select("id, title, lists (name, is_archived)")
      .eq("board_id", boardId)
      .eq("is_archived", true)
      .order("position"),
  ]);

  if (listes.error || cartes.error) {
    return fail("Impossible de charger les archives.");
  }

  return ok({
    lists: (listes.data ?? []).map((liste) => ({
      id: liste.id,
      name: liste.name,
      cardCount: (liste.cards ?? []).length,
    })),
    cards: (cartes.data ?? []).map((carte) => ({
      id: carte.id,
      title: carte.title,
      listName: carte.lists?.name ?? "—",
      listArchived: carte.lists?.is_archived ?? false,
    })),
  });
}
