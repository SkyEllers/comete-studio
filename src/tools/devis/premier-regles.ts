import { heureEnMots, jourEnMots } from "../agent/temps.ts";

import { euros, instantEnMots, investigationSeule, microbioteSeul } from "./regles.ts";

/**
 * Le premier rendez-vous avec Peggy, après un devis payé (Louis, 07/10/2026).
 * Avant, la cliente qui payait tombait sur « l'équipe de Peggy revient vers
 * toi » et personne n'était prévenu. Maintenant : au paiement, un mail à
 * Peggy (de quoi envoyer le kit) et un à la cliente (le lien pour réserver) ;
 * la page merci montre les créneaux de Peggy ; 24 h sans réservation, un
 * rappel à la cliente et un mail à Peggy ; la veille, un rappel.
 *
 * Tout ici est pur : la durée, les règles d'horloge, les textes (passés par
 * humaniseur-fr le 07/10/2026). Testé dans premier-regles.test.ts.
 */

export type DevisPaye = {
  prenom: string;
  nom: string | null;
  email: string;
  telephone: string | null;
  adresse: string | null;
  objet: string | null;
  duree_mois: number;
  paiement: "une_fois" | "plusieurs";
  investigation_cents: number;
  mensualite_cents: number;
  total_cents: number;
  paye_le: string | null;
};

/** 30 minutes ; 15 pour un bilan microbiote seul, ce que son devis promet (Louis, 07/10/2026). */
export function dureePremier(d: Pick<DevisPaye, "investigation_cents">): number {
  return microbioteSeul({ investigationCents: d.investigation_cents }) ? 15 : 30;
}

/** « Accompagnement 9 mois, en 9 fois », « Investigation seule », « Bilan microbiote seul, en 2 fois ». */
export function formuleEnMots(d: Pick<DevisPaye, "duree_mois" | "paiement" | "investigation_cents" | "mensualite_cents">): string {
  if (microbioteSeul({ investigationCents: d.investigation_cents })) {
    return d.paiement === "plusieurs" ? "Bilan microbiote seul, en 2 fois" : "Bilan microbiote seul, en une fois";
  }
  if (investigationSeule({ mensualiteCents: d.mensualite_cents })) return "Investigation seule";
  return d.paiement === "plusieurs"
    ? `Accompagnement ${d.duree_mois} mois, en ${d.duree_mois} fois`
    : `Accompagnement ${d.duree_mois} mois, en une fois`;
}

/** Ce qu'elle a payé aujourd'hui : le premier paiement en plusieurs fois, tout sinon. */
export function premierPaiementCents(
  d: Pick<DevisPaye, "paiement" | "duree_mois" | "investigation_cents" | "mensualite_cents" | "total_cents">,
): number {
  if (d.paiement !== "plusieurs") return d.total_cents;
  return d.investigation_cents + d.mensualite_cents;
}

export function nomCliente(d: Pick<DevisPaye, "prenom" | "nom">): string {
  return [d.prenom?.trim(), d.nom?.trim()].filter(Boolean).join(" ") || "une cliente";
}

const JOUR = 86_400_000;

/**
 * Le rappel à la cliente qui a payé sans réserver : 24 h après le paiement,
 * une fois. Pas pour un devis payé il y a plus d'une semaine (les ventes
 * d'avant le premier rendez-vous en ligne ne reçoivent rien d'un coup).
 */
export function rappelSansRdvDu(
  d: { paye_le: string | null; premier_rappel_le: string | null },
  aUnRdv: boolean,
  maintenant: number,
): boolean {
  if (!d.paye_le || d.premier_rappel_le || aUnRdv) return false;
  const depuis = maintenant - Date.parse(d.paye_le);
  return depuis >= JOUR && depuis < 7 * JOUR;
}

/**
 * Le rappel de la veille d'un premier rendez-vous : le jour d'avant, à partir
 * de 17 h (heure de Paris), comme le mail des diagnostics du lendemain. Pas
 * s'il a été pris après 17 h la veille : la confirmation vient de partir.
 */
export function rappelVeilleDu(
  r: { debut: string; created_at: string; rappel_le: string | null },
  maintenant: number,
  fuseau = "Europe/Paris",
): boolean {
  if (r.rappel_le) return false;
  const debut = Date.parse(r.debut);
  if (debut <= maintenant) return false;
  if (jourDe(debut, fuseau) !== jourDe(maintenant + JOUR, fuseau)) return false;
  if (heureDe(maintenant, fuseau) < 17) return false;
  const prisLe = Date.parse(r.created_at);
  const prisCeSoir = jourDe(prisLe, fuseau) === jourDe(maintenant, fuseau) && heureDe(prisLe, fuseau) >= 17;
  return !prisCeSoir;
}

