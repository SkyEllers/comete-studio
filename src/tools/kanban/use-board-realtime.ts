"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

import { estNotreEcho } from "./echo";
import type { BoardAction } from "./store";

type Tables = Database["public"]["Tables"];
type Ligne<T extends keyof Tables> = Tables[T]["Row"];

/** Ce que le canal nous transmet, réduit à ce qu'on en fait. */
type Evenement<L> = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: L;
  old: L;
};

export type EtatTempsReel = "connexion" | "connecte" | "hors-ligne";

export type RappelsTempsReel = {
  boardId: string;
  userId: string;
  dispatch: (action: BoardAction) => void;
  /** Carte à laquelle appartient une checklist, dans l'état du moment. */
  carteDeChecklist: (checklistId: string) => string | undefined;
  /** La carte est-elle déjà chargée ? Une carte restaurée ne l'est pas. */
  carteConnue: (cardId: string) => boolean;
  /** Une carte a reçu un commentaire, une checklist ou une activité. */
  onCarteTouchee: (cardId: string) => void;
  /** Une carte vient de quitter le tableau (archivée ou supprimée ailleurs). */
  onCartePartie: (cardId: string) => void;
  /** Rechargement complet : reconnexion, ou état devenu incomplet. */
  onResync: () => void;
  onTableauParti: (raison: "archive" | "supprime") => void;
};

/**
 * Un tableau vivant : les gestes des autres arrivent par un canal Realtime et
 * passent par le même réducteur que les nôtres.
 *
 * Un seul canal, `board:<id>`, avec un abonnement par table filtré sur
 * `board_id` — la RLS s'applique aussi ici, donc rien ne traverse la frontière
 * d'une organisation.
 *
 * Concurrence : deux personnes qui déplacent la même carte au même instant
 * écrivent l'une après l'autre, la dernière gagne, et le premier écran se
 * réaligne en recevant l'événement. Accepté en v1 : le kanban n'a pas de
 * fusion de conflits.
 */
