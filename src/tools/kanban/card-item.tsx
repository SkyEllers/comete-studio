"use client";

import { useSortable } from "@dnd-kit/sortable";
import { memo } from "react";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft, CalendarDays, CheckSquare, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";

import { colorHex } from "./palette";
import type { BoardCard, BoardLabel, BoardMember } from "./types";

const jourMois = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
});

function initiales(nom: string) {
  const morceaux = nom.split(/[\s@._-]+/).filter(Boolean);
  return ((morceaux[0]?.[0] ?? "?") + (morceaux[1]?.[0] ?? "")).toUpperCase();
}

/** Aujourd'hui à minuit : une échéance du jour n'est pas encore dépassée. */
function estDepassee(dueDate: string) {
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  return new Date(`${dueDate}T00:00:00`) < aujourdhui;
}

function CarteBrute({
  card,
  labels,
  members,
  dragging = false,
}: {
  card: BoardCard;
  labels: BoardLabel[];
  members: BoardMember[];
  dragging?: boolean;
}) {
  const etiquettes = labels.filter((l) => card.labelIds.includes(l.id));
  const assignes = members.filter((m) => card.assigneeIds.includes(m.id));
  const enRetard = card.dueDate && !card.isCompleted && estDepassee(card.dueDate);

  return (
    <div
      className={cn(
        "border-line bg-surface-2 overflow-hidden rounded-md border text-left shadow-sm",
        dragging && "rotate-2 shadow-lg",
      )}
    >
      {card.coverColor ? (
        <div
          aria-hidden="true"
          className="h-8"
          style={{ backgroundColor: colorHex(card.coverColor) }}
        />
      ) : null}

      <div className="space-y-2 p-2.5">
        {etiquettes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {etiquettes.map((label) => (
              <span
                key={label.id}
                title={label.name || undefined}
                className="h-1.5 w-8 rounded-full"
                style={{ backgroundColor: colorHex(label.color) }}
              />
            ))}
          </div>
        ) : null}

        <p className="text-sm leading-snug">{card.title}</p>

        {card.dueDate ||
        card.description ||
        card.checklistTotal > 0 ||
        card.commentCount > 0 ||
        assignes.length > 0 ? (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {card.dueDate ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono",
                  card.isCompleted && "bg-success/15 text-success",
                  enRetard && "bg-danger/15 text-danger",
                )}
              >
                <CalendarDays aria-hidden="true" className="size-3.5" />
                {jourMois.format(new Date(`${card.dueDate}T00:00:00`))}
              </span>
            ) : null}

            {card.description ? (
              <AlignLeft
                aria-label="Cette carte a une description"
                className="size-3.5"
              />
            ) : null}

            {card.checklistTotal > 0 ? (
              <span className="inline-flex items-center gap-1 font-mono">
                <CheckSquare aria-hidden="true" className="size-3.5" />
                {card.checklistDone}/{card.checklistTotal}
              </span>
            ) : null}

            {card.commentCount > 0 ? (
              <span className="inline-flex items-center gap-1 font-mono">
                <MessageSquare aria-hidden="true" className="size-3.5" />
                {card.commentCount}
              </span>
            ) : null}

            {assignes.length > 0 ? (
              <span className="ml-auto flex -space-x-1.5">
                {assignes.slice(0, 3).map((membre) => (
                  <span
                    key={membre.id}
                    title={membre.name}
                    className="border-surface-2 bg-surface-1 flex size-5 items-center justify-center rounded-full border text-[0.55rem] font-medium"
                  >
                    {initiales(membre.name)}
                  </span>
                ))}
                {assignes.length > 3 ? (
                  <span className="border-surface-2 bg-surface-1 flex size-5 items-center justify-center rounded-full border text-[0.55rem]">
                    +{assignes.length - 3}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Mémoïsées : sur un tableau chargé, un déplacement ne doit re-rendre que la
 * carte concernée. Le réducteur ne remplace que les objets modifiés, donc la
 * comparaison par identité suffit.
 */
export const CardFace = memo(CarteBrute);

function ItemBrut({
  card,
  labels,
  members,
  disabled = false,
}: {
  card: BoardCard;
  labels: BoardLabel[];
  members: BoardMember[];
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.id,
      data: { type: "card", listId: card.listId },
      disabled,
    });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-none", isDragging && "opacity-40")}
    >
      <button
        type="button"
        className="focus-visible:ring-ring block w-full cursor-grab rounded-md focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <CardFace card={card} labels={labels} members={members} />
      </button>
    </li>
  );
}

export const CardItem = memo(ItemBrut);