function jourDe(instant: number, fuseau: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuseau }).format(new Date(instant));
}

function heureDe(instant: number, fuseau: string): number {
  // `format` rend « 19 h » en français : on lit la seule partie « heure ».
  const parties = new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(instant));
  return Number(parties.find((p) => p.type === "hour")?.value ?? "0");
}

// ------------------------------ Les textes ----------------------------------

export type Mail = { sujet: string; texte: string; html: string };

function echapper(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mail(sujet: string, paragraphes: string[][]): Mail {
  const texte = paragraphes.map((p) => p.join("\n")).join("\n\n") + "\n";
  const html = paragraphes.map((p) => `<p>${p.map(echapper).join("<br>")}</p>`).join("\n");
  return { sujet, texte, html };
}

/** Qui elle est, ce qu'elle a pris, où envoyer le kit. */
function fiche(d: DevisPaye, closeuse: string | null): string[] {
  return [
    `Formule : ${formuleEnMots(d)} (${euros(d.total_cents)} en tout)`,
    d.objet ? `Ce qu'elle veut : « ${d.objet.trim()} »` : null,
    d.telephone ? `Téléphone : ${d.telephone}` : null,
    `Email : ${d.email}`,
    d.adresse ? `Adresse pour le kit : ${d.adresse.replace(/\s*\n\s*/g, ", ")}` : null,
    closeuse ? `Vendu par : ${closeuse}` : null,
  ].filter((l): l is string => l !== null);
}

/** Au paiement, à Peggy. */
export function mailPayePeggy(d: DevisPaye, closeuse: string | null): Mail {
  const qui = nomCliente(d);
  return mail(`Nouvelle cliente : ${qui}, ${formuleEnMots(d).split(",")[0].toLowerCase()}`, [
    [
      `${qui} vient de payer son devis : ${euros(premierPaiementCents(d))} aujourd'hui.`,
      `Elle a reçu un lien pour réserver son premier rendez-vous avec toi (${dureePremier(d)} min). Tu auras un autre mail dès qu'elle aura choisi son créneau.`,
    ],
    fiche(d, closeuse),
  ]);
}

/** 24 h après le paiement, sans rendez-vous, à Peggy. */
export function mailSansRdvPeggy(d: DevisPaye): Mail {
  const qui = nomCliente(d);
  const prenom = d.prenom?.trim() || qui;
  return mail(`${prenom} n'a pas encore réservé son premier rendez-vous`, [
    [
      `${qui} a payé le ${d.paye_le ? instantEnMots(d.paye_le) : "?"} et n'a pas encore choisi son premier rendez-vous avec toi.`,
      "Un rappel vient de lui partir par mail. Tu peux aussi l'appeler.",
    ],
    [d.telephone ? `Téléphone : ${d.telephone}` : null, `Email : ${d.email}`].filter((l): l is string => l !== null),
  ]);
}

/** À la réservation, ou quand elle déplace, à Peggy. */
export function mailRdvPeggy(
  d: DevisPaye,
  rdv: { debut: string; fin: string; lienVisio: string | null },
  type: "nouveau" | "deplace",
  closeuse: string | null,
  fuseau = "Europe/Paris",
): Mail {
  const qui = nomCliente(d);
  const prenom = d.prenom?.trim() || qui;
  const quand = `${jourEnMots(rdv.debut, fuseau)} à ${heureEnMots(rdv.debut, fuseau)}`;
  const minutes = Math.round((Date.parse(rdv.fin) - Date.parse(rdv.debut)) / 60_000);
  const sujet = type === "nouveau" ? `Premier rendez-vous : ${prenom}, ${quand}` : `Premier rendez-vous déplacé : ${prenom}, ${quand}`;
  const phrase =
    type === "nouveau"
      ? `${qui} a réservé son premier rendez-vous avec toi, ${quand} (${minutes} min). Il est dans ton agenda.`
      : `${qui} a déplacé son premier rendez-vous au ${quand} (${minutes} min). Ton agenda est à jour.`;
  return mail(sujet, [[phrase], fiche(d, closeuse), ...(rdv.lienVisio ? [[`Visio : ${rdv.lienVisio}`]] : [])]);
}

/** Le titre et la description de l'événement, dans l'agenda de Peggy. */
export function evenementPremier(d: DevisPaye, closeuse: string | null): { titre: string; description: string } {
  return {
    titre: `Premier rendez-vous · ${d.prenom?.trim() || "une cliente"}`,
    description: [`Premier rendez-vous de ${nomCliente(d)}, après son devis payé.`, "", ...fiche(d, closeuse)].join("\n"),
  };
}
