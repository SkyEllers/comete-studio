"use client";

import { useReducer } from "react";

import type { BoardCard, BoardData, BoardList } from "./types";

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
