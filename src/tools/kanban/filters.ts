import { aujourdhuiISO, dansNJours } from "./jours";
import type { BoardCard } from "./types";

/**
 * Filtres du tableau.
 *
 * Tout se joue côté navigateur, sur les cartes déjà chargées : filtrer ne
 * déclenche aucune requête, et le temps réel continue d'alimenter le store
 * sans se soucier de ce qui est affiché.
 *
 * Entre deux critères de nature différente, c'est un ET (une étiquette *et*
 * un membre) ; à l'intérieur d'un critère, un OU (l'une *ou* l'autre de ces
 * deux étiquettes) — c'est ce qu'on attend d'un filtre de kanban.
 */
export type FiltreEcheance = "depassee" | "semaine" | "sans";
export type FiltreEtat = "terminee" | "en-cours";

export type Filtres = {
  texte: string;
  labelIds: string[];
  memberIds: string[];
  echeance: FiltreEcheance | null;
  etat: FiltreEtat | null;
};

export const FILTRES_VIDES: Filtres = {
  texte: "",
  labelIds: [],
  memberIds: [],
  echeance: null,
  etat: null,
};

export const LIBELLES_ECHEANCE: Record<FiltreEcheance, string> = {
  depassee: "Dépassée",
  semaine: "Cette semaine",
  sans: "Sans date",
};

export const LIBELLES_ETAT: Record<FiltreEtat, string> = {
  "en-cours": "En cours",
  terminee: "Terminée",
};

/** Ce que compte le badge : un critère coché = un filtre. */
export function nombreFiltres(filtres: Filtres): number {
  return (
    (filtres.texte.trim() ? 1 : 0) +
    filtres.labelIds.length +
    filtres.memberIds.length +
    (filtres.echeance ? 1 : 0) +
    (filtres.etat ? 1 : 0)
  );
}

/** Sans accents ni casse : « échéance » se trouve en tapant « echeance ». */
function normalise(valeur: string) {
  return valeur
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Filtres prêts à l'emploi : texte normalisé et bornes du jour calculés une
 * fois, pas à chaque carte. Sur deux cents cartes, la différence se voit.
 */
export type Criteres = Omit<Filtres, "texte"> & {
  texte: string;
  aujourdhui: string;
  finSemaine: string;
};

export function preparer(filtres: Filtres): Criteres {
  return {
    ...filtres,
    texte: normalise(filtres.texte.trim()),
    aujourdhui: aujourdhuiISO(),
    finSemaine: dansNJours(7),
  };
}

export function carteRetenue(card: BoardCard, criteres: Criteres): boolean {
  if (
    criteres.texte &&
    !normalise(card.title).includes(criteres.texte) &&
    !normalise(card.description).includes(criteres.texte)
  ) {
    return false;
  }

  if (
    criteres.labelIds.length > 0 &&
    !criteres.labelIds.some((id) => card.labelIds.includes(id))
  ) {
    return false;
  }

  if (
    criteres.memberIds.length > 0 &&
    !criteres.memberIds.some((id) => card.assigneeIds.includes(id))
  ) {
    return false;
  }

  if (criteres.echeance === "sans" && card.dueDate) return false;

  if (criteres.echeance === "depassee") {
    // Une carte terminée n'est plus en retard, quelle que soit sa date.
    if (
      !card.dueDate ||
      card.isCompleted ||
      card.dueDate >= criteres.aujourdhui
    ) {
      return false;
    }
  }

  if (criteres.echeance === "semaine") {
    if (
      !card.dueDate ||
      card.dueDate < criteres.aujourdhui ||
      card.dueDate > criteres.finSemaine
    ) {
      return false;
    }
  }

  if (criteres.etat === "terminee" && !card.isCompleted) return false;
  if (criteres.etat === "en-cours" && card.isCompleted) return false;

  return true;
}

/** Bascule d'un identifiant dans une liste de sélection. */
export function bascule(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((autre) => autre !== id) : [...ids, id];
}