export function useBoardRealtime(rappels: RappelsTempsReel): EtatTempsReel {
  const [etat, setEtat] = useState<EtatTempsReel>("connexion");
  // Incrémenté pour reconstruire le canal : retour du réseau, ou canal resté
  // muet trop longtemps.
  const [tentative, setTentative] = useState(0);
  // Survit à la reconstruction du canal : c'est lui qui distingue la première
  // connexion d'une reconnexion, donc qui déclenche le rechargement.
  const dejaConnecte = useRef(false);

  // Rafraîchis à chaque rendu : le canal, lui, ne se remonte pas.
  const courants = useRef(rappels);
  useEffect(() => {
    courants.current = rappels;
  });

  const { boardId } = rappels;

  /*
   * Filet de sécurité. La reconnexion automatique de Realtime suffit dans le
   * cas courant, mais une coupure longue peut la laisser en échec : on
   * reconstruit alors un canal neuf, et le retour du réseau déclenche la même
   * reprise sans attendre.
   */
  useEffect(() => {
    if (etat !== "hors-ligne") return;

    const reprise = setTimeout(() => setTentative((n) => n + 1), 15000);
    return () => clearTimeout(reprise);
  }, [etat, tentative]);

  useEffect(() => {
    const retour = () => setTentative((n) => n + 1);
    window.addEventListener("online", retour);
    return () => window.removeEventListener("online", retour);
  }, []);

  useEffect(() => {
    let vivant = true;
    const supabase = createClient();
    const canal = supabase.channel(`board:${boardId}`);
    const surCeTableau = `board_id=eq.${boardId}`;

    const ligne = <L>(evenement: Evenement<L>): L =>
      evenement.eventType === "DELETE" ? evenement.old : evenement.new;

    const abonner = <L>(
      table: string,
      filter: string,
      reagir: (evenement: Evenement<L>) => void,
    ) => {
      canal.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter },
        (payload) => reagir(payload as unknown as Evenement<L>),
      );
    };

    // --------------------------------- Tableau --------------------------------
    abonner<Ligne<"boards">>("boards", `id=eq.${boardId}`, (evenement) => {
      if (evenement.eventType === "DELETE") {
        courants.current.onTableauParti("supprime");
        return;
      }

      const row = evenement.new;
      if (estNotreEcho("boards", row.id)) return;

      if (row.is_archived) {
        courants.current.onTableauParti("archive");
        return;
      }

      courants.current.dispatch({
        type: "board/patched",
        patch: {
          name: row.name,
          description: row.description,
          color: row.color,
          isArchived: row.is_archived,
        },
      });
    });

    // --------------------------------- Listes ---------------------------------
    abonner<Ligne<"lists">>("lists", surCeTableau, (evenement) => {
      const row = ligne(evenement);
      if (!row?.id || estNotreEcho("lists", row.id)) return;

      const { dispatch } = courants.current;

      if (evenement.eventType === "DELETE" || row.is_archived) {
        dispatch({ type: "list/removed", id: row.id });
        return;
      }

      // `list/added` ne fait rien si la liste est déjà là : les deux dispatchs
      // couvrent d'un coup la création, la restauration et la modification.
      dispatch({
        type: "list/added",
        list: { id: row.id, name: row.name, position: row.position },
      });
      dispatch({
        type: "list/patched",
        id: row.id,
        patch: { name: row.name, position: row.position },
      });
    });

    // --------------------------------- Cartes ---------------------------------
    abonner<Ligne<"cards">>("cards", surCeTableau, (evenement) => {
      const row = ligne(evenement);
      if (!row?.id || estNotreEcho("cards", row.id)) return;

      const { dispatch, carteConnue, onResync, onCartePartie } = courants.current;

      if (evenement.eventType === "DELETE" || row.is_archived) {
        dispatch({ type: "card/removed", id: row.id });
        onCartePartie(row.id);
        return;
      }

      if (!carteConnue(row.id)) {
        // Une carte créée arrive nue ; une carte restaurée, elle, traîne des
        // étiquettes et des commentaires qu'on n'a pas : on recharge.
        if (evenement.eventType !== "INSERT") {
          onResync();
          return;
        }

        dispatch({
          type: "card/added",
          card: {
            id: row.id,
            listId: row.list_id,
            title: row.title,
            description: row.description,
            position: row.position,
            dueDate: row.due_date,
            isCompleted: row.is_completed,
            coverColor: row.cover_color,
            labelIds: [],
            assigneeIds: [],
            checklistDone: 0,
            checklistTotal: 0,
            commentCount: 0,
          },
        });
        return;
      }

      dispatch({
        type: "card/patched",
        id: row.id,
        patch: {
          listId: row.list_id,
          title: row.title,
          description: row.description,
          position: row.position,
          dueDate: row.due_date,
          isCompleted: row.is_completed,
          coverColor: row.cover_color,
        },
      });
    });

    // ------------------------------- Étiquettes -------------------------------
    abonner<Ligne<"labels">>("labels", surCeTableau, (evenement) => {
      const row = ligne(evenement);
      if (!row?.id || estNotreEcho("labels", row.id)) return;

      const { dispatch } = courants.current;

      if (evenement.eventType === "DELETE") {
        dispatch({ type: "label/removed", id: row.id });
        return;
      }

      dispatch({
        type: "label/added",
        label: { id: row.id, name: row.name, color: row.color },
      });
      dispatch({
        type: "label/patched",
        id: row.id,
        patch: { name: row.name, color: row.color },
      });
    });

    abonner<Ligne<"card_labels">>("card_labels", surCeTableau, (evenement) => {
      const row = ligne(evenement);
      if (!row?.card_id) return;
      if (estNotreEcho("card_labels", `${row.card_id}:${row.label_id}`)) return;

      courants.current.dispatch({
        type: "card/labelToggled",
        cardId: row.card_id,
        labelId: row.label_id,
        actif: evenement.eventType !== "DELETE",
      });
    });

    // --------------------------------- Membres --------------------------------
    abonner<Ligne<"card_assignees">>(
      "card_assignees",
      surCeTableau,
      (evenement) => {
        const row = ligne(evenement);
        if (!row?.card_id) return;
        if (estNotreEcho("card_assignees", `${row.card_id}:${row.user_id}`))
          return;

        courants.current.dispatch({
          type: "card/assigneeToggled",
          cardId: row.card_id,
          userId: row.user_id,
          actif: evenement.eventType !== "DELETE",
        });
      },
    );

    // -------------------------------- Checklists ------------------------------
    abonner<Ligne<"checklists">>("checklists", surCeTableau, (evenement) => {
      const row = ligne(evenement);
      if (!row?.id || estNotreEcho("checklists", row.id)) return;

      const { dispatch, onCarteTouchee } = courants.current;

      if (evenement.eventType === "INSERT") {
        dispatch({
          type: "checklist/registered",
          checklistId: row.id,
          cardId: row.card_id,
        });
      }

      // La suppression d'une checklist emporte ses items : leurs propres
      // événements ajusteront les compteurs.
      onCarteTouchee(row.card_id);
    });

    abonner<Ligne<"checklist_items">>(
      "checklist_items",
      surCeTableau,
      (evenement) => {
        const row = ligne(evenement);
        if (!row?.id || estNotreEcho("checklist_items", row.id)) return;

        const { dispatch, carteDeChecklist, onCarteTouchee } = courants.current;
        const fait = row.is_done ? 1 : 0;

        if (evenement.eventType === "INSERT") {
          dispatch({
            type: "checklistItem/changed",
            checklistId: row.checklist_id,
            deltaDone: fait,
            deltaTotal: 1,
          });
        } else if (evenement.eventType === "DELETE") {
          dispatch({
            type: "checklistItem/changed",
            checklistId: row.checklist_id,
            deltaDone: -fait,
            deltaTotal: -1,
          });
        } else if (evenement.old?.is_done !== row.is_done) {
          dispatch({
            type: "checklistItem/changed",
            checklistId: row.checklist_id,
            deltaDone: row.is_done ? 1 : -1,
            deltaTotal: 0,
          });
        }

        const cardId = carteDeChecklist(row.checklist_id);
        if (cardId) onCarteTouchee(cardId);
      },
    );

    // ------------------------------- Commentaires -----------------------------
    /*
     * Nos propres commentaires sont déjà affichés : on les reconnaît à
     * `user_id`. Contrepartie assumée en v1 : le même compte ouvert sur deux
     * appareils ne verra pas ses commentaires apparaître tout seuls.
     */
    abonner<Ligne<"comments">>("comments", surCeTableau, (evenement) => {
      const row = ligne(evenement);
      if (!row?.id || estNotreEcho("comments", row.id)) return;
      if (row.user_id === courants.current.userId) return;

      const { dispatch, onCarteTouchee } = courants.current;

      if (evenement.eventType === "INSERT") {
        dispatch({ type: "card/commentDelta", cardId: row.card_id, delta: 1 });
      } else if (evenement.eventType === "DELETE") {
        dispatch({ type: "card/commentDelta", cardId: row.card_id, delta: -1 });
      }

      onCarteTouchee(row.card_id);
    });

    // --------------------------------- Activité -------------------------------
    abonner<Ligne<"card_activities">>(
      "card_activities",
      surCeTableau,
      (evenement) => {
        const row = ligne(evenement);
        if (!row?.card_id || row.user_id === courants.current.userId) return;
        courants.current.onCarteTouchee(row.card_id);
      },
    );

    // ------------------------------- Abonnement -------------------------------
    const ecouter = () =>
      canal.subscribe((status) => {
        if (!vivant) return;

        if (status === "SUBSCRIBED") {
          setEtat("connecte");
          // Une reconnexion laisse un trou : ce qui s'est passé pendant la
          // coupure n'a été envoyé à personne. On recharge le tableau entier.
          if (dejaConnecte.current) courants.current.onResync();
          dejaConnecte.current = true;
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setEtat("hors-ligne");
        }
      });

    /*
     * Le canal doit porter le jeton de la session avant de s'abonner.
     * Realtime applique la RLS avec les droits qu'il a au moment de la
     * jonction : sans jeton, il lit en tant qu'`anon`, `can_access_board()`
     * répond faux, et le canal reste vivant mais muet. `setAuth()` sans
     * argument va chercher le jeton courant du client.
     */
    void supabase.realtime
      .setAuth()
      .catch(() => undefined)
      .then(() => {
        if (vivant) ecouter();
      });

    return () => {
      vivant = false;
      void supabase.removeChannel(canal);
    };
  }, [boardId, tentative]);

  return etat;
}
