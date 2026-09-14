/**
 * L'appel de la veille : ce que le client a noté, et ce que ça donne.
 *
 * Certains clients appellent chaque personne la veille de son rendez-vous pour
 * qu'elle le valide. La réponse se note dans Radar (`radar_note_appel`) et vit
 * dans les activités, comme « pas de vente » : la dernière fait foi. Ce module
 * ne fait que lire — il est pur, et c'est ce qui le rend testable sans base.
 */

export type ReponseAppel = "confirme" | "sans_reponse";

const PAR_TYPE: Record<string, ReponseAppel> = {
  "call.confirmed": "confirme",
  "call.no_answer": "sans_reponse",
};

export const TYPES_APPEL = Object.keys(PAR_TYPE);

export const LIBELLES_APPEL: Record<ReponseAppel, string> = {
  confirme: "A confirmé",
  sans_reponse: "Sans réponse",
};

/** La dernière réponse notée pour un rendez-vous, ou null s'il n'y en a pas. */
export function derniereReponse(
  activites: { type: string; created_at: string }[],
): ReponseAppel | null {
  let retenue: { type: string; created_at: string } | null = null;
  for (const activite of activites) {
    if (!(activite.type in PAR_TYPE)) continue;
    if (!retenue || Date.parse(activite.created_at) > Date.parse(retenue.created_at)) {
      retenue = activite;
    }
  }
  return retenue ? PAR_TYPE[retenue.type] : null;
}

/** La dernière réponse de chaque rendez-vous, à partir d'activités mêlées. */
export function reponsesParRendezVous(
  activites: { booking_id: string; type: string; created_at: string }[],
): Record<string, ReponseAppel> {
  const groupees = new Map<string, { type: string; created_at: string }[]>();
  for (const activite of activites) {
    groupees.set(activite.booking_id, [...(groupees.get(activite.booking_id) ?? []), activite]);
  }

  const reponses: Record<string, ReponseAppel> = {};
  for (const [id, liste] of groupees) {
    const reponse = derniereReponse(liste);
    if (reponse) reponses[id] = reponse;
  }
  return reponses;
}

export type IssuesAppel = {
  total: number;
  venues: number;
  nonVenues: number;
  annulees: number;
  aVenir: number;
};

export type BilanAppel = Record<ReponseAppel, IssuesAppel>;

const vide = (): IssuesAppel => ({ total: 0, venues: 0, nonVenues: 0, annulees: 0, aVenir: 0 });

/**
 * Ce que le test lit : parmi les personnes sans réponse à l'appel, combien sont
 * venues. Et, à côté, la même chose pour celles qui avaient confirmé.
 *
 * « Venue » veut dire `honore` au sens de la vue : une séance passée et non
 * contestée. Une absente jamais marquée « non venue » compte donc comme venue
 * — c'est la limite de Radar, et c'est pourquoi l'écran demande de la marquer.
 */
export function bilanAppel(
  reponses: Record<string, ReponseAppel>,
  rendezVous: { id: string; effective_status: string }[],
): BilanAppel {
  const bilan: BilanAppel = { confirme: vide(), sans_reponse: vide() };

  for (const rdv of rendezVous) {
    const reponse = reponses[rdv.id];
    if (!reponse) continue;

    const issues = bilan[reponse];
    issues.total += 1;
    if (rdv.effective_status === "honore") issues.venues += 1;
    else if (rdv.effective_status === "no_show") issues.nonVenues += 1;
    else if (rdv.effective_status === "annule") issues.annulees += 1;
    else issues.aVenir += 1;
  }

  return bilan;
}
