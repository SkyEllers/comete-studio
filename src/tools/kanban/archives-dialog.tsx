"use client";

import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionResult } from "@/lib/actions";

import { loadArchives, type Archives } from "./archives";
import { deleteCard, restoreCard } from "./card-mutations";
import { deleteList, restoreList } from "./mutations";

/** Ce qu'une confirmation de suppression définitive porte. */
type Suppression =
  | { genre: "carte"; id: string; nom: string }
  | { genre: "liste"; id: string; nom: string; cardCount: number };

function Rangee({
  titre,
  detail,
  children,
}: {
  titre: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{titre}</p>
        <p className="text-muted-foreground font-mono text-xs">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </li>
  );
}

const VIDE: Archives = { cards: [], lists: [] };

/**
 * Le contenu est monté avec la fenêtre et démonté avec elle : chaque ouverture
 * repart d'un état neuf et relit les archives — entre deux visites, d'autres
 * ont pu archiver.
 */
function ContenuArchives({
  boardId,
  canDelete,
  onResync,
}: {
  boardId: string;
  canDelete: boolean;
  onResync: () => void;
}) {
  const [archives, setArchives] = useState<Archives | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [suppression, setSuppression] = useState<Suppression | null>(null);

  useEffect(() => {
    let vivant = true;

    void loadArchives(boardId).then((result) => {
      if (!vivant) return;
      if (!result.ok) {
        toast.error(result.error);
        setArchives(VIDE);
        return;
      }
      setArchives(result.data);
    });

    return () => {
      vivant = false;
    };
  }, [boardId]);

  const agir = async (
    cle: string,
    action: () => Promise<ActionResult>,
    succes: string,
    rechargerTableau: boolean,
  ) => {
    setEnCours(cle);
    const result = await action();

    if (!result.ok) {
      setEnCours(null);
      toast.error(result.error);
      return;
    }

    const archivesFraiches = await loadArchives(boardId);
    setEnCours(null);
    if (archivesFraiches.ok) setArchives(archivesFraiches.data);

    toast.success(succes);
    if (rechargerTableau) onResync();
  };

  const confirmerSuppression = async () => {
    if (!suppression) return;

    const cible = suppression;
    setSuppression(null);

    await agir(
      `${cible.genre}:${cible.id}`,
      () =>
        cible.genre === "carte" ? deleteCard(cible.id) : deleteList(cible.id),
      cible.genre === "carte" ? "Carte supprimée" : "Liste supprimée",
      false,
    );
  };

  const vide =
    archives !== null &&
    archives.cards.length === 0 &&
    archives.lists.length === 0;

  return (
    <>
      {archives === null ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : vide ? (
        <p className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-sm">
          <Archive aria-hidden="true" className="size-6" />
          Rien dans les archives.
        </p>
      ) : (
        <div className="space-y-6">
          {archives && archives.cards.length > 0 ? (
            <section>
              <h3 className="text-muted-foreground mb-1 text-xs">
                Cartes ({archives.cards.length})
              </h3>
              <ul className="divide-line divide-y">
                {archives.cards.map((carte) => (
                  <Rangee
                    key={carte.id}
                    titre={carte.title}
                    detail={
                      carte.listArchived
                        ? `${carte.listName} — liste archivée`
                        : carte.listName
                    }
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        carte.listArchived || enCours === `carte:${carte.id}`
                      }
                      title={
                        carte.listArchived
                          ? "Restaure sa liste d'abord."
                          : undefined
                      }
                      onClick={() =>
                        void agir(
                          `carte:${carte.id}`,
                          () => restoreCard(carte.id),
                          "Carte restaurée",
                          true,
                        )
                      }
                    >
                      <RotateCcw aria-hidden="true" />
                      Restaurer
                    </Button>

                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Supprimer définitivement la carte ${carte.title}`}
                        className="text-destructive"
                        onClick={() =>
                          setSuppression({
                            genre: "carte",
                            id: carte.id,
                            nom: carte.title,
                          })
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </Rangee>
                ))}
              </ul>
            </section>
          ) : null}

          {archives && archives.lists.length > 0 ? (
            <section>
              <h3 className="text-muted-foreground mb-1 text-xs">
                Listes ({archives.lists.length})
              </h3>
              <ul className="divide-line divide-y">
                {archives.lists.map((liste) => (
                  <Rangee
                    key={liste.id}
                    titre={liste.name}
                    detail={`${liste.cardCount} carte${liste.cardCount > 1 ? "s" : ""}`}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={enCours === `liste:${liste.id}`}
                      onClick={() =>
                        void agir(
                          `liste:${liste.id}`,
                          () => restoreList(liste.id),
                          "Liste restaurée",
                          true,
                        )
                      }
                    >
                      <RotateCcw aria-hidden="true" />
                      Restaurer
                    </Button>

                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Supprimer définitivement la liste ${liste.name}`}
                        className="text-destructive"
                        onClick={() =>
                          setSuppression({
                            genre: "liste",
                            id: liste.id,
                            nom: liste.name,
                            cardCount: liste.cardCount,
                          })
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </Rangee>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <AlertDialog
        open={suppression !== null}
        onOpenChange={(valeur) => !valeur && setSuppression(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer « {suppression?.nom} » ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {suppression?.genre === "liste" && suppression.cardCount > 0
                ? `Ses ${suppression.cardCount} cartes disparaissent avec elle, sans retour possible.`
                : "Cette suppression est définitive, sans retour possible."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmerSuppression()}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
            >
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ArchivesDialog({
  boardId,
  canDelete,
  ouvert,
  onOpenChange,
  onResync,
}: {
  boardId: string;
  canDelete: boolean;
  ouvert: boolean;
  onOpenChange: (ouvert: boolean) => void;
  /** Une restauration remet des éléments sur le tableau : on le recharge. */
  onResync: () => void;
}) {
  return (
    <Dialog open={ouvert} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Archives</DialogTitle>
          <DialogDescription>
            Ce que tu as retiré du tableau sans le supprimer.
          </DialogDescription>
        </DialogHeader>

        {ouvert ? (
          <ContenuArchives
            boardId={boardId}
            canDelete={canDelete}
            onResync={onResync}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
