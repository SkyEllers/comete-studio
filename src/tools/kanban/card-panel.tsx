"use client";

import {
  Archive,
  CalendarDays,
  Check,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CardChecklists } from "./card-checklists";
import { CardComments } from "./card-comments";
import { CardDescription } from "./card-description";
import { CoverPicker, DuePicker, LabelPicker, MemberPicker } from "./card-fields";
import {
  archiveCardById,
  createChecklist,
  createChecklistItem,
  createComment,
  createLabel,
  deleteCard,
  deleteChecklist,
  deleteChecklistItem,
  deleteComment,
  loadCardThread,
  moveCardToList,
  renameChecklist,
  renameLabel,
  restoreCard,
  setCardCover,
  setCardDueDate,
  toggleCardAssignee,
  toggleCardCompleted,
  toggleCardLabel,
  updateCardDescription,
  updateCardTitle,
  updateChecklistItem,
  updateComment,
  type Activite,
  type Checklist,
  type Commentaire,
} from "./card-mutations";
import { initiales } from "./initials";
import { colorHex, type BoardColor } from "./palette";
import { PAS_POSITION } from "./positions";
import type { BoardAction } from "./store";
import type { BoardCard, BoardLabel, BoardList, BoardMember } from "./types";

const dateLongue = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Bouton discret des barres d'attributs. */
function Puce({
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button variant="secondary" size="sm" {...props}>
      {children}
    </Button>
  );
}

