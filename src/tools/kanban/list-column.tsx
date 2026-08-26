"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, GripVertical, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  signalComposeur = 0,
  autoRenommer = false,
  onRename,
  onArchive,
  onDelete,
  onAddCard,
  onOpenCard,
  onArchiveCard,
  onDeleteCard,
}: {
  list: BoardList;
  cards: BoardCard[];
  labels: BoardLabel[];
  members: BoardMember[];
  /** Un filtre masque des cartes : déplacer n'aurait plus de sens. */
  dragDisabled?: boolean;
  /** Le raccourci « n » vise cette colonne : on ouvre son composeur. */
  signalComposeur?: number;
  /**
   * Liste qui vient de naître par le bouton « + Liste » : son champ s'ouvre
   * dès le montage, nom sélectionné, pour qu'on la nomme sans un clic de plus.
   * L'état initial suffit — la colonne est neuve.
   */
  autoRenommer?: boolean;
  /*
   * Rappels sans fermeture sur la liste : la colonne rend son identifiant à
   * chaque appel, ce qui laisse le tableau leur donner une identité stable et
   * la mémoïsation faire son travail.
   */
  onRename: (listId: string, name: string) => void;
  onArchive: (listId: string) => void;
  onDelete: (listId: string) => void;
  onAddCard: (listId: string, title: string) => Promise<boolean>;
  onOpenCard: (cardId: string) => void;
  onArchiveCard: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
}) {
  const [edition, setEdition] = useState(autoRenommer);
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
  // d'ailleurs (temps réel) n'a rien à recopier ici.
  const ouvrirEdition = () => {
    setNom(list.name);
    setEdition(true);
  };

  const valider = () => {
    const propre = nom.trim();
    setEdition(false);
    if (propre && propre !== list.name) onRename(list.id, propre);
    else setNom(list.name);
  };

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={`Liste ${list.name}`}
      className={cn(
        "bg-surface-1 border-line flex max-h-full w-[85vw] max-w-[272px] shrink-0 snap-center flex-col rounded-lg border",
        isDragging && "opacity-40",
      )}
    >
      <header className="flex items-center gap-1 px-2 py-2">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-grab rounded-sm p-1.5 focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing sm:p-1"
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
              className="size-9 shrink-0 p-0 sm:size-7"
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
            <DropdownMenuItem onSelect={() => onArchive(list.id)}>
              <Archive aria-hidden="true" />
              Archiver la liste
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => onDelete(list.id)}
            >
              <Trash2 aria-hidden="true" />
              Supprimer définitivement
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
                onOpen={onOpenCard}
                onArchive={onArchiveCard}
                onDelete={onDeleteCard}
              />
            ))}
          </ul>
        </SortableContext>
      </div>

      <div className="p-2 pt-0">
        <Composer
          // Changer la clé remonte le composeur : c'est ainsi que le raccourci
          // « n » l'ouvre et lui donne le focus, même s'il l'était déjà.
          key={`composeur-${signalComposeur}`}
          autoOpen={signalComposeur > 0}
          label="Ajouter une carte"
          placeholder="Titre de la carte"
          submitLabel="Ajouter"
          onSubmit={(title) => onAddCard(list.id, title)}
        />
      </div>
    </section>
  );
}

type ProprietesColonne = React.ComponentProps<typeof ColonneBrute>;

/**
 * Une colonne ne se re-rend que si ses propres cartes changent.
 *
 * Le réducteur reconstruit `cards` à chaque écriture, même pour une carte
 * d'une autre liste : comparer la série carte par carte — par identité, le
 * réducteur ne remplace que les objets modifiés — est ce qui évite de
 * re-rendre les six colonnes quand une seule bouge.
 */
export const ListColumn = memo(
  ColonneBrute,
  (avant: ProprietesColonne, apres: ProprietesColonne) =>
    avant.list === apres.list &&
    avant.labels === apres.labels &&
    avant.members === apres.members &&
    avant.dragDisabled === apres.dragDisabled &&
    avant.signalComposeur === apres.signalComposeur &&
    avant.autoRenommer === apres.autoRenommer &&
    avant.onRename === apres.onRename &&
    avant.onArchive === apres.onArchive &&
    avant.onDelete === apres.onDelete &&
    avant.onAddCard === apres.onAddCard &&
    avant.onOpenCard === apres.onOpenCard &&
    avant.onArchiveCard === apres.onArchiveCard &&
    avant.onDeleteCard === apres.onDeleteCard &&
    avant.cards.length === apres.cards.length &&
    avant.cards.every((carte, index) => carte === apres.cards[index]),
);
