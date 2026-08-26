import type { Announcements, Over, ScreenReaderInstructions } from "@dnd-kit/core";

import type { BoardData } from "./types";

/**
 * Ce que dnd-kit annonce dans sa région `aria-live`.
 *
 * Au clavier, rien ne bouge à l'écran pour qui n'y voit pas : ces phrases sont
 * la seule façon de savoir où la carte a atterri. On dit donc la liste
 * d'arrivée *et* le rang, pas seulement « déplacée ».
 */
export const INSTRUCTIONS_DND: ScreenReaderInstructions = {
  draggable:
    "Appuie sur Espace pour saisir cet élément, puis sur les flèches pour le déplacer. Espace le dépose, Échap annule.",
};

/** Où l'élément se poserait s'il était lâché maintenant. */
export type Depot = { liste: string; rang: number; total: number } | null;

/** « carte « Relancer Peggy » » — au féminin, carte comme liste. */
function nomElement(data: BoardData, id: string): string {
  const carte = data.cards.find((c) => c.id === id);
  if (carte) return `carte « ${carte.title} »`;

  const liste = data.lists.find((l) => l.id === id);
  if (liste) return `liste « ${liste.name} »`;

  return "élément";
}

function nomSurvole(data: BoardData, over: Over | null): string | null {
  if (!over) return null;

  const type = over.data.current?.type;
  const listId =
    type === "card" || type === "listDropzone"
      ? String(over.data.current?.listId)
      : String(over.id);

  const liste = data.lists.find((l) => l.id === listId);
  return liste ? `liste « ${liste.name} »` : null;
}

export function annoncesDnd(
  etat: () => BoardData,
  depot: (activeId: string, over: Over | null) => Depot,
): Announcements {
  const situation = (activeId: string, over: Over | null) => {
    const place = depot(activeId, over);
    if (place) {
      return `la liste « ${place.liste} », en position ${place.rang} sur ${place.total}`;
    }

    const survole = nomSurvole(etat(), over);
    return survole ? `la ${survole}` : null;
  };

  return {
    onDragStart: ({ active }) =>
      `La ${nomElement(etat(), String(active.id))} est saisie.`,

    onDragOver: ({ active, over }) => {
      const ou = situation(String(active.id), over);
      const nom = nomElement(etat(), String(active.id));
      return ou ? `La ${nom} est sur ${ou}.` : `La ${nom} est hors de toute liste.`;
    },

    onDragEnd: ({ active, over }) => {
      const nom = nomElement(etat(), String(active.id));
      if (!over) return `La ${nom} est revenue à sa place.`;

      const ou = situation(String(active.id), over);
      return ou ? `La ${nom} est déposée dans ${ou}.` : `La ${nom} est déposée.`;
    },

    onDragCancel: ({ active }) =>
      `Le déplacement de la ${nomElement(etat(), String(active.id))} est annulé.`,
  };
}