export function CardPanel({
  card,
  version,
  lists,
  labels,
  members,
  cardsOfTargetList,
  boardId,
  userId,
  canDelete,
  archived = false,
  dispatch,
  onClose,
}: {
  card: BoardCard;
  /** Change quand quelqu'un d'autre touche cette carte : on relit le fil. */
  version: number;
  lists: BoardList[];
  labels: BoardLabel[];
  members: BoardMember[];
  /** Position de la dernière carte d'une liste, pour y déposer celle-ci. */
  cardsOfTargetList: (listId: string) => number;
  boardId: string;
  userId: string;
  canDelete: boolean;
  /** La fiche est ouverte depuis les archives (chantier 6). */
  archived?: boolean;
  dispatch: React.Dispatch<BoardAction>;
  onClose: () => void;
}) {
  const [chargement, setChargement] = useState(true);
  const [comments, setComments] = useState<Commentaire[]>([]);
  const [activities, setActivities] = useState<Activite[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [editionTitre, setEditionTitre] = useState(false);
  const [titre, setTitre] = useState(card.title);

  const cardId = card.id;

  // Le composant est monté avec la fiche (`key` sur l'identifiant côté
  // tableau) : un seul chargement par ouverture, sans setState synchrone. Une
  // nouvelle `version` — quelqu'un d'autre a écrit ici — relit le fil.
  useEffect(() => {
    let vivant = true;

    loadCardThread(cardId)
      .then((fil) => {
        if (!vivant) return;
        setComments(fil.comments);
        setActivities(fil.activities);
        setChecklists(fil.checklists);
        setChargement(false);
      })
      .catch(() => {
        if (!vivant) return;
        setChargement(false);
        toast.error("Impossible de charger cette carte.");
      });

    return () => {
      vivant = false;
    };
  }, [cardId, version]);

  /**
   * Les activités sont écrites par la base au fil des actions : plutôt que de
   * deviner la ligne insérée, on relit les vingt dernières. Une requête courte,
   * et le journal reste exact.
   */
  const rafraichirActivites = useCallback(async () => {
    const fil = await loadCardThread(cardId);
    setActivities(fil.activities);
  }, [cardId]);

  const patcher = (patch: Partial<BoardCard>) =>
    dispatch({ type: "card/patched", id: cardId, patch });

  const echec = (message: string) => {
    toast.error(message);
  };

  // ---------------------------------- Titre ----------------------------------

  const ouvrirTitre = () => {
    setTitre(card.title);
    setEditionTitre(true);
  };

  const validerTitre = async () => {
    const propre = titre.trim();
    setEditionTitre(false);
    if (!propre || propre === card.title) return;

    const avant = card.title;
    patcher({ title: propre });

    const result = await updateCardTitle(cardId, propre);
    if (!result.ok) {
      patcher({ title: avant });
      echec(result.error);
    }
  };

  // ------------------------------- Emplacement -------------------------------

  const listeCourante = lists.find((l) => l.id === card.listId);

  const deplacerVers = async (listId: string) => {
    if (listId === card.listId) return;

    const depart = card.listId;
    const positionAvant = card.position;
    const position = cardsOfTargetList(listId) + PAS_POSITION;

    dispatch({ type: "card/moved", id: cardId, listId, position });

    const result = await moveCardToList({
      cardId,
      boardId,
      listId,
      position,
      userId,
      fromListName: lists.find((l) => l.id === depart)?.name ?? "",
      toListName: lists.find((l) => l.id === listId)?.name ?? "",
    });

    if (!result.ok) {
      dispatch({
        type: "card/moved",
        id: cardId,
        listId: depart,
        position: positionAvant,
      });
      echec(result.error);
      return;
    }
    void rafraichirActivites();
  };

  // --------------------------------- Terminé ---------------------------------

  const basculerTermine = async (fait: boolean) => {
    patcher({ isCompleted: fait });

    const result = await toggleCardCompleted({
      cardId,
      boardId,
      userId,
      isCompleted: fait,
    });

    if (!result.ok) {
      patcher({ isCompleted: !fait });
      echec(result.error);
      return;
    }
    void rafraichirActivites();
  };

  // -------------------------------- Étiquettes -------------------------------

  const basculerEtiquette = async (labelId: string, actif: boolean) => {
    const avant = card.labelIds;
    patcher({
      labelIds: actif
        ? [...avant, labelId]
        : avant.filter((id) => id !== labelId),
    });

    const result = await toggleCardLabel({
      cardId,
      boardId,
      labelId,
      userId,
      actif,
    });

    if (!result.ok) {
      patcher({ labelIds: avant });
      echec(result.error);
      return;
    }
    void rafraichirActivites();
  };

  const creerEtiquette = async (name: string, color: BoardColor) => {
    const result = await createLabel({ boardId, name, color });
    if (!result.ok) {
      echec(result.error);
      return;
    }
    dispatch({ type: "label/added", label: result.data });
    void basculerEtiquette(result.data.id, true);
  };

  const renommerEtiquette = async (labelId: string, name: string) => {
    const avant = labels.find((l) => l.id === labelId)?.name ?? "";
    dispatch({ type: "label/patched", id: labelId, patch: { name } });

    const result = await renameLabel(labelId, name);
    if (!result.ok) {
      dispatch({ type: "label/patched", id: labelId, patch: { name: avant } });
      echec(result.error);
    }
  };

  // --------------------------------- Échéance --------------------------------

  const changerEcheance = async (jour: string | null) => {
    const avant = card.dueDate;
    patcher({ dueDate: jour });

    const result = await setCardDueDate({ cardId, boardId, userId, dueDate: jour });
    if (!result.ok) {
      patcher({ dueDate: avant });
      echec(result.error);
      return;
    }
    void rafraichirActivites();
  };

  // ---------------------------------- Membres --------------------------------

  const basculerMembre = async (memberId: string, actif: boolean) => {
    const avant = card.assigneeIds;
    patcher({
      assigneeIds: actif
        ? [...avant, memberId]
        : avant.filter((id) => id !== memberId),
    });

    const result = await toggleCardAssignee({
      cardId,
      boardId,
      memberId,
      memberName: members.find((m) => m.id === memberId)?.name ?? "",
      userId,
      actif,
    });

    if (!result.ok) {
      patcher({ assigneeIds: avant });
      echec(result.error);
      return;
    }
    void rafraichirActivites();
  };

  // -------------------------------- Description ------------------------------

  const enregistrerDescription = async (description: string) => {
    const avant = card.description;
    patcher({ description });

    const result = await updateCardDescription(cardId, description);
    if (!result.ok) {
      patcher({ description: avant });
      echec(result.error);
      return false;
    }
    return true;
  };

  // -------------------------------- Couverture -------------------------------

  const changerCouverture = async (couleur: BoardColor | null) => {
    const avant = card.coverColor;
    patcher({ coverColor: couleur });

    const result = await setCardCover(cardId, couleur);
    if (!result.ok) {
      patcher({ coverColor: avant });
      echec(result.error);
    }
  };

  // -------------------------------- Checklists -------------------------------

  /** Les compteurs de la mini-carte suivent l'état local des checklists. */
  const compter = (listes: Checklist[]) => {
    const items = listes.flatMap((c) => c.items);
    patcher({
      checklistTotal: items.length,
      checklistDone: items.filter((i) => i.isDone).length,
    });
  };

  /**
   * La suite est calculée avant d'appeler `setChecklists` : dispatcher depuis
   * la fonction de mise à jour reviendrait à toucher le store du tableau
   * pendant le rendu de la fiche, ce que React refuse.
   */
  const majChecklists = (
    transformer: (listes: Checklist[]) => Checklist[],
  ) => {
    const suivantes = transformer(checklists);
    setChecklists(suivantes);
    compter(suivantes);
  };

  const ajouterChecklist = async (title: string) => {
    const position = (checklists.at(-1)?.position ?? 0) + PAS_POSITION;
    const result = await createChecklist({ cardId, boardId, title, position });
    if (!result.ok) {
      echec(result.error);
      return;
    }
    majChecklists((listes) => [...listes, result.data]);
  };

  const renommerChecklist = async (checklistId: string, title: string) => {
    majChecklists((listes) =>
      listes.map((c) => (c.id === checklistId ? { ...c, title } : c)),
    );
    const result = await renameChecklist(checklistId, title);
    if (!result.ok) echec(result.error);
  };

  const supprimerChecklist = async (checklistId: string) => {
    const avant = checklists;
    majChecklists((listes) => listes.filter((c) => c.id !== checklistId));

    const result = await deleteChecklist(checklistId);
    if (!result.ok) {
      majChecklists(() => avant);
      echec(result.error);
    }
  };

  const ajouterItem = async (checklistId: string, text: string) => {
    const checklist = checklists.find((c) => c.id === checklistId);
    const position = (checklist?.items.at(-1)?.position ?? 0) + PAS_POSITION;

    const result = await createChecklistItem({
      checklistId,
      boardId,
      text,
      position,
    });
    if (!result.ok) {
      echec(result.error);
      return;
    }

    majChecklists((listes) =>
      listes.map((c) =>
        c.id === checklistId ? { ...c, items: [...c.items, result.data] } : c,
      ),
    );
  };

  const modifierItem = async (
    itemId: string,
    patch: { text?: string; isDone?: boolean },
  ) => {
    const avant = checklists;
    majChecklists((listes) =>
      listes.map((c) => ({
        ...c,
        items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
      })),
    );

    const result = await updateChecklistItem({ itemId, ...patch });
    if (!result.ok) {
      majChecklists(() => avant);
      echec(result.error);
    }
  };

  const supprimerItem = async (itemId: string) => {
    const avant = checklists;
    majChecklists((listes) =>
      listes.map((c) => ({
        ...c,
        items: c.items.filter((i) => i.id !== itemId),
      })),
    );

    const result = await deleteChecklistItem(itemId);
    if (!result.ok) {
      majChecklists(() => avant);
      echec(result.error);
    }
  };

  // ------------------------------- Commentaires ------------------------------

  const publierCommentaire = async (body: string) => {
    const result = await createComment({ cardId, boardId, userId, body });
    if (!result.ok) {
      echec(result.error);
      return false;
    }

    setComments((liste) => [...liste, result.data]);
    patcher({ commentCount: card.commentCount + 1 });
    void rafraichirActivites();
    return true;
  };

  const modifierCommentaire = async (commentId: string, body: string) => {
    const avant = comments;
    setComments((liste) =>
      liste.map((c) => (c.id === commentId ? { ...c, body } : c)),
    );

    const result = await updateComment(commentId, body);
    if (!result.ok) {
      setComments(avant);
      echec(result.error);
    }
  };

  const supprimerCommentaire = async (commentId: string) => {
    const avant = comments;
    setComments((liste) => liste.filter((c) => c.id !== commentId));
    patcher({ commentCount: Math.max(0, card.commentCount - 1) });

    const result = await deleteComment(commentId);
    if (!result.ok) {
      setComments(avant);
      patcher({ commentCount: card.commentCount });
      echec(result.error);
    }
  };

  // --------------------------------- Actions ---------------------------------

  const copierLien = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Lien copié");
    } catch {
      echec("Le navigateur a refusé la copie.");
    }
  };

  const archiver = async () => {
    const result = await archiveCardById({ cardId, boardId, userId });
    if (!result.ok) {
      echec(result.error);
      return;
    }
    dispatch({ type: "card/removed", id: cardId });
    toast.success("Carte archivée");
    onClose();
  };

  const restaurer = async () => {
    const result = await restoreCard(cardId);
    if (!result.ok) {
      echec(result.error);
      return;
    }
    toast.success("Carte restaurée");
    onClose();
  };

  const supprimer = async () => {
    const result = await deleteCard(cardId);
    if (!result.ok) {
      echec(result.error);
      return;
    }
    dispatch({ type: "card/removed", id: cardId });
    toast.success("Carte supprimée");
    onClose();
  };

  // ---------------------------------- Rendu ----------------------------------

  const etiquettes = labels.filter((l) => card.labelIds.includes(l.id));
  const assignes = members.filter((m) => card.assigneeIds.includes(m.id));

  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent
        // La fiche décrit son contenu par son titre : sans description, Radix
        // veut qu'on le dise explicitement.
        aria-describedby={undefined}
        // Plein écran sur mobile, fenêtre large ailleurs.
        className="max-h-svh gap-0 overflow-y-auto p-0 max-sm:h-svh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:top-0 max-sm:left-0 sm:max-h-[88svh] sm:max-w-3xl"
      >
        {card.coverColor ? (
          <div
            aria-hidden="true"
            className="h-12 shrink-0"
            style={{ backgroundColor: colorHex(card.coverColor) }}
          />
        ) : null}

        <div className="space-y-6 p-4 sm:p-6">
          {/* ------------------------------ Entête ------------------------------ */}
          <header className="space-y-3 pr-8">
            {/* Radix exige un titre : on le garde constant pour les lecteurs
                d'écran, l'édition se fait sur le titre visible juste dessous. */}
            <DialogTitle className="sr-only">{card.title}</DialogTitle>

            {editionTitre ? (
              <Input
                autoFocus
                value={titre}
                onChange={(event) => setTitre(event.target.value)}
                onBlur={() => void validerTitre()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void validerTitre();
                  }
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setEditionTitre(false);
                  }
                }}
                maxLength={200}
                aria-label="Titre de la carte"
                className="font-display h-auto py-1 text-lg font-semibold"
              />
            ) : (
              <button
                type="button"
                onClick={ouvrirTitre}
                className="hover:bg-surface-2 focus-visible:ring-ring font-display block w-full rounded-md px-1.5 py-1 text-left text-lg font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {card.title}
              </button>
            )}

            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                <span>dans la liste</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm">
                      {listeCourante?.name ?? "—"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>Déplacer vers</DropdownMenuLabel>
                    {lists.map((liste) => (
                      <DropdownMenuItem
                        key={liste.id}
                        onSelect={() => void deplacerVers(liste.id)}
                      >
                        {liste.id === card.listId ? (
                          <Check aria-hidden="true" />
                        ) : null}
                        {liste.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <label className="text-foreground ml-2 inline-flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={card.isCompleted}
                    onCheckedChange={(coche) =>
                      void basculerTermine(coche === true)
                    }
                  />
                  Terminé
                </label>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label="Actions de la carte"
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => void copierLien()}>
                      <Link2 aria-hidden="true" />
                      Copier le lien
                    </DropdownMenuItem>

                    {archived ? (
                      <>
                        <DropdownMenuItem onSelect={() => void restaurer()}>
                          <RotateCcw aria-hidden="true" />
                          Restaurer
                        </DropdownMenuItem>
                        {canDelete ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => void supprimer()}
                            >
                              <Trash2 aria-hidden="true" />
                              Supprimer définitivement
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <DropdownMenuItem onSelect={() => void archiver()}>
                        <Archive aria-hidden="true" />
                        Archiver la carte
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
            </div>
          </header>

          {/* ---------------------------- Attributs ---------------------------- */}
          <div className="flex flex-wrap items-center gap-2">
            {etiquettes.map((label) => (
              <span
                key={label.id}
                className="text-void inline-flex h-7 items-center rounded-md px-2 text-xs font-medium"
                style={{ backgroundColor: colorHex(label.color) }}
              >
                {label.name || "Sans nom"}
              </span>
            ))}

            <LabelPicker
              labels={labels}
              selectedIds={card.labelIds}
              onToggle={(labelId, actif) => void basculerEtiquette(labelId, actif)}
              onCreate={(name, color) => void creerEtiquette(name, color)}
              onRename={(labelId, name) => void renommerEtiquette(labelId, name)}
            >
              <Puce aria-label="Étiquettes">
                <Tag aria-hidden="true" />
                {etiquettes.length === 0 ? "Étiquettes" : null}
                <Plus aria-hidden="true" />
              </Puce>
            </LabelPicker>

            <DuePicker
              value={card.dueDate}
              onChange={(jour) => void changerEcheance(jour)}
            >
              <Puce
                className={cn(
                  card.dueDate && card.isCompleted && "text-success",
                )}
              >
                <CalendarDays aria-hidden="true" />
                {card.dueDate
                  ? dateLongue.format(new Date(`${card.dueDate}T00:00:00`))
                  : "Échéance"}
              </Puce>
            </DuePicker>

            <MemberPicker
              members={members}
              selectedIds={card.assigneeIds}
              onToggle={(memberId, actif) => void basculerMembre(memberId, actif)}
            >
              <Puce aria-label="Membres de la carte">
                <Users aria-hidden="true" />
                {assignes.length === 0 ? (
                  "Membres"
                ) : (
                  <span className="flex -space-x-1.5">
                    {assignes.slice(0, 4).map((membre) => (
                      <span
                        key={membre.id}
                        title={membre.name}
                        className="border-surface-1 bg-surface-2 flex size-5 items-center justify-center rounded-full border text-[0.55rem] font-medium"
                      >
                        {initiales(membre.name)}
                      </span>
                    ))}
                  </span>
                )}
              </Puce>
            </MemberPicker>

            <CoverPicker
              value={card.coverColor}
              onChange={(couleur) => void changerCouverture(couleur)}
            >
              <Puce aria-label="Couverture">
                <ImageIcon aria-hidden="true" />
                Couverture
              </Puce>
            </CoverPicker>
          </div>

          <CardDescription
            value={card.description}
            onSave={enregistrerDescription}
          />

          {chargement ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : (
            <>
              <CardChecklists
                checklists={checklists}
                onAddChecklist={(titreListe) => void ajouterChecklist(titreListe)}
                onRenameChecklist={(id, titreListe) =>
                  void renommerChecklist(id, titreListe)
                }
                onDeleteChecklist={(id) => void supprimerChecklist(id)}
                onAddItem={(id, texte) => void ajouterItem(id, texte)}
                onToggleItem={(id, fait) => void modifierItem(id, { isDone: fait })}
                onRenameItem={(id, texte) => void modifierItem(id, { text: texte })}
                onDeleteItem={(id) => void supprimerItem(id)}
              />

              <CardComments
                comments={comments}
                activities={activities}
                labels={labels}
                members={members}
                userId={userId}
                onCreate={publierCommentaire}
                onUpdate={(id, body) => void modifierCommentaire(id, body)}
                onDelete={(id) => void supprimerCommentaire(id)}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
