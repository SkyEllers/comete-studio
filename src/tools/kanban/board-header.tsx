"use client";

import { Archive, ArrowLeft, MoreHorizontal, Palette, Pencil, Search, Trash2 } from "lucide-react";
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

import { initiales } from "./initials";
import { BOARD_COLORS, PALETTE, colorHex, type BoardColor } from "./palette";
import type { BoardMember, BoardSelf } from "./types";

export function BoardHeader({
  board,
  members,
  orgSlug,
  canDelete,
  recherche,
  onRecherche,
  onRename,
  onColor,
  onArchive,
  onDelete,
}: {
  board: BoardSelf;
  members: BoardMember[];
  orgSlug: string;
  canDelete: boolean;
  recherche: string;
  onRecherche: (valeur: string) => void;
  onRename: (name: string) => void;
  onColor: (color: BoardColor) => void;
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
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2"
          />
          <Input
            value={recherche}
            onChange={(event) => onRecherche(event.target.value)}
            placeholder="Rechercher"
            aria-label="Rechercher dans les cartes"
            className="w-40 pl-7 sm:w-52"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Menu du tableau">
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
