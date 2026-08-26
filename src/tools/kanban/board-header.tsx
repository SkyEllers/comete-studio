"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Search,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { BoardFilters } from "./board-filters";
import type { Filtres } from "./filters";
import { initiales } from "./initials";
import { BOARD_COLORS, PALETTE, colorHex, type BoardColor } from "./palette";
import type { BoardLabel, BoardMember, BoardSelf } from "./types";
import type { EtatTempsReel } from "./use-board-realtime";

export function BoardHeader({
  board,
  labels,
  members,
  orgSlug,
  canDelete,
  tempsReel,
  filtres,
  champRecherche,
  onFiltres,
  onNewList,
  onRename,
  onColor,
  onArchives,
  onArchive,
  onDelete,
}: {
  board: BoardSelf;
  labels: BoardLabel[];
  members: BoardMember[];
  orgSlug: string;
  canDelete: boolean;
  tempsReel: EtatTempsReel;
  filtres: Filtres;
  /** Le raccourci « f » y pose le focus depuis le tableau. */
  champRecherche: React.RefObject<HTMLInputElement | null>;
  onFiltres: (filtres: Filtres) => void;
  /** Ajouter une liste sans avoir à défiler jusqu'au bout du tableau. */
  onNewList: () => void;
  onRename: (name: string) => void;
  onColor: (color: BoardColor) => void;
  onArchives: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [edition, setEdition] = useState(false);
  const [nom, setNom] = useState(board.name);
  const [confirmation, setConfirmation] = useState("");
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (edition) champ.current?.select();
  }, [edition]);

  // Le champ est semé à l'ouverture : le nom affiché vient de `board.name`.
  const ouvrirEdition = () => {
    setNom(board.name);
    setEdition(true);
  };

  const valider = () => {
    const propre = nom.trim();
    setEdition(false);
    if (propre && propre !== board.name) onRename(propre);
    else setNom(board.name);
  };

  return (
    <div className="border-line flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
      <Link
        href={`/app/${orgSlug}/kanban`}
        prefetch
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Tableaux
      </Link>

      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-full"
        style={{ backgroundColor: colorHex(board.color) }}
      />

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
              setNom(board.name);
              setEdition(false);
            }
          }}
          maxLength={80}
          aria-label="Nom du tableau"
          className="border-input bg-surface-2 focus-visible:border-ring focus-visible:ring-ring/50 font-display rounded-md border px-2 py-1 text-lg font-semibold outline-none focus-visible:ring-3"
        />
      ) : (
        <button
          type="button"
          onClick={ouvrirEdition}
          className="hover:bg-surface-2 focus-visible:ring-ring font-display truncate rounded-md px-2 py-1 text-lg font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {board.name}
        </button>
      )}

      {members.length > 0 ? (
        <span className="ml-1 hidden -space-x-1.5 sm:flex">
          {members.slice(0, 5).map((membre) => (
            <span
              key={membre.id}
              title={membre.name}
              className="border-void bg-surface-2 flex size-6 items-center justify-center rounded-full border text-[0.6rem] font-medium"
            >
              {initiales(membre.name)}
            </span>
          ))}
          {members.length > 5 ? (
            <span className="border-void bg-surface-2 flex size-6 items-center justify-center rounded-full border text-[0.6rem]">
              +{members.length - 5}
            </span>
          ) : null}
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <Button onClick={onNewList} className="max-sm:h-9">
          <Plus aria-hidden="true" />
          <span className="max-sm:sr-only">Liste</span>
        </Button>

        {tempsReel === "hors-ligne" ? (
          <span
            role="status"
            className="text-warning bg-warning/10 hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs sm:inline-flex"
          >
            <WifiOff aria-hidden="true" className="size-3.5" />
            Hors ligne, reconnexion…
          </span>
        ) : null}

        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2"
          />
          <Input
            ref={champRecherche}
            value={filtres.texte}
            onChange={(event) =>
              onFiltres({ ...filtres, texte: event.target.value })
            }
            placeholder="Rechercher"
            aria-label="Rechercher dans les cartes"
            className="w-36 pr-7 pl-7 sm:w-52"
          />
          {filtres.texte ? (
            <button
              type="button"
              onClick={() => onFiltres({ ...filtres, texte: "" })}
              aria-label="Effacer la recherche"
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>

        <BoardFilters
          filtres={filtres}
          labels={labels}
          members={members}
          onChange={onFiltres}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="max-sm:size-9 max-sm:p-0"
              aria-label="Menu du tableau"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={ouvrirEdition}>
              <Pencil aria-hidden="true" />
              Renommer
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 font-normal">
              <Palette aria-hidden="true" className="size-4" />
              Couleur
            </DropdownMenuLabel>
            <div className="flex flex-wrap gap-1.5 px-2 pb-2">
              {BOARD_COLORS.map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  onClick={() => onColor(valeur)}
                  aria-label={PALETTE[valeur].label}
                  title={PALETTE[valeur].label}
                  className={cn(
                    "focus-visible:ring-ring size-5 rounded focus-visible:ring-2 focus-visible:outline-none",
                    valeur === board.color && "ring-foreground ring-2",
                  )}
                  style={{ backgroundColor: PALETTE[valeur].hex }}
                />
              ))}
            </div>

            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onArchives}>
              <ArchiveRestore aria-hidden="true" />
              Archives
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchive}>
              <Archive aria-hidden="true" />
              Archiver le tableau
            </DropdownMenuItem>

            {canDelete ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem
                    onSelect={(event) => event.preventDefault()}
                    className="text-destructive"
                  >
                    <Trash2 aria-hidden="true" />
                    Supprimer le tableau
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer {board.name} ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Ses listes, ses cartes et leurs commentaires disparaissent,
                      sans retour possible. Saisis le nom du tableau pour
                      confirmer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  <div className="space-y-2">
                    <Label htmlFor="confirmation-tableau">
                      Saisis <span className="font-mono">{board.name}</span>
                    </Label>
                    <Input
                      id="confirmation-tableau"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="off"
                    />
                  </div>

                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setConfirmation("")}>
                      Annuler
                    </AlertDialogCancel>
                    <Button
                      variant="destructive"
                      disabled={confirmation.trim() !== board.name}
                      onClick={onDelete}
                    >
                      Supprimer définitivement
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
