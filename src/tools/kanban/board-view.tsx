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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

import { refreshBoard, renormalizeBoardLists, renormalizeList } from "./actions";
import { annoncesDnd, INSTRUCTIONS_DND, type Depot } from "./annonces";
import { ArchivesDialog } from "./archives-dialog";
import { BoardHeader } from "./board-header";
import { CardFace } from "./card-item";
import { CardPanel } from "./card-panel";
import { Composer } from "./composers";
import {
  carteRetenue,
  FILTRES_VIDES,
  nombreFiltres,
  preparer,
  type Filtres,
} from "./filters";
import { ListColumn } from "./list-column";
import { archiveCardById, deleteCard } from "./card-mutations";
import {
  archiveBoard,
  archiveList,
  createCard,
  createList,
  deleteBoard,
  deleteList,
  moveCard,
  moveList,
  renameList,
  updateBoard,
} from "./mutations";
import type { BoardColor } from "./palette";
import { PAS_POSITION, ecartTropPetit, positionEntre } from "./positions";
import { cardsOfList, useBoardStore } from "./store";
import type { BoardCard, BoardData } from "./types";
import { useBoardRealtime } from "./use-board-realtime";

/** Liste visée par un survol, quel que soit l'élément survolé. */
function listeSurvolee(over: Over | null): string | null {
  const data = over?.data.current;
  if (!over) return null;
  if (data?.type === "card") return String(data.listId);
  if (data?.type === "listDropzone") return String(data.listId);
  if (data?.type === "list") return String(over.id);
  return null;
}

/** Un champ de saisie a la main : les raccourcis d'une lettre s'effacent. */
function dansUnChamp(cible: EventTarget | null) {
  const element = cible as HTMLElement | null;
  if (!element) return false;

  const balise = element.tagName;
  return (
    balise === "INPUT" ||
    balise === "TEXTAREA" ||
    balise === "SELECT" ||
    element.isContentEditable
  );
}

