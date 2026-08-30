"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
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
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  archiverNote,
  deplacerNote,
  modifierNote,
  supprimerNote,
} from "@/app/app/[orgSlug]/(tools)/sas/actions";
import type { Liste, NoteSas } from "./queries";
import { LIMITE_IDEE, type Boite } from "./types";

/**
 * La vie d'une idée après sa capture.
 *
 * Quatre gestes, dans l'ordre où on s'en sert : la corriger, l'archiver quand
 * c'est fait, la déplacer si elle était mal rangée, la supprimer quand elle
 * n'a plus lieu d'être. La suppression demande confirmation parce qu'elle
 * vient d'une liste, où le doigt glisse — c'est la règle du brief.
 *
 * Les archives sont repliées en pied de liste : une idée archivée reste
 * consultable, mais elle ne doit plus encombrer ce qu'on a encore à faire.
 */

type Props = {
  orgSlug: string;
  liste: Liste;
  boites: Boite[];
  /** La place courante : elle est retirée des destinations proposées. */
  place: { type: "boite"; boxId: string } | { type: "perso" } | { type: "aranger" };
  vide: { titre: string; description: string };
};

export function ListeNotes({ orgSlug, liste, boites, place, vide }: Props) {
  const [archivesOuvertes, setArchivesOuvertes] = useState(false);

  if (liste.actives === 0 && liste.archivees.length === 0) {
    return (
      <div className="border-line bg-surface-1 rounded-lg border border-dashed px-6 py-12 text-center">
        <p className="font-display font-semibold">{vide.titre}</p>
        <p className="text-muted-foreground mt-1.5 text-sm">{vide.description}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {liste.jours.map((jour) => (
        <section key={jour.cle} className="space-y-2">
          <h2 className="text-muted-foreground font-mono text-xs tracking-wide">
            {jour.libelle}
          </h2>
          <ul className="space-y-2">
            {jour.notes.map((note) => (
              <Ligne
                key={note.id}
                note={note}
                orgSlug={orgSlug}
                boites={boites}
                place={place}
              />
            ))}
          </ul>
        </section>
      ))}

      {liste.tronquee ? (
        <p className="text-muted-foreground text-sm">
          Seules les 300 idées les plus récentes sont affichées. La recherche
          retrouve les autres.
        </p>
      ) : null}

      {liste.archivees.length > 0 ? (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setArchivesOuvertes((ouvert) => !ouvert)}
            aria-expanded={archivesOuvertes}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-1.5 rounded-sm text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn("size-4 transition-transform", archivesOuvertes && "rotate-90")}
            />
            Voir les archivées ({liste.archivees.length})
          </button>

          {archivesOuvertes ? (
            <ul className="space-y-2">
              {liste.archivees.map((note) => (
                <Ligne
                  key={note.id}
                  note={note}
                  orgSlug={orgSlug}
                  boites={boites}
                  place={place}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------- Une idée ---------------------------------

function Ligne({
  note,
  orgSlug,
  boites,
  place,
}: {
  note: NoteSas;
  orgSlug: string;
  boites: Boite[];
  place: Props["place"];
}) {
  const [edition, setEdition] = useState(false);
  const [deplacement, setDeplacement] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [texte, setTexte] = useState(note.content);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /** Toutes les mutations finissent pareil : un toast, ou un message d'erreur. */
  const agir = (
    action: () => Promise<{ ok: boolean; error?: string }>,
    succes: string,
    apres?: () => void,
  ) =>
    startTransition(async () => {
      const resultat = await action();
      if (!resultat.ok) {
        setErreur(resultat.error ?? "Ça n'a pas marché.");
        toast.error(resultat.error ?? "Ça n'a pas marché.");
        return;
      }
      apres?.();
      toast.success(succes);
      router.refresh();
    });

  const enregistrer = (event: React.FormEvent) => {
    event.preventDefault();
    setErreur(null);
    agir(() => modifierNote(orgSlug, note.id, texte), "Idée modifiée", () =>
      setEdition(false),
    );
  };

  const destinations = [
    ...(place.type === "perso"
      ? []
      : [{ cle: "perso", label: "Perso", valeur: { type: "perso" as const } }]),
    ...(place.type === "aranger"
      ? []
      : [{ cle: "aranger", label: "À ranger", valeur: { type: "aranger" as const } }]),
    ...boites
      .filter((boite) => !(place.type === "boite" && place.boxId === boite.id))
      .map((boite) => ({
        cle: boite.id,
        label: boite.name,
        valeur: { type: "boite" as const, boiteId: boite.id },
      })),
  ];

  return (
    <li
      className={cn(
        "border-line bg-surface-1 flex items-start gap-2 rounded-lg border p-3",
        note.is_archived && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className="text-muted-foreground mt-0.5 w-11 shrink-0 font-mono text-xs tabular-nums"
      >
        {note.heureLabel}
      </span>

      <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap">
        <span className="sr-only">Notée à {note.heureLabel}. </span>
        {note.content}
      </p>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label="Menu de l'idée"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setTexte(note.content);
              setErreur(null);
              setEdition(true);
            }}
          >
            <Pencil aria-hidden="true" />
            Modifier
          </DropdownMenuItem>

          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setDeplacement(true);
            }}
          >
            <FolderInput aria-hidden="true" />
            Déplacer
          </DropdownMenuItem>

          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              agir(
                () => archiverNote(orgSlug, note.id, !note.is_archived),
                note.is_archived ? "Idée restaurée" : "Idée archivée",
              );
            }}
          >
            {note.is_archived ? (
              <>
                <ArchiveRestore aria-hidden="true" />
                Restaurer
              </>
            ) : (
              <>
                <Archive aria-hidden="true" />
                Archiver
              </>
            )}
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

      <Dialog open={edition} onOpenChange={setEdition}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l&apos;idée</DialogTitle>
          </DialogHeader>

          <form onSubmit={enregistrer} className="space-y-5">
            <Textarea
              value={texte}
              onChange={(event) => setTexte(event.target.value)}
              maxLength={LIMITE_IDEE}
              autoFocus
              rows={3}
              aria-label="Texte de l'idée"
              aria-invalid={Boolean(erreur)}
            />
            {erreur ? (
              <p role="alert" className="text-danger text-sm">
                {erreur}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="submit" disabled={pending || texte.trim().length === 0}>
                {pending ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deplacement} onOpenChange={setDeplacement}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Déplacer l&apos;idée</DialogTitle>
            <DialogDescription>
              « {note.content.slice(0, 80)}
              {note.content.length > 80 ? "…" : ""} »
            </DialogDescription>
          </DialogHeader>

          {destinations.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Il n&apos;y a pas d&apos;autre place où la mettre pour l&apos;instant.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {destinations.map((destination) => (
                <button
                  key={destination.cle}
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    agir(
                      () => deplacerNote(orgSlug, note.id, destination.valeur),
                      `Déplacée vers ${destination.label}`,
                      () => setDeplacement(false),
                    )
                  }
                  className="border-line text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:ring-ring rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                >
                  {destination.label}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={suppression} onOpenChange={setSuppression}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette idée ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {note.content.slice(0, 120)}
              {note.content.length > 120 ? "…" : ""} » — c&apos;est définitif. Pour
              la garder sans l&apos;avoir sous les yeux, archive-la.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                agir(() => supprimerNote(orgSlug, note.id), "Idée supprimée", () =>
                  setSuppression(false),
                )
              }
            >
              {pending ? "Suppression…" : "Supprimer définitivement"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
