"use client";

import { useReducer } from "react";

import type { BoardCard, BoardData, BoardLabel, BoardList } from "./types";

/**
 * État d'un tableau ouvert.
 *
 * Un seul réducteur pour trois sources : les gestes de l'utilisateur, le retour
 * des écritures, et — à partir du chantier 5 — les événements temps réel des
 * autres personnes. Toutes les actions sont donc formulées comme des faits
 * (« une carte a bougé »), jamais comme des intentions.
 */
export type BoardAction =
  | { type: "board/reset"; data: BoardData }
  | { type: "board/patched"; patch: Partial<BoardData["board"]> }
  | { type: "list/added"; list: BoardList }
  | { type: "list/patched"; id: string; patch: Partial<BoardList> }
  | { type: "list/removed"; id: string }
  | { type: "lists/repositioned"; positions: Record<string, number> }
  | { type: "card/added"; card: BoardCard }
  | { type: "card/patched"; id: string; patch: Partial<BoardCard> }
  | { type: "card/removed"; id: string }
  | { type: "cards/repositioned"; positions: Record<string, number> }
  | {
      type: "card/moved";
      id: string;
      listId: string;
      position: number;
    }
  | { type: "label/added"; label: BoardLabel }
  | { type: "label/patched"; id: string; patch: Partial<BoardLabel> }
  | { type: "label/removed"; id: string }
  | { type: "card/labelToggled"; cardId: string; labelId: string; actif: boolean }
  | { type: "card/assigneeToggled"; cardId: string; userId: string; actif: boolean }
  | { type: "card/commentDelta"; cardId: string; delta: number }
  | { type: "checklist/registered"; checklistId: string; cardId: string }
  | {
      type: "checklistItem/changed";
      checklistId: string;
      deltaDone: number;
      deltaTotal: number;
    };

const parPosition = <T extends { position: number }>(a: T, b: T) =>
  a.position - b.position;

export function boardReducer(state: BoardData, action: BoardAction): BoardData {
  switch (action.type) {
    case "board/reset":
      return action.data;

    case "board/patched":
      return { ...state, board: { ...state.board, ...action.patch } };

    case "list/added":
      return state.lists.some((l) => l.id === action.list.id)
        ? state
        : { ...state, lists: [...state.lists, action.list].sort(parPosition) };

    case "list/patched":
      return {
        ...state,
        lists: state.lists
          .map((l) => (l.id === action.id ? { ...l, ...action.patch } : l))
          .sort(parPosition),
      };

    case "list/removed":
      return {
        ...state,
        lists: state.lists.filter((l) => l.id !== action.id),
        cards: state.cards.filter((c) => c.listId !== action.id),
      };

    case "lists/repositioned":
      return {
        ...state,
        lists: state.lists
          .map((l) =>
            action.positions[l.id] === undefined
              ? l
              : { ...l, position: action.positions[l.id] },
          )
          .sort(parPosition),
      };

    case "card/added":
      return state.cards.some((c) => c.id === action.card.id)
        ? state
        : { ...state, cards: [...state.cards, action.card].sort(parPosition) };

    case "card/patched":
      return {
        ...state,
        cards: state.cards
          .map((c) => (c.id === action.id ? { ...c, ...action.patch } : c))
          .sort(parPosition),
      };

    case "card/removed":
      return { ...state, cards: state.cards.filter((c) => c.id !== action.id) };

    case "cards/repositioned":
      return {
        ...state,
        cards: state.cards
          .map((c) =>
            action.positions[c.id] === undefined
              ? c
              : { ...c, position: action.positions[c.id] },
          )
          .sort(parPosition),
      };

    case "card/moved":
      return {
        ...state,
        cards: state.cards
          .map((c) =>
            c.id === action.id
              ? { ...c, listId: action.listId, position: action.position }
              : c,
          )
          .sort(parPosition),
      };

    case "label/added":
      return state.labels.some((l) => l.id === action.label.id)
        ? state
        : { ...state, labels: [...state.labels, action.label] };

    case "label/patched":
      return {
        ...state,
        labels: state.labels.map((l) =>
          l.id === action.id ? { ...l, ...action.patch } : l,
        ),
      };

    case "label/removed":
      return {
        ...state,
        labels: state.labels.filter((l) => l.id !== action.id),
        cards: state.cards.map((c) =>
          c.labelIds.includes(action.id)
            ? { ...c, labelIds: c.labelIds.filter((id) => id !== action.id) }
            : c,
        ),
      };

    // ------------------------- venu du temps réel -------------------------

    case "card/labelToggled":
      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.id !== action.cardId) return c;
          const present = c.labelIds.includes(action.labelId);
          if (present === action.actif) return c;
          return {
            ...c,
            labelIds: action.actif
              ? [...c.labelIds, action.labelId]
              : c.labelIds.filter((id) => id !== action.labelId),
          };
        }),
      };

    case "card/assigneeToggled":
      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.id !== action.cardId) return c;
          const present = c.assigneeIds.includes(action.userId);
          if (present === action.actif) return c;
          return {
            ...c,
            assigneeIds: action.actif
              ? [...c.assigneeIds, action.userId]
              : c.assigneeIds.filter((id) => id !== action.userId),
          };
        }),
      };

    case "card/commentDelta":
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.cardId
            ? { ...c, commentCount: Math.max(0, c.commentCount + action.delta) }
            : c,
        ),
      };

    case "checklist/registered":
      return state.checklistOwners[action.checklistId] === action.cardId
        ? state
        : {
            ...state,
            checklistOwners: {
              ...state.checklistOwners,
              [action.checklistId]: action.cardId,
            },
          };

    /**
     * Un item de checklist ne dit pas à quelle carte il appartient : on passe
     * par `checklistOwners`. Une checklist créée à l'instant par quelqu'un
     * d'autre y est déjà, son événement arrive avant celui de ses items.
     */
    case "checklistItem/changed": {
      const cardId = state.checklistOwners[action.checklistId];
      if (!cardId) return state;

      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                checklistDone: Math.max(0, c.checklistDone + action.deltaDone),
                checklistTotal: Math.max(0, c.checklistTotal + action.deltaTotal),
              }
            : c,
        ),
      };
    }

    default:
      return state;
  }
}

export function useBoardStore(initial: BoardData) {
  return useReducer(boardReducer, initial);
}

/** Cartes d'une liste, dans l'ordre. */
export function cardsOfList(state: BoardData, listId: string): BoardCard[] {
  return state.cards.filter((c) => c.listId === listId).sort(parPosition);
}