export function BoardView({
  initial,
  orgSlug,
  userId,
  initialCardId = null,
}: {
  initial: BoardData;
  orgSlug: string;
  userId: string;
  /** Carte à ouvrir au chargement, venue de `?card=` (validée côté serveur). */
  initialCardId?: string | null;
}) {
  const [state, dispatch] = useBoardStore(initial);
  const [carteEnMain, setCarteEnMain] = useState<string | null>(null);
  const [listeEnMain, setListeEnMain] = useState<string | null>(null);
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES);
  const [carteOuverte, setCarteOuverte] = useState<string | null>(initialCardId);
  const [archivesOuvertes, setArchivesOuvertes] = useState(false);
  // Incrémenté quand quelqu'un d'autre touche la carte ouverte : la fiche
  // recharge alors son fil (commentaires, checklists, activité).
  const [filVersion, setFilVersion] = useState(0);
  // Le raccourci « n » vise une colonne : ce compteur ouvre son composeur.
  const [composeurCible, setComposeurCible] = useState<{
    listId: string;
    n: number;
  } | null>(null);
  /*
   * Une seule fenêtre de confirmation pour tout le tableau, pilotée par ces
   * deux états : la poser dans chaque carte en monterait deux cents.
   */
  const [suppressionCarte, setSuppressionCarte] = useState<{
    id: string;
    titre: string;
  } | null>(null);
  const [suppressionListe, setSuppressionListe] = useState<{
    id: string;
    nom: string;
    cartes: number;
  } | null>(null);
  const origine = useRef<string | null>(null);
  const champRecherche = useRef<HTMLInputElement>(null);
  const router = useRouter();

  /*
   * Dernier état connu, hors du flux de rendu.
   *
   * Les rappels passés aux colonnes doivent garder la même identité d'un rendu
   * à l'autre, sinon la mémoïsation par liste ne sert à rien : ils lisent donc
   * l'état ici plutôt que dans leur fermeture.
   */
  const etat = useRef(state);
  const ouverte = useRef(carteOuverte);
  useEffect(() => {
    etat.current = state;
    ouverte.current = carteOuverte;
  });

  /**
   * Rechargement complet, demandé par le canal temps réel après une
   * reconnexion. `board/reset` remplace l'état d'un bloc : rien à réconcilier.
   */
  const resynchroniser = useCallback(async () => {
    const result = await refreshBoard(orgSlug, initial.board.id);
    if (!result.ok) {
      toast.error(result.error);
      router.push(`/app/${orgSlug}/kanban`);
      return;
    }
    dispatch({ type: "board/reset", data: result.data });
  }, [dispatch, initial.board.id, orgSlug, router]);

  const fermerCarte = useCallback(() => {
    setCarteOuverte(null);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const tempsReel = useBoardRealtime({
    boardId: initial.board.id,
    dispatch,
    carteDeChecklist: (checklistId) => state.checklistOwners[checklistId],
    carteConnue: (cardId) => state.cards.some((c) => c.id === cardId),
    listeConnue: (listId) => state.lists.some((l) => l.id === listId),
    onCarteTouchee: (cardId) => {
      if (cardId === carteOuverte) setFilVersion((v) => v + 1);
    },
    onCartePartie: (cardId) => {
      // La fiche ouverte ne peut pas se contenter de disparaître : on la
      // ferme en disant pourquoi.
      if (cardId !== carteOuverte) return;
      fermerCarte();
      toast.info("Cette carte vient de quitter le tableau.");
    },
    onResync: () => void resynchroniser(),
    onTableauParti: (raison) => {
      toast.info(
        raison === "archive"
          ? `« ${state.board.name} » vient d'être archivé.`
          : `« ${state.board.name} » vient d'être supprimé.`,
      );
      router.push(`/app/${orgSlug}/kanban`);
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    // Espace saisit et dépose, Échap annule : Entrée reste libre pour ouvrir
    // la fiche de la carte au clavier.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  // --------------------------------- filtres ---------------------------------

  const nbFiltres = nombreFiltres(filtres);
  const filtrage = nbFiltres > 0;

  /*
   * Cartes par liste, filtrées. Le résultat est un objet neuf à chaque
   * changement de cartes ou de filtres ; c'est `ListColumn` qui compare sa
   * propre série carte par carte et décide de se re-rendre ou non.
   */
  const parListe = useMemo(() => {
    const criteres = preparer(filtres);
    const groupes: Record<string, BoardCard[]> = {};
    for (const liste of state.lists) groupes[liste.id] = [];

    // `state.cards` est déjà trié par position : l'ordre se conserve seul.
    for (const card of state.cards) {
      const groupe = groupes[card.listId];
      if (groupe && carteRetenue(card, criteres)) groupe.push(card);
    }

    return groupes;
  }, [state.lists, state.cards, filtres]);

  // ------------------------------ glisser-déposer -----------------------------

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
    return {
      listId,
      position: positionEntre(avant, apres),
      avant,
      apres,
      rang: index + 1,
      total: voisines.length + 1,
    };
  };

  /** Ce que la région `aria-live` annonce : la liste d'arrivée et le rang. */
  const depot = (cardId: string, over: Over | null): Depot => {
    const place = cible(cardId, over);
    if (!place) return null;

    const liste = state.lists.find((l) => l.id === place.listId);
    if (!liste) return null;

    return { liste: liste.name, rang: place.rang, total: place.total };
  };

  const annonces = annoncesDnd(() => state, depot);

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
    const data = state;
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

      const ids = data.lists.map((l) => l.id);
      const reordonnees = arrayMove(
        data.lists,
        ids.indexOf(listId),
        ids.indexOf(overListId),
      );
      const voisines = reordonnees.filter((l) => l.id !== listId);
      const place = reordonnees.findIndex((l) => l.id === listId);
      const avant = voisines[place - 1]?.position;
      const apres = voisines[place]?.position;
      const position = positionEntre(avant, apres);

      const precedente = data.lists.find((l) => l.id === listId)?.position;
      dispatch({ type: "list/patched", id: listId, patch: { position } });

      const result = await moveList(listId, position);
      if (!result.ok) {
        if (precedente !== undefined) {
          dispatch({
            type: "list/patched",
            id: listId,
            patch: { position: precedente },
          });
        }
        toast.error(result.error);
        return;
      }

      if (ecartTropPetit(avant, apres)) {
        const renum = await renormalizeBoardLists(data.board.id);
        if (renum.ok) dispatch({ type: "lists/repositioned", positions: renum.data });
      }
      return;
    }

    // ----- déplacement d'une carte -----
    const cardId = String(active.id);
    const carte = data.cards.find((c) => c.id === cardId);
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
      boardId: data.board.id,
      listId: destination.listId,
      position: destination.position,
      userId,
      fromListName: data.lists.find((l) => l.id === departId)?.name,
      toListName: data.lists.find((l) => l.id === destination.listId)?.name,
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

  const ajouterCarte = useCallback(
    async (listId: string, title: string) => {
      const data = etat.current;
      const cartes = cardsOfList(data, listId);
      const position = (cartes.at(-1)?.position ?? 0) + PAS_POSITION;

      const result = await createCard({
        boardId: data.board.id,
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
    },
    [dispatch, userId],
  );

  const ajouterListe = useCallback(
    async (name: string) => {
      const data = etat.current;
      const position = (data.lists.at(-1)?.position ?? 0) + PAS_POSITION;
      const result = await createList({ boardId: data.board.id, name, position });

      if (!result.ok) {
        toast.error(result.error);
        return false;
      }

      dispatch({ type: "list/added", list: result.data });
      return true;
    },
    [dispatch],
  );

  const renommerListe = useCallback(
    async (listId: string, name: string) => {
      const avant = etat.current.lists.find((l) => l.id === listId)?.name;
      dispatch({ type: "list/patched", id: listId, patch: { name } });

      const result = await renameList(listId, name);
      if (!result.ok) {
        if (avant) {
          dispatch({ type: "list/patched", id: listId, patch: { name: avant } });
        }
        toast.error(result.error);
      }
    },
    [dispatch],
  );

  const archiverListe = useCallback(
    async (listId: string) => {
      const liste = etat.current.lists.find((l) => l.id === listId);
      dispatch({ type: "list/removed", id: listId });

      const result = await archiveList(listId);
      if (!result.ok) {
        // La liste a déjà disparu de l'écran : seule une relecture complète la
        // ramène avec ses cartes, que le store ne porte plus.
        toast.error(result.error);
        void resynchroniser();
        return;
      }
      toast.success(`« ${liste?.name} » archivée`);
    },
    [dispatch, resynchroniser],
  );

  // ------------------------- archivage et suppression -------------------------

  const archiverCarte = useCallback(
    async (cardId: string) => {
      const data = etat.current;
      const carte = data.cards.find((c) => c.id === cardId);
      if (!carte) return;

      dispatch({ type: "card/removed", id: cardId });
      if (ouverte.current === cardId) fermerCarte();

      const result = await archiveCardById({
        cardId,
        boardId: data.board.id,
        userId,
      });

      if (!result.ok) {
        toast.error(result.error);
        void resynchroniser();
        return;
      }
      toast.success(`« ${carte.title} » archivée`);
    },
    [dispatch, fermerCarte, resynchroniser, userId],
  );

  const supprimerCarte = useCallback(
    async (cardId: string) => {
      setSuppressionCarte(null);
      dispatch({ type: "card/removed", id: cardId });
      if (ouverte.current === cardId) fermerCarte();

      const result = await deleteCard(cardId);
      if (!result.ok) {
        toast.error(result.error);
        void resynchroniser();
        return;
      }
      toast.success("Carte supprimée");
    },
    [dispatch, fermerCarte, resynchroniser],
  );

  /**
   * Une carte nue part sans qu'on demande : il n'y a rien à perdre, et une
   * fenêtre de plus à chaque ménage rendrait le geste pénible. Dès qu'elle
   * porte du texte, des commentaires ou une checklist, on demande.
   */
  const demanderSuppressionCarte = useCallback(
    (cardId: string) => {
      const carte = etat.current.cards.find((c) => c.id === cardId);
      if (!carte) return;

      const aDuContenu =
        carte.description.trim().length > 0 ||
        carte.commentCount > 0 ||
        carte.checklistTotal > 0;

      if (aDuContenu) {
        setSuppressionCarte({ id: cardId, titre: carte.title });
        return;
      }
      void supprimerCarte(cardId);
    },
    [supprimerCarte],
  );

  const supprimerListe = useCallback(
    async (listId: string) => {
      setSuppressionListe(null);
      dispatch({ type: "list/removed", id: listId });

      const result = await deleteList(listId);
      if (!result.ok) {
        toast.error(result.error);
        void resynchroniser();
        return;
      }
      toast.success("Liste supprimée");
    },
    [dispatch, resynchroniser],
  );

  /** Une liste vide part sans qu'on demande ; avec des cartes, on demande. */
  const demanderSuppressionListe = useCallback(
    (listId: string) => {
      const data = etat.current;
      const liste = data.lists.find((l) => l.id === listId);
      if (!liste) return;

      const cartes = data.cards.filter((c) => c.listId === listId).length;
      if (cartes > 0) {
        setSuppressionListe({ id: listId, nom: liste.name, cartes });
        return;
      }
      void supprimerListe(listId);
    },
    [supprimerListe],
  );

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

  /**
   * L'URL suit la fiche ouverte sans navigation : `replaceState` garde le lien
   * partageable (« Copier le lien ») sans rejouer la page ni vider le store.
   */
  const ouvrirCarte = useCallback((cardId: string) => {
    setCarteOuverte(cardId);
    window.history.replaceState(null, "", `?card=${cardId}`);
  }, []);

  // -------------------------------- raccourcis --------------------------------

  /*
   * `n` ouvre le composeur de la première liste, `f` va au champ de recherche.
   * Rien pendant qu'une fiche ou les archives sont ouvertes : les fenêtres
   * modales ont la main, et Échap les referme d'elles-mêmes — comme les
   * composeurs, les menus et les popovers. Ne reste ici que la recherche, que
   * personne d'autre ne ferme.
   */
  useEffect(() => {
    if (carteOuverte || archivesOuvertes) return;

    const surTouche = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (dansUnChamp(event.target)) {
        if (event.key === "Escape" && event.target === champRecherche.current) {
          setFiltres((actuels) => ({ ...actuels, texte: "" }));
          champRecherche.current?.blur();
        }
        return;
      }

      if (event.key === "f") {
        event.preventDefault();
        champRecherche.current?.focus();
        champRecherche.current?.select();
        return;
      }

      if (event.key === "n") {
        const premiere = etat.current.lists[0];
        if (!premiere) return;
        event.preventDefault();
        setComposeurCible((cible) => ({
          listId: premiere.id,
          n: (cible?.n ?? 0) + 1,
        }));
      }
    };

    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [carteOuverte, archivesOuvertes]);

  // ----------------------------------- rendu -----------------------------------

  const carteEnFiche = state.cards.find((c) => c.id === carteOuverte);
  const carteAffichee = state.cards.find((c) => c.id === carteEnMain);
  const listeAffichee = state.lists.find((l) => l.id === listeEnMain);
  const enDeplacement = Boolean(carteEnMain || listeEnMain);

  return (
    // La vue vit dans le <main> de la coquille : 3,5rem de barre haute et
    // 4rem de marges verticales à retrancher pour occuper le reste de l'écran.
    <div className="flex h-[calc(100svh-7.5rem)] min-h-96 flex-col">
      <BoardHeader
        board={state.board}
        labels={state.labels}
        members={state.members}
        orgSlug={orgSlug}
        canDelete={state.canDelete}
        tempsReel={tempsReel}
        filtres={filtres}
        champRecherche={champRecherche}
        onFiltres={setFiltres}
        onRename={renommerTableau}
        onColor={changerCouleur}
        onArchives={() => setArchivesOuvertes(true)}
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
        accessibility={{
          announcements: annonces,
          screenReaderInstructions: INSTRUCTIONS_DND,
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div
          className={cn(
            // Sur mobile, une colonne par écran : le défilement s'aligne sur
            // elles. Pendant un déplacement, l'aimant lutterait contre le
            // défilement automatique de dnd-kit.
            "flex flex-1 items-start gap-3 overflow-x-auto p-4 max-sm:snap-x max-sm:snap-mandatory sm:p-6",
            enDeplacement && "snap-none",
          )}
        >
          <SortableContext
            items={state.lists.map((l) => l.id)}
            strategy={horizontalListSortingStrategy}
          >
            {state.lists.map((list) => (
              <ListColumn
                key={list.id}
                list={list}
                cards={parListe[list.id] ?? []}
                labels={state.labels}
                members={state.members}
                dragDisabled={filtrage}
                signalComposeur={
                  composeurCible?.listId === list.id ? composeurCible.n : 0
                }
                onRename={renommerListe}
                onArchive={archiverListe}
                onDelete={demanderSuppressionListe}
                onAddCard={ajouterCarte}
                onOpenCard={ouvrirCarte}
                onArchiveCard={archiverCarte}
                onDeleteCard={demanderSuppressionCarte}
              />
            ))}
          </SortableContext>

          <div className="bg-surface-1 border-line w-[85vw] max-w-[272px] shrink-0 snap-center rounded-lg border p-2">
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

      {carteEnFiche ? (
        <CardPanel
          key={carteEnFiche.id}
          card={carteEnFiche}
          version={filVersion}
          lists={state.lists}
          labels={state.labels}
          members={state.members}
          cardsOfTargetList={(listId) =>
            cardsOfList(state, listId).at(-1)?.position ?? 0
          }
          boardId={state.board.id}
          userId={userId}
          dispatch={dispatch}
          onDelete={demanderSuppressionCarte}
          onClose={fermerCarte}
        />
      ) : null}

      <AlertDialog
        open={suppressionCarte !== null}
        onOpenChange={(ouvert) => !ouvert && setSuppressionCarte(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer « {suppressionCarte?.titre} » ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Sa description, ses commentaires et ses checklists partent avec
              elle, sans retour possible. Pour la retrouver plus tard, archive-la
              plutôt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                suppressionCarte && void supprimerCarte(suppressionCarte.id)
              }
            >
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={suppressionListe !== null}
        onOpenChange={(ouvert) => !ouvert && setSuppressionListe(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer « {suppressionListe?.nom} » ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {suppressionListe?.cartes === 1
                ? "Sa carte part avec elle, sans retour possible. Pour la retrouver plus tard, archive la liste plutôt."
                : `Ses ${suppressionListe?.cartes} cartes partent avec elle, sans retour possible. Pour les retrouver plus tard, archive la liste plutôt.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                suppressionListe && void supprimerListe(suppressionListe.id)
              }
            >
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ArchivesDialog
        boardId={state.board.id}
        ouvert={archivesOuvertes}
        onOpenChange={setArchivesOuvertes}
        onResync={() => void resynchroniser()}
      />
    </div>
  );
}
