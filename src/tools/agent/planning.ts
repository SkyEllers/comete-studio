import type { CleModele } from "./profil.ts";
import { ajouterJours, instantLocal, jourLocal, joursEntre } from "./temps.ts";

/**
 * Quel modèle doit partir maintenant ?
 *
 * Le planning ne se stocke pas (0032, décision 3) : l'horloge pose la question
 * à chaque passage, et cette fonction y répond à partir de l'état de la
 * conversation et de ce qui est déjà parti. Un rendez-vous déplacé, une
 * confirmation, un STOP changent la réponse sans rien avoir à défaire.
 *
 * Le rythme est celui de P12 (validé par Louis le 25/09/2026), les heures
 * aussi, dans le fuseau de la cliente :
 *
 *   réservation   tout de suite, même le soir : elle vient de réserver
 *   rappel        10h, deux jours sans nouvelles d'elle, tant qu'elle n'a pas
 *                 confirmé ; jamais la veille ni le jour même
 *   préparation   10h, au milieu, si plus de 4 jours séparent sa confirmation
 *                 de la veille
 *   veille        10h, la veille, à la place de l'appel de Peggy
 *   matin         8h, ou 1 h avant un rendez-vous fixé avant 9h
 *
 * Aucun modèle ne part après 20h (21h pour la veille), sauf le premier. Un
 * passage manqué se rattrape dans la journée, pas le lendemain.
 *
 * Et surtout : **rien ici n'annule jamais un rendez-vous.** Sans réponse à la
 * veille, le rendez-vous reste, et le lien part le matin.
 */

export const HEURE_JOURNEE = 10;
export const FIN_JOURNEE = 20;
export const FIN_VEILLE = 21;
export const HEURE_MATIN = 8;
/** Deux jours sans nouvelles avant un rappel. */
export const JOURS_AVANT_RAPPEL = 2;
/** Au-delà de cet écart entre confirmation et veille, un message de préparation. */
export const ECART_PREPARATION = 4;

const HEURE_MS = 3_600_000;

export type EnvoiPasse = { modele: CleModele; cle_envoi: string; le: string };

export type ConversationPlanning = {
  etat: string;
  reserve_le: string;
  rdv_debut: string;
  rdv_fin: string;
  fuseau: string;
  confirme_le: string | null;
  derniere_entree_le: string | null;
  sans_reponse_veille: boolean;
  /** Les modèles déjà partis, pour ce rendez-vous et les précédents. */
  envois: EnvoiPasse[];
};

export type Action =
  | { genre: "envoyer"; modele: CleModele; cle: string }
  | { genre: "noter_sans_reponse_veille" }
  | { genre: "terminer" };

export function planifier(c: ConversationPlanning, maintenant: number): Action[] {
  if (c.etat !== "active") return [];

  const debut = Date.parse(c.rdv_debut);
  if (maintenant >= Date.parse(c.rdv_fin)) return [{ genre: "terminer" }];
  if (maintenant >= debut) return [];

  const deja = new Set(c.envois.map((e) => e.cle_envoi));
  const f = c.fuseau;

  if (!deja.has("reservation")) {
    return [{ genre: "envoyer", modele: "reservation", cle: "reservation" }];
  }

  const aujourdhui = jourLocal(maintenant, f);
  const jourRdv = jourLocal(debut, f);
  const veille = ajouterJours(jourRdv, -1);
  const a = (heure: number, jour = aujourdhui) => instantLocal(jour, heure, 0, f);
  const enJournee = maintenant >= a(HEURE_JOURNEE) && maintenant < a(FIN_JOURNEE);

  // --------------------------- Le jour même ----------------------------------

  if (aujourdhui === jourRdv) {
    const cle = `matin:${jourRdv}`;
    const heureMatin = Math.min(a(HEURE_MATIN), debut - HEURE_MS);
    if (deja.has(cle) || maintenant < heureMatin) return [];

    const actions: Action[] = [];
    const envoiVeille = c.envois.find((e) => e.cle_envoi === `veille:${jourRdv}`);
    const aReponduDepuis =
      envoiVeille &&
      c.derniere_entree_le !== null &&
      Date.parse(c.derniere_entree_le) > Date.parse(envoiVeille.le);
    if (envoiVeille && !aReponduDepuis && !c.sans_reponse_veille) {
      actions.push({ genre: "noter_sans_reponse_veille" });
    }
    actions.push({ genre: "envoyer", modele: "matin", cle });
    return actions;
  }

  // ------------------------------ La veille ----------------------------------

  if (aujourdhui === veille) {
    const cle = `veille:${jourRdv}`;
    const tropTot = maintenant < a(HEURE_JOURNEE) || maintenant >= a(FIN_VEILLE);
    if (deja.has(cle) || tropTot) return [];

    // Réservé ou confirmé aujourd'hui même : lui redemander serait absurde.
    const reservation = c.envois.find((e) => e.cle_envoi === "reservation");
    const dejaAujourdhui = (instant: string | null | undefined) =>
      Boolean(instant) && jourLocal(instant as string, f) === aujourdhui;
    if (dejaAujourdhui(reservation?.le) || dejaAujourdhui(c.confirme_le)) return [];

    return [{ genre: "envoyer", modele: "veille", cle }];
  }

  if (aujourdhui > veille || !enJournee) return [];

  // --------------------- Avant la veille : rappel ou préparation -------------

  if (!c.confirme_le) {
    const derniers = [
      ...c.envois.map((e) => Date.parse(e.le)),
      c.derniere_entree_le ? Date.parse(c.derniere_entree_le) : 0,
    ];
    const dernier = Math.max(...derniers);
    if (joursEntre(jourLocal(dernier, f), aujourdhui) < JOURS_AVANT_RAPPEL) return [];
    const cle = `rappel:${aujourdhui}`;
    return deja.has(cle) ? [] : [{ genre: "envoyer", modele: "rappel", cle }];
  }

  const cle = `preparation:${jourRdv}`;
  if (deja.has(cle)) return [];
  const jourConfirme = jourLocal(c.confirme_le, f);
  const ecart = joursEntre(jourConfirme, veille);
  if (ecart <= ECART_PREPARATION) return [];
  const milieu = ajouterJours(jourConfirme, Math.floor(ecart / 2));
  if (aujourdhui < milieu) return [];

  // Elle a écrit dans les dernières 24 h : la conversation est ouverte,
  // l'agent n'a pas besoin d'un modèle pour lui parler.
  const fenetreOuverte =
    c.derniere_entree_le !== null &&
    maintenant - Date.parse(c.derniere_entree_le) < 24 * HEURE_MS;
  if (fenetreOuverte) return [];

  return [{ genre: "envoyer", modele: "preparation", cle }];
}
