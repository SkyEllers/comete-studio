"use client";

import { Download, FolderInput, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

import {
  apercuDuFichier,
  deleteFiles,
  lienDeTelechargement,
  moveFile,
  renameFile,
} from "./actions";
import { IconeFichier } from "./file-icon";
import { tailleLisible } from "./format";
import { declencher } from "./telechargement";
import type { FileRow } from "./types";

/** « 2 min 04 » — une durée se lit mieux que 124 secondes. */
function duree(secondes: number): string {
  const minutes = Math.floor(secondes / 60);
  const reste = Math.round(secondes % 60);
  if (minutes === 0) return `${reste} s`;
  return `${minutes} min ${String(reste).padStart(2, "0")}`;
}

export function FilePanel({
  file,
  orgSlug,
  folderId,
  dossiers,
  onClose,
}: {
  file: FileRow;
  orgSlug: string;
  folderId: string | null;
  /** Les dossiers du client, pour le menu « Déplacer vers ». */
  dossiers: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [apercu, setApercu] = useState<{
    apercu: string | null;
    original: string | null;
  } | null>(null);
  const [edition, setEdition] = useState(false);
  const [nom, setNom] = useState(file.name);
  const [suppression, setSuppression] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Les liens signés ne durent qu'une heure : on les demande à l'ouverture,
  // jamais à l'avance pour toute une liste.
  useEffect(() => {
    let vivant = true;

    void apercuDuFichier(orgSlug, file.id).then((result) => {
      if (!vivant) return;
      setApercu(result.ok ? result.data : { apercu: null, original: null });
    });

    return () => {
      vivant = false;
    };
  }, [orgSlug, file.id]);

  const telecharger = () =>
    startTransition(async () => {
      const result = await lienDeTelechargement(orgSlug, file.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      declencher(result.data);
    });

  const renommer = (event: React.FormEvent) => {
    event.preventDefault();
    const propre = nom.trim();
    if (!propre || propre === file.name) {
      setEdition(false);
      return;
    }

    startTransition(async () => {
      const result = await renameFile(orgSlug, file.id, propre);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEdition(false);
      toast.success("Fichier renommé");
      router.refresh();
    });
  };

  const deplacer = (destination: string | null) =>
    startTransition(async () => {
      const result = await moveFile(orgSlug, file.id, destination);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        destination
          ? `Déplacé vers « ${dossiers.find((d) => d.id === destination)?.name} »`
          : "Déplacé hors dossier",
      );
      onClose();
      router.refresh();
    });

  const supprimer = () =>
    startTransition(async () => {
      const result = await deleteFiles(orgSlug, [file.id], folderId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Fichier supprimé");
      onClose();
      router.refresh();
    });

  return (
    <>
      <Dialog open onOpenChange={(ouvert) => !ouvert && onClose()}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-svh gap-0 overflow-y-auto p-0 max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-h-[88svh] sm:max-w-4xl"
        >
          <DialogTitle className="sr-only">{file.name}</DialogTitle>

          <Apercu file={file} liens={apercu} />

          <div className="space-y-5 p-4 sm:p-6">
            <header className="flex flex-wrap items-start gap-3 pr-8">
              <div className="min-w-0 flex-1">
                {edition ? (
                  <form onSubmit={renommer}>
                    <Input
                      autoFocus
                      value={nom}
                      onChange={(event) => setNom(event.target.value)}
                      onBlur={renommer}
                      maxLength={255}
                      aria-label="Nom du fichier"
                      className="font-display h-auto py-1 text-lg font-semibold"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setNom(file.name);
                      setEdition(true);
                    }}
                    className="hover:bg-surface-2 focus-visible:ring-ring font-display block w-full truncate rounded-md px-1.5 py-1 text-left text-lg font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {file.name}
                  </button>
                )}

                <p className="text-muted-foreground mt-1 px-1.5 font-mono text-xs">
                  {[
                    tailleLisible(file.sizeBytes),
                    file.width && file.height ? `${file.width} × ${file.height}` : null,
                    file.durationSeconds ? duree(file.durationSeconds) : null,
                    file.mimeType,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-muted-foreground mt-1 px-1.5 text-xs">
                  Déposé par {file.authorName} · {file.createdLabel}
                </p>
              </div>
            </header>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={telecharger} disabled={pending}>
                <Download aria-hidden="true" />
                Télécharger l&apos;original
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setNom(file.name);
                  setEdition(true);
                }}
              >
                <Pencil aria-hidden="true" />
                Renommer
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <FolderInput aria-hidden="true" />
                    Déplacer
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>Déplacer vers</DropdownMenuLabel>
                  {folderId !== null ? (
                    <DropdownMenuItem onSelect={() => deplacer(null)}>
                      Hors dossier
                    </DropdownMenuItem>
                  ) : null}
                  {dossiers
                    .filter((dossier) => dossier.id !== folderId)
                    .map((dossier) => (
                      <DropdownMenuItem
                        key={dossier.id}
                        onSelect={() => deplacer(dossier.id)}
                      >
                        {dossier.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {file.canDelete ? (
                <Button
                  variant="destructive"
                  className="ml-auto"
                  onClick={() => setSuppression(true)}
                >
                  <Trash2 aria-hidden="true" />
                  Supprimer
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={suppression} onOpenChange={setSuppression}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {file.name} » ?</AlertDialogTitle>
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

function Apercu({
  file,
  liens,
}: {
  file: FileRow;
  liens: { apercu: string | null; original: string | null } | null;
}) {
  if (liens === null) {
    return <Skeleton className="aspect-video w-full rounded-none" />;
  }

  if (file.mimeType.startsWith("image/") && liens.apercu) {
    return (
      // Une URL signée qui change à chaque ouverture : `next/image` la
      // réoptimiserait pour rien, et son domaine devrait être déclaré.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={liens.apercu}
        alt={file.name}
        className="bg-surface-2 max-h-[60svh] w-full object-contain"
      />
    );
  }

  if (file.mimeType.startsWith("video/") && liens.original) {
    return (
      <video
        src={liens.original}
        controls
        preload="metadata"
        className="bg-surface-2 max-h-[60svh] w-full"
      />
    );
  }

  if (file.mimeType.startsWith("audio/") && liens.original) {
    return (
      <div className="bg-surface-2 flex items-center justify-center p-6">
        <audio src={liens.original} controls className="w-full" />
      </div>
    );
  }

  if (file.mimeType === "application/pdf" && liens.original) {
    return (
      <iframe
        src={liens.original}
        title={file.name}
        className="bg-surface-2 h-[60svh] w-full"
      />
    );
  }

  return (
    <div className="bg-surface-2 flex aspect-video max-h-64 w-full items-center justify-center">
      <IconeFichier
        mimeType={file.mimeType}
        className="text-muted-foreground size-10"
      />
    </div>
  );
}
