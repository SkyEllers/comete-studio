"use client";

import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { deleteFiles } from "./actions";
import { aUneVignette, IconeFichier } from "./file-icon";
import { tailleLisible } from "./format";
import type { FileRow } from "./types";

/**
 * La liste des fichiers d'un dossier ou de la racine.
 *
 * Les images et les vidéos vont dans une grille — elles se reconnaissent à
 * l'œil ; le reste va en lignes, où le nom compte plus que l'aperçu. Les
 * vraies vignettes arrivent au chantier 4 ; en attendant, l'icône du type.
 */
export function FileList({
  files,
  orgSlug,
  folderId,
}: {
  files: FileRow[];
  orgSlug: string;
  folderId: string | null;
}) {
  const [selection, setSelection] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const { visuels, autres } = useMemo(
    () => ({
      visuels: files.filter((f) => aUneVignette(f.mimeType)),
      autres: files.filter((f) => !aUneVignette(f.mimeType)),
    }),
    [files],
  );

  const basculer = (id: string) =>
    setSelection((actuelle) =>
      actuelle.includes(id)
        ? actuelle.filter((autre) => autre !== id)
        : [...actuelle, id],
    );

  const selectionnes = files.filter((f) => selection.includes(f.id));
  const supprimables = selectionnes.filter((f) => f.canDelete).length;

  const supprimer = () =>
    startTransition(async () => {
      const result = await deleteFiles(orgSlug, selection, folderId);
      setConfirmation(false);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setSelection([]);
      toast.success(
        result.data.supprimes > 1
          ? `${result.data.supprimes} fichiers supprimés`
          : "Fichier supprimé",
      );
      router.refresh();
    });

  return (
    <>
      {visuels.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visuels.map((fichier) => (
            <Vignette
              key={fichier.id}
              fichier={fichier}
              choisi={selection.includes(fichier.id)}
              onChoisir={() => basculer(fichier.id)}
            />
          ))}
        </ul>
      ) : null}

      {autres.length > 0 ? (
        <ul
          className={cn(
            "border-line divide-line divide-y rounded-lg border",
            visuels.length > 0 && "mt-4",
          )}
        >
          {autres.map((fichier) => (
            <Ligne
              key={fichier.id}
              fichier={fichier}
              choisi={selection.includes(fichier.id)}
              onChoisir={() => basculer(fichier.id)}
            />
          ))}
        </ul>
      ) : null}

      {/* Barre de sélection : elle ne s'invite que quand on a choisi. */}
      {selection.length > 0 ? (
        <div
          role="status"
          className="border-line bg-surface-1 sticky bottom-4 mt-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 shadow-lg"
        >
          <p className="text-sm">
            {selection.length} fichier{selection.length > 1 ? "s" : ""}{" "}
            sélectionné{selection.length > 1 ? "s" : ""}
          </p>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelection([])}>
              <X aria-hidden="true" />
              Désélectionner
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending || supprimables === 0}
              onClick={() => setConfirmation(true)}
            >
              <Trash2 aria-hidden="true" />
              Supprimer
            </Button>
          </div>

          {supprimables < selection.length ? (
            <p className="text-muted-foreground w-full text-xs">
              {selection.length - supprimables} de ces fichiers ont été déposés
              par quelqu&apos;un d&apos;autre : seul leur auteur ou un responsable peut les
              supprimer.
            </p>
          ) : null}
        </div>
      ) : null}

      <AlertDialog open={confirmation} onOpenChange={setConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer {selection.length} fichier
              {selection.length > 1 ? "s" : ""} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette suppression est définitive : il n&apos;y a pas de corbeille.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={supprimer}>
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Vignette({
  fichier,
  choisi,
  onChoisir,
}: {
  fichier: FileRow;
  choisi: boolean;
  onChoisir: () => void;
}) {
  return (
    <li
      className={cn(
        "group border-line bg-surface-1 relative overflow-hidden rounded-lg border transition-colors",
        choisi ? "ring-ring ring-2" : "hover:bg-surface-2",
      )}
    >
      <div className="bg-surface-2 flex aspect-4/3 items-center justify-center">
        <IconeFichier
          mimeType={fichier.mimeType}
          className="text-muted-foreground size-8"
        />
      </div>

      <div className="space-y-1 p-3">
        <p className="truncate text-sm" title={fichier.name}>
          {fichier.name}
        </p>
        <p className="text-muted-foreground font-mono text-xs">
          {tailleLisible(fichier.sizeBytes)}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {fichier.authorName} · {fichier.createdLabel}
        </p>
      </div>

      <div
        className={cn(
          "absolute top-2 left-2 transition-opacity",
          choisi
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100",
        )}
      >
        <Checkbox
          checked={choisi}
          onCheckedChange={onChoisir}
          aria-label={`Sélectionner ${fichier.name}`}
          className="bg-surface-1"
        />
      </div>
    </li>
  );
}

function Ligne({
  fichier,
  choisi,
  onChoisir,
}: {
  fichier: FileRow;
  choisi: boolean;
  onChoisir: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors",
        choisi ? "bg-surface-2" : "hover:bg-surface-2",
      )}
    >
      <Checkbox
        checked={choisi}
        onCheckedChange={onChoisir}
        aria-label={`Sélectionner ${fichier.name}`}
      />

      <IconeFichier
        mimeType={fichier.mimeType}
        className="text-muted-foreground size-5 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={fichier.name}>
          {fichier.name}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {fichier.authorName} · {fichier.createdLabel}
        </p>
      </div>

      <p className="text-muted-foreground shrink-0 font-mono text-xs">
        {tailleLisible(fichier.sizeBytes)}
      </p>
    </li>
  );
}
