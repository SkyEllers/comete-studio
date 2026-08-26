"use client";

import { Folder, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { deleteFolder, renameFolder } from "./actions";
import { compteFichiers, tailleLisible } from "./format";
import type { FolderSummary } from "./types";

export function FolderTile({
  folder,
  orgSlug,
}: {
  folder: FolderSummary;
  orgSlug: string;
}) {
  const [renommage, setRenommage] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [nom, setNom] = useState(folder.name);
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const renommer = (event: React.FormEvent) => {
    event.preventDefault();
    setErreur(null);

    startTransition(async () => {
      const result = await renameFolder(orgSlug, folder.id, nom);
      if (!result.ok) {
        setErreur(result.error);
        return;
      }
      setRenommage(false);
      toast.success("Dossier renommé");
      router.refresh();
    });
  };

  const supprimer = () =>
    startTransition(async () => {
      const result = await deleteFolder(orgSlug, folder.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSuppression(false);
      setConfirmation("");
      toast.success(`« ${folder.name} » supprimé`);
      router.refresh();
    });

  return (
    <div className="group border-line bg-surface-1 hover:bg-surface-2 relative rounded-lg border transition-colors">
      <Link
        href={`/app/${orgSlug}/fichiers/${folder.id}`}
        prefetch
        className="focus-visible:ring-ring block p-5 focus-visible:ring-2 focus-visible:outline-none"
      >
        <Folder
          aria-hidden="true"
          className="text-ember size-5 shrink-0"
          strokeWidth={1.75}
        />

        <p className="font-display mt-4 truncate pr-8 font-semibold">
          {folder.name}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {compteFichiers(folder.fileCount)}
          {folder.fileCount > 0 ? ` · ${tailleLisible(folder.totalBytes)}` : ""}
        </p>
        <p className="text-muted-foreground mt-3 font-mono text-xs">
          Modifié {folder.updatedLabel}
        </p>
      </Link>

      <div className="absolute top-4 right-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100 data-[state=open]:opacity-100"
              disabled={pending}
              aria-label={`Menu du dossier ${folder.name}`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setNom(folder.name);
                setRenommage(true);
              }}
            >
              <Pencil aria-hidden="true" />
              Renommer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={(event) => {
                // Le menu se referme sur la sélection : sans ça, il emporterait
                // la fenêtre de confirmation avec lui.
                event.preventDefault();
                setSuppression(true);
              }}
            >
              <Trash2 aria-hidden="true" />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={renommage}
        onOpenChange={(valeur) => {
          setRenommage(valeur);
          if (!valeur) setErreur(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renommer le dossier</DialogTitle>
          </DialogHeader>

          <form onSubmit={renommer} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={`renommer-${folder.id}`}>Nom du dossier</Label>
              <Input
                id={`renommer-${folder.id}`}
                value={nom}
                onChange={(event) => setNom(event.target.value)}
                required
                autoFocus
                maxLength={80}
                autoComplete="off"
                aria-invalid={Boolean(erreur)}
              />
              {erreur ? (
                <p role="alert" className="text-danger text-sm">
                  {erreur}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Enregistrement…" : "Renommer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={suppression}
        onOpenChange={(valeur) => {
          setSuppression(valeur);
          if (!valeur) setConfirmation("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer {folder.name} ?</AlertDialogTitle>
            <AlertDialogDescription>
              {folder.fileCount === 0
                ? "Ce dossier est vide. Sa suppression est définitive."
                : `Ses ${folder.fileCount} fichier${folder.fileCount > 1 ? "s" : ""} disparaissent avec lui, sans retour possible. Saisis le nom du dossier pour confirmer.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {folder.fileCount > 0 ? (
            <div className="space-y-2">
              <Label htmlFor={`confirmation-${folder.id}`}>
                Saisis <span className="font-mono">{folder.name}</span>
              </Label>
              <Input
                id={`confirmation-${folder.id}`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                pending ||
                (folder.fileCount > 0 && confirmation.trim() !== folder.name)
              }
              onClick={supprimer}
            >
              {pending ? "Suppression…" : "Supprimer définitivement"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
