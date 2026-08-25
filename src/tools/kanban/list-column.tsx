"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, GripVertical, MoreHorizontal, Pencil } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { CardItem } from "./card-item";
import { Composer } from "./composers";
import type { BoardCard, BoardLabel, BoardList, BoardMember } from "./types";

function ColonneBrute({
  list,
  cards,
  labels,
  members,
  dragDisabled = false,
  onRename,
  onArchive,
  onAddCard,
}: {
  list: BoardList;
  cards: BoardCard[];
  labels: BoardLabel[];
  members: BoardMember[];
  /** Une recherche filtre l'affichage : déplacer n'aurait plus de sens. */
  dragDisabled?: boolean;
  onRename: (name: string) => void;
  onArchive: () => void;
  onAddCard: (title: string) => Promise<boolean>;
}) {
  const [edition, setEdition] = useState(false);
  const [nom, setNom] = useState(list.name);
  const champ = useRef<HTMLInputElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: list.id, data: { type: "list" }, disabled: dragDisabled });

  // Zone de dépôt pour les listes vides et le bas de colonne.
  const { setNodeRef: setDropRef } = useDroppable({
    id: `dropzone:${list.id}`,
    data: { type: "listDropzone", listId: list.id },
  });

  useEffect(() => {
    if (edition) champ.current?.select();
  }, [edition]);

  // On sème le champ à l'ouverture plutôt que de le synchroniser depuis les
  // props : le nom affiché vient de `list.name`, donc une mise à jour venue
  // d'ailleurs (temps réel, chantier 5) n'a rien à recopier ici.
  const ouvrirEdition = () => {
    setNom(list.name);
    setEdition(true);
  };

  const valider = () => {
    const propre = nom.trim();
    setEdition(false);
    if (propre && propre !== list.name) onRename(propre);
    else setNom(list.name);
  };

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={`Liste ${list.name}`}
      className={cn(
        "bg-surface-1 border-line flex max-h-full w-[272px] shrink-0 flex-col rounded-lg border",
        isDragging && "opacity-40",
      )}
    >
      <header className="flex items-center gap-1 px-2 py-2">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-grab rounded-sm p-1 focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
          aria-label={`Déplacer la liste ${list.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>

        {edition ? (
          <input
            ref={champ}
            value={nom}
            onChange={(event) => setNom(event.target.value)}
            onBlur={valider}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                valider();
              }
              if (event.key === "Escape") {
                setNom(list.name);
                setEdition(false);
              }
            }}
            maxLength={80}
            aria-label="Nom de la liste"
            className="border-input bg-surface-2 focus-visible:border-ring focus-visible:ring-ring/50 min-w-0 flex-1 rounded-md border px-2 py-1 text-sm font-medium outline-none focus-visible:ring-3"
          />
        ) : (
          <button
            type="button"
            onClick={ouvrirEdition}
            className="hover:bg-surface-2 focus-visible:ring-ring min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {list.name}
          </button>
        )}

        <span className="text-muted-foreground shrink-0 font-mono text-xs">
          {cards.length}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 shrink-0 p-0"
              aria-label={`Menu de la liste ${list.name}`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={ouvrirEdition}>
              <Pencil aria-hidden="true" />
              Renommer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchive}>
              <Archive aria-hidden="true" />
              Archiver la liste
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div ref={setDropRef} className="min-h-2 flex-1 overflow-y-auto px-2">
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2 pb-2">
            {cards.map((card) => (
              <CardItem
                key={card.id}
                card={card}
                labels={labels}
                members={members}
                disabled={dragDisabled}
              />
            ))}
          </ul>
        </SortableContext>
      </div>

      <div className="p-2 pt-0">
        <Composer
          label="Ajouter une carte"
          placeholder="Titre de la carte"
          submitLabel="Ajouter"
          onSubmit={onAddCard}
        />
      </div>
    </section>
  );
}

/** Une colonne ne se re-rend que si ses propres cartes changent. */
export const ListColumn = memo(ColonneBrute);
