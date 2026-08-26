"use client";

import { Archive, MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { archiveBoard, deleteBoard } from "./mutations";
import { colorHex } from "./palette";

export type BoardCardProps = {
  id: string;
  name: string;
  color: string;
  cardCount: number;
  updatedLabel: string;
  orgSlug: string;
  /** Supprimer définitivement un tableau : responsable du client, ou Louis. */
  canDelete: boolean;
};

export function BoardCard({
  id,
  name,
  color,
  cardCount,
  updatedLabel,
  orgSlug,
  canDelete,
}: BoardCardProps) {
  const [pending, startTransition] = useTransition();
  const [confirmation, setConfirmation] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const router = useRouter();

  const archiver = () =>
    startTransition(async () => {
      const result = await archiveBoard(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`« ${name} » archivé`);
      router.refresh();
    });

  const supprimer = () =>
    startTransition(async () => {
      const result = await deleteBoard(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOuvert(false);
      setConfirmation("");
      toast.success(`« ${name} » supprimé`);
      router.refresh();
    });

  return (
    <div className="group border-line bg-surface-1 hover:bg-surface-2 relative overflow-hidden rounded-lg border transition-colors">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: colorHex(color) }}
      />

      <Link
        href={`/app/${orgSlug}/kanban/${id}`}
        prefetch
        className="focus-visible:ring-ring block p-5 pt-6 focus-visible:ring-2 focus-visible:outline-none"
      >
        <p className="font-display truncate pr-8 font-semibold">{name}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {cardCount === 0
            ? "Aucune carte"
            : `${cardCount} carte${cardCount > 1 ? "s" : ""}`}
        </p>
        <p className="text-muted-foreground mt-3 font-mono text-xs">
          Modifié {updatedLabel}
        </p>
      </Link>

      <div className="absolute top-4 right-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              disabled={pending}
              aria-label={`Menu du tableau ${name}`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={archiver}>
              <Archive aria-hidden="true" />
              Archiver
            </DropdownMenuItem>
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={(event) => {
                    // Le menu se referme sur la sélection : sans ça, il
                    // emporterait la fenêtre de confirmation avec lui.
                    event.preventDefault();
                    setOuvert(true);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Supprimer définitivement
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog
        open={ouvert}
        onOpenChange={(valeur) => {
          setOuvert(valeur);
          if (!valeur) setConfirmation("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer {name} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ses listes, ses cartes et leurs commentaires disparaissent, sans
              retour possible. Saisis le nom du tableau pour confirmer.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`confirmation-${id}`}>
              Saisis <span className="font-mono">{name}</span>
            </Label>
            <Input
              id={`confirmation-${id}`}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={confirmation.trim() !== name || pending}
              onClick={supprimer}
            >
              Supprimer définitivement
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
