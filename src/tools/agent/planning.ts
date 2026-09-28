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
 *   rappel        10h, à J-14, J-7 et J-3 ; J-3 seulement une fois confirmé
 *                 (Louis, 27/09/2026 ; remplace « tous les deux jours »)
 *   contenu       10h, au milieu entre deux points (réservation, rappels,
 *                 veille), un article choisi d'après son formulaire
 *   (préparation  validée par Meta, plus planifiée : le contenu la remplace)
 *   veille        10h, la veille, à la place de l'appel de Peggy
 *   matin         8h, ou 1 h avant un rendez-vous fixé avant 9h
 *
 * Aucun modèle ne part après 20h (21h pour la veille), sauf le premier. Un
 * passage manqué se rattrape dans la journée, pas le lendemain.
 *
 * Quand c'est elle qui a écrit en dernier, l'agent lui répond d'abord,
 * entre 8h et 21h ; un message de la nuit attend 8h (Louis, 25/09/2026).
 *
 * Et surtout : **rien ici n'annule jamais un rendez-vous.** Sans réponse à la
 * veille, le rendez-vous reste, et le lien part le matin.
 */

export const HEURE_JOURNEE = 10;
export const FIN_JOURNEE = 20;
export const FIN_VEILLE = 21;
export const HEURE_MATIN = 8;
/** Les réponses libres : de 8h à 21h, heure de la cliente. */
export const DEBUT_REPONSES = 8;
export const FIN_REPONSES = 21;
/** Les rappels, en jours avant le rendez-vous (Louis, 27/09/2026). */
export const JALONS = [14, 7, 3];
/** Une fois qu'elle a confirmé : J-3 seulement, puis la veille. */
export const JALONS_CONFIRMEE = [3];

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
  /** Le dernier message parti vers elle, modèle ou libre. */
  derniere_sortie_le: string | null;
  sans_reponse_veille: boolean;
  /** L'agent a annulé son rendez-vous à sa demande (0048). */
  annulee_par_agent_le?: string | null;
  /** Les modèles déjà partis, pour ce rendez-vous et les précédents. */
  envois: EnvoiPasse[];
};

export type Action =
  | { genre: "envoyer"; modele: CleModele; cle: string }
  | { genre: "repondre" }
  | { genre: "noter_sans_reponse_veille" }
  | { genre: "terminer" }
  | { genre: "clore_annulee" };

/**
 * Après une annulation par l'agent, la conversation reste ouverte deux jours
 * pour qu'elle dise pourquoi (Louis, 28/09/2026), puis se ferme « annulée ».
 */
export const ATTENTE_RAISON_MS = 2 * 24 * HEURE_MS;

export function planifier(c: ConversationPlanning, maintenant: number): Action[] {
  if (c.etat !== "active") return [];

  const debut = Date.parse(c.rdv_debut);
  const f = c.fuseau;
  const aujourdhui = jourLocal(maintenant, f);
  const a = (heure: number, jour = aujourdhui) => instantLocal(jour, heure, 0, f);

  // Elle attend une réponse : ça passe avant tout modèle.
  const attend =
    c.derniere_entree_le !== null &&
    (c.derniere_sortie_le === null ||
      Date.parse(c.derniere_entree_le) > Date.parse(c.derniere_sortie_le));
  const heureOuverte = maintenant >= a(DEBUT_REPONSES) && maintenant < a(FIN_REPONSES);

  // Annulé par l'agent : plus aucun modèle. On lui répond encore (sa raison),
  // puis la conversation se ferme.
  if (c.annulee_par_agent_le) {
    if (attend) return heureOuverte ? [{ genre: "repondre" }] : [];
    return maintenant >= Date.parse(c.annulee_par_agent_le) + ATTENTE_RAISON_MS ? [{ genre: "clore_annulee" }] : [];
  }

  if (maintenant >= Date.parse(c.rdv_fin)) return [{ genre: "terminer" }];

  if (attend) return heureOuverte ? [{ genre: "repondre" }] : [];

  if (maintenant >= debut) return [];

  const deja = new Set(c.envois.map((e) => e.cle_envoi));

  if (!deja.has("reservation")) {
    return [{ genre: "envoyer", modele: "reservation", cle: "reservation" }];
  }

  const jourRdv = jourLocal(debut, f);
  const veille = ajouterJours(jourRdv, -1);
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

  // ------------- Avant la veille : rappels à dates fixes, contenu entre -------
  //
  // Rythme décidé par Louis le 27/09/2026 : des rappels à J-14, J-7 et J-3
  // tant qu'elle n'a pas confirmé, seulement J-3 une fois confirmé ; entre
  // deux points (réservation, rappels, veille), un contenu au milieu. Un
  // message par jour au plus : un passage qui a déjà envoyé aujourd'hui attend
  // demain.

  if (c.envois.some((e) => jourLocal(e.le, f) === aujourdhui)) return [];

  const reservation = c.envois.find((e) => e.cle_envoi === "reservation");
  const jourReserve = jourLocal(reservation?.le ?? c.reserve_le, f);
  const jalons = (c.confirme_le ? JALONS_CONFIRMEE : JALONS)
    .map((n) => ajouterJours(jourRdv, -n))
    .filter((j) => j > jourReserve && j < veille)
    .sort();
  const points = [jourReserve, ...jalons, veille];

  // Le rappel du dernier jalon atteint, s'il n'est pas parti (rattrapé tant
  // que le point suivant n'est pas là).
  const jalonAtteint = jalons.filter((j) => j <= aujourdhui).at(-1);
  if (jalonAtteint && !deja.has(`rappel:${jalonAtteint}`)) {
    return [{ genre: "envoyer", modele: "rappel", cle: `rappel:${jalonAtteint}` }];
  }

  for (let i = 0; i < points.length - 1; i++) {
    const [de, suivant] = [points[i], points[i + 1]];
    const ecart = joursEntre(de, suivant);
    if (ecart < 2) continue;
    const jour = ajouterJours(de, Math.floor(ecart / 2));
    if (aujourdhui >= jour && aujourdhui < suivant && !deja.has(`contenu:${jour}`)) {
      return [{ genre: "envoyer", modele: "contenu", cle: `contenu:${jour}` }];
    }
  }
  return [];
}
