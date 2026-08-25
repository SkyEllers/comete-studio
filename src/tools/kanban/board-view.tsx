"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Over,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { renormalizeBoardLists, renormalizeList } from "./actions";
import { BoardHeader } from "./board-header";
import { CardFace } from "./card-item";
import { Composer } from "./composers";
import { ListColumn } from "./list-column";
import {
  archiveBoard,
  archiveList,
  createCard,
  createList,
  deleteBoard,
  moveCard,
  moveList,
  renameList,
  updateBoard,
} from "./mutations";
import type { BoardColor } from "./palette";
import { PAS_POSITION, ecartTropPetit, positionEntre } from "./positions";
import { cardsOfList, useBoardStore } from "./store";
import type { BoardData } from "./types";

/** Liste visée par un survol, quel que soit l'élément survolé. */
function listeSurvolee(over: Over | null): string | null {
  const data = over?.data.current;
  if (!over) return null;
  if (data?.type === "card") return String(data.listId);
  if (data?.type === "listDropzone") return String(data.listId);
  if (data?.type === "list") return String(over.id);
  return null;
}

export function BoardView({
  initial,
  orgSlug,
  userId,
}: {
  initial: BoardData;
  orgSlug: string;
  userId: string;
}) {
  const [state, dispatch] = useBoardStore(initial);
  const [carteEnMain, setCarteEnMain] = useState<string | null>(null);
  const [listeEnMain, setListeEnMain] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const origine = useRef<string | null>(null);
  const router = useRouter();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const filtre = recherche.trim().toLowerCase();
  const correspond = (titre: string, description: string) =>
    !filtre ||
    titre.toLowerCase().includes(filtre) ||
    description.toLowerCase().includes(filtre);

  /**
   * Où la carte atterrirait si on lâchait maintenant.
   *
   * Dans la même liste, on suit l'ordre que dnd-kit vient de calculer : sans
   * ça, on ne saurait qu'insérer *avant* la carte survolée, donc jamais
   * descendre une carte ni la mettre en dernier.
   */
  const cible = (cardId: string, over: Over | null) => {
    const listId = listeSurvolee(over);
    const carte = state.cards.find((c) => c.id === cardId);
    if (!listId || !carte) return null;

    const ordonnees = cardsOfList(state, listId);
    const surCarte =
      over?.data.current?.type === "card" && String(over.id) !== cardId;

    let voisines: typeof ordonnees;
    let index: number;

    if (carte.listId === listId && surCarte) {
      const ids = ordonnees.map((c) => c.id);
      const reordonnees = arrayMove(
        ordonnees,
        ids.indexOf(cardId),
        ids.indexOf(String(over!.id)),
      );
      voisines = reordonnees.filter((c) => c.id !== cardId);
      index = reordonnees.findIndex((c) => c.id === cardId);
    } else {
      voisines = ordonnees.filter((c) => c.id !== cardId);
      index = surCarte
        ? Math.max(
            0,
            voisines.findIndex((c) => c.id === String(over!.id)),
          )
        : voisines.length;
    }

    const avant = voisines[index - 1]?.position;
    const apres = voisines[index]?.position;
    return { listId, position: positionEntre(avant, apres), avant, apres };
  };

  const onDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type;
    if (type === "list") {
      setListeEnMain(String(event.active.id));
      return;
    }
    const id = String(event.active.id);
    setCarteEnMain(id);
    origine.current = state.cards.find((c) => c.id === id)?.listId ?? null;
  };

  /**
   * Passage d'une liste à l'autre pendant le déplacement, et rien d'autre.
   *
   * Réordonner aussi *dans* une liste ici déclenche une boucle : chaque
   * dispatch change la mise en page, ce qui relance un survol, qui redispatche.
   * Le réordonnancement interne n'en a pas besoin — dnd-kit décale déjà les
   * voisines tout seul, et le dépôt tranche la position finale.
   */
  const onDragOver = (event: DragOverEvent) => {
    if (event.active.data.current?.type !== "card") return;

    const cardId = String(event.active.id);
    const carte = state.cards.find((c) => c.id === cardId);
    const listId = listeSurvolee(event.over);
    if (!carte || !listId || listId === carte.listId) return;

    const destination = cible(cardId, event.over);
    if (!destination) return;

    dispatch({
      type: "card/moved",
      id: cardId,
      listId: destination.listId,
      position: destination.position,
    });
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setCarteEnMain(null);
    setListeEnMain(null);

    if (!over) return;

    // ----- déplacement d'une liste -----
    if (active.data.current?.type === "list") {
      const listId = String(active.id);
      // On survole souvent une carte ou une zone de dépôt, pas la liste
      // elle-même : même résolution que pour les cartes.
      const overListId = listeSurvolee(over);
      if (!overListId || overListId === listId) return;

      const ids = state.lists.map((l) => l.id);
      const reordonnees = arrayMove(
        state.lists,
        ids.indexOf(listId),
        ids.indexOf(overListId),
      );
      const voisines = reordonnees.filter((l) => l.id !== listId);
      const place = reordonnees.findIndex((l) => l.id === listId);
      const avant = voisines[place - 1]?.position;
      const apres = voisines[place]?.position;
      const position = positionEntre(avant, apres);

      const precedente = state.lists.find((l) => l.id === listId)?.position;
      dispatch({ type: "list/patched", id: listId, patch: { position } });

      const result = await moveList(listId, position);
      if (!result.ok) {
        if (precedente !== undefined) {
          dispatch({ type: "list/patched", id: listId, patch: { position: precedente } });
        }
        toast.error(result.error);
        return;
      }

      if (ecartTropPetit(avant, apres)) {
        const renum = await renormalizeBoardLists(state.board.id);
        if (renum.ok) dispatch({ type: "lists/repositioned", positions: renum.data });
      }
      return;
    }

    // ----- déplacement d'une carte -----
    const cardId = String(active.id);
    const carte = state.cards.find((c) => c.id === cardId);
    if (!carte) return;

    const departId = origine.current;
    origine.current = null;

    const destination = cible(cardId, over) ?? {
      listId: carte.listId,
      position: carte.position,
      avant: undefined,
      apres: undefined,
    };

    dispatch({
      type: "card/moved",
      id: cardId,
      listId: destination.listId,
      position: destination.position,
    });

    const result = await moveCard({
      cardId,
      boardId: state.board.id,
      listId: destination.listId,
      position: destination.position,
      userId,
      fromListName: state.lists.find((l) => l.id === departId)?.name,
      toListName: state.lists.find((l) => l.id === destination.listId)?.name,
    });

    if (!result.ok) {
      // Retour à l'état d'avant : la base fait foi.
      if (departId) {
        dispatch({
          type: "card/moved",
          id: cardId,
          listId: departId,
          position: carte.position,
        });
      }
      toast.error(result.error);
      return;
    }

    if (ecartTropPetit(destination.avant, destination.apres)) {
      const renum = await renormalizeList(destination.listId);
      if (renum.ok) dispatch({ type: "cards/repositioned", positions: renum.data });
    }
  };

  // --------------------------------- écritures ---------------------------------

  const ajouterCarte = async (listId: string, title: string) => {
    const cartes = cardsOfList(state, listId);
    const position = (cartes.at(-1)?.position ?? 0) + PAS_POSITION;

    const result = await createCard({
      boardId: state.board.id,
      listId,
      title,
      position,
      createdBy: userId,
    });

    if (!result.ok) {
      toast.error(result.error);
      return false;
    }

    dispatch({ type: "card/added", card: result.data });
    return true;
  };

  const ajouterListe = async (name: string) => {
    const position = (state.lists.at(-1)?.position ?? 0) + PAS_POSITION;
    const result = await createList({ boardId: state.board.id, name, position });

    if (!result.ok) {
      toast.error(result.error);
      return false;
    }

    dispatch({ type: "list/added", list: result.data });
    return true;
  };

  const renommerListe = async (listId: string, name: string) => {
    const avant = state.lists.find((l) => l.id === listId)?.name;
    dispatch({ type: "list/patched", id: listId, patch: { name } });

    const result = await renameList(listId, name);
    if (!result.ok) {
      if (avant) dispatch({ type: "list/patched", id: listId, patch: { name: avant } });
      toast.error(result.error);
    }
  };

  const archiverListe = async (listId: string) => {
    const liste = state.lists.find((l) => l.id === listId);
    dispatch({ type: "list/removed", id: listId });

    const result = await archiveList(listId);
    if (!result.ok) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    toast.success(`« ${liste?.name} » archivée`);
  };

  const renommerTableau = async (name: string) => {
    const avant = state.board.name;
    dispatch({ type: "board/patched", patch: { name } });

    const result = await updateBoard({ boardId: state.board.id, name });
    if (!result.ok) {
      dispatch({ type: "board/patched", patch: { name: avant } });
      toast.error(result.error);
    }
  };

  const changerCouleur = async (color: BoardColor) => {
    const avant = state.board.color;
    dispatch({ type: "board/patched", patch: { color } });

    const result = await updateBoard({ boardId: state.board.id, color });
    if (!result.ok) {
      dispatch({ type: "board/patched", patch: { color: avant } });
      toast.error(result.error);
    }
  };

  const archiverTableau = async () => {
    const result = await archiveBoard(state.board.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`« ${state.board.name} » archivé`);
    router.push(`/app/${orgSlug}/kanban`);
  };

  const supprimerTableau = async () => {
    const result = await deleteBoard(state.board.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`« ${state.board.name} » supprimé`);
    router.push(`/app/${orgSlug}/kanban`);
  };

  const carteAffichee = state.cards.find((c) => c.id === carteEnMain);
  const listeAffichee = state.lists.find((l) => l.id === listeEnMain);

  return (
    // La vue vit dans le <main> de la coquille : 3,5rem de barre haute et
    // 4rem de marges verticales à retrancher pour occuper le reste de l'écran.
    <div className="flex h-[calc(100svh-7.5rem)] min-h-96 flex-col">
      <BoardHeader
        board={state.board}
        members={state.members}
        orgSlug={orgSlug}
        canDelete={state.canDelete}
        recherche={recherche}
        onRecherche={setRecherche}
        onRename={renommerTableau}
        onColor={changerCouleur}
        onArchive={archiverTableau}
        onDelete={supprimerTableau}
      />

      <DndContext
        // Identifiant fixe : sans lui, dnd-kit numérote ses `aria-describedby`
        // avec un compteur qui repart différemment côté serveur et côté
        // navigateur, et l'hydratation échoue.
        id="kanban-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex flex-1 items-start gap-3 overflow-x-auto p-4 sm:p-6">
          <SortableContext
            items={state.lists.map((l) => l.id)}
            strategy={horizontalListSortingStrategy}
          >
            {state.lists.map((list) => (
              <ListColumn
                key={list.id}
                list={list}
                cards={cardsOfList(state, list.id).filter((c) =>
                  correspond(c.title, c.description),
                )}
                labels={state.labels}
                members={state.members}
                dragDisabled={Boolean(filtre)}
                onRename={(name) => void renommerListe(list.id, name)}
                onArchive={() => void archiverListe(list.id)}
                onAddCard={(title) => ajouterCarte(list.id, title)}
              />
            ))}
          </SortableContext>

          <div className="bg-surface-1 border-line w-[272px] shrink-0 rounded-lg border p-2">
            <Composer
              label="Ajouter une liste"
              placeholder="Nom de la liste"
              submitLabel="Ajouter"
              onSubmit={ajouterListe}
            />
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {carteAffichee ? (
            <CardFace
              card={carteAffichee}
              labels={state.labels}
              members={state.members}
              dragging
            />
          ) : listeAffichee ? (
            <div className="bg-surface-1 border-line w-[272px] rotate-2 rounded-lg border px-4 py-3 shadow-lg">
              <p className="text-sm font-medium">{listeAffichee.name}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
