/**
 * Le mail de la veille (P12, « Le résumé pour Peggy avant son Zoom ») : un
 * seul mail à 17h, les diagnostics du lendemain, trois lignes chacun. Peggy
 * prépare ses rendez-vous la veille (P16, Louis, 28/09/2026 : il remplace le
 * mail de 8h). Ce qui se réserve après 17h pour le lendemain, elle le voit
 * dans son agenda Google. Lecture facultative : s'il n'est pas ouvert, rien
 * ne casse.
 *
 * Ce fichier ne fait que l'écrire. Il se teste sans base.
 */

import { FUSEAU_COACH, heureEnMots, jourEnMots } from "./temps.ts";

export const HEURE_DU_RESUME = 17;

export type DiagnosticDuJour = {
  rdv_debut: string;
  prenom: string;
  fuseau: string;
  etat: string;
  confirme_le: string | null;
  reports_agent: number;
  deplace: boolean;
  sans_reponse_veille: boolean;
  simulation: boolean;
  /** Ce qu'elle a dit à l'agent, tel que l'agent l'a noté pour la coach. */
  notes: string[];
  /** La closeuse qui tient ce rendez-vous dans Radar ; null : le client. */
  closeuse_id?: string | null;
  /**
   * Pourquoi l'assistante ne lui écrit pas, quand elle ne lui écrit pas
   * (05/10/2026 : « réservé moins de 24 h avant » s'affichait aussi pour celles
   * qu'on ne pouvait pas joindre).
   */
  raison_hors_champ?: RaisonHorsChamp;
};

export type RaisonHorsChamp = "trop_proche" | "sans_numero" | "whatsapp_refuse";

/** Pourquoi une conversation est hors champ, d'après ce qu'elle garde. */
export function raisonHorsChamp(c: {
  reserve_le: string;
  rdv_debut: string;
  telephone: string | null;
}): RaisonHorsChamp {
  if (Date.parse(c.rdv_debut) - Date.parse(c.reserve_le) < 24 * 3_600_000) return "trop_proche";
  return c.telephone ? "whatsapp_refuse" : "sans_numero";
}

const HORS_CHAMP: Record<RaisonHorsChamp, string> = {
  trop_proche: "Réservé moins de 24 h avant : l'assistante ne lui a pas écrit.",
  sans_numero: "Aucun numéro WhatsApp : l'assistante n'a pas pu lui écrire. À joindre par mail.",
  whatsapp_refuse: "WhatsApp refuse son numéro : l'assistante n'a pas pu lui écrire. À appeler.",
};

/** Où en est son rendez-vous, en une phrase. */
export function etatEnMots(d: DiagnosticDuJour): string {
  if (d.etat === "sans_suivi") return "Pas suivie par l'assistante WhatsApp.";
  if (d.etat === "hors_champ") return HORS_CHAMP[d.raison_hors_champ ?? "trop_proche"];
  if (d.etat === "stop") return "Elle a demandé à ne plus recevoir de messages. Le rendez-vous tient.";
  const suite = d.confirme_le
    ? "confirmé"
    : d.sans_reponse_veille
      ? "sans réponse au rappel de la veille. Le lien de la visio lui part le matin"
      : "pas encore confirmé";
  const phrase = d.reports_agent > 0 || d.deplace ? `reporté, puis ${suite}` : suite;
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

/** Ses notes, dédoublonnées, en une ligne. */
export function notesEnMots(notes: string[]): string {
  const propres = [...new Set(notes.map((n) => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  if (propres.length === 0) return "rien de particulier.";
  const phrase = propres.map((n) => (/[.!?…]$/.test(n) ? n : `${n}.`)).join(" ");
  // Minuscule après les deux-points, sauf un sigle (« IMC »).
  return /^\p{Lu}\p{Ll}/u.test(phrase) ? phrase.charAt(0).toLowerCase() + phrase.slice(1) : phrase;
}

/**
 * L'heure à Paris, celle de l'agenda de Peggy ; celle de la cliente en plus
 * quand elle diffère (05/10/2026 : le mail donnait l'heure de la cliente).
 */
function heurePourLaCoach(d: DiagnosticDuJour): string {
  const aParis = heureEnMots(d.rdv_debut, FUSEAU_COACH);
  const chezElle = heureEnMots(d.rdv_debut, d.fuseau);
  return chezElle === aParis ? aParis : `${aParis} (${chezElle} chez elle)`;
}

export function blocDuDiagnostic(d: DiagnosticDuJour): string[] {
  return [
    `${heurePourLaCoach(d)} · ${d.prenom}${d.simulation ? " (simulation)" : ""}`,
    `Ce qu'elle a dit : ${notesEnMots(d.notes)}`,
    etatEnMots(d),
  ];
}

function echapper(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Le mail. `jour` est le jour des diagnostics (le lendemain de l'envoi).
 * Rien quand la journée est vide : un mail pour dire « rien »,
 * c'est un mail de trop.
 */
export function mailDuResume(q: {
  jour: string;
  fuseau: string;
  diagnostics: DiagnosticDuJour[];
  test?: boolean;
  /** À l'envoi de test : pour qui ce mail serait parti (« Johanna »). */
  pour?: string;
}): { sujet: string; texte: string; html: string } | null {
  if (q.diagnostics.length === 0) return null;

  const n = q.diagnostics.length;
  // Midi, pour que le jour ne glisse pas d'un fuseau à l'autre.
  const date = jourEnMots(`${q.jour}T12:00:00Z`, q.fuseau);
  const prefixe = q.test ? (q.pour ? `[Test pour ${q.pour}] ` : "[Test] ") : "";
  const sujet = `${prefixe}${n === 1 ? "Ton diagnostic" : `Tes ${n} diagnostics`} de demain, ${date}`;
  const intro = `Demain, ${n === 1 ? "1 diagnostic" : `${n} diagnostics`} :`;
  const pied =
    "Rien à faire de ton côté. C'est juste pour que tu saches, avant chaque visio, où elle en est. Un rendez-vous pris après 17h pour demain n'y est pas : il est dans ton agenda.";

  const blocs = [...q.diagnostics]
    .sort((a, b) => Date.parse(a.rdv_debut) - Date.parse(b.rdv_debut))
    .map(blocDuDiagnostic);

  const texte = ["Bonjour,", "", intro, "", ...blocs.flatMap((b) => [...b, ""]), pied, ""].join("\n");
  const html = [
    "<p>Bonjour,</p>",
    `<p>${echapper(intro)}</p>`,
    ...blocs.map(
      ([titre, dit, etat]) =>
        `<p><strong>${echapper(titre)}</strong><br>${echapper(dit)}<br>${echapper(etat)}</p>`,
    ),
    `<p style="color:#666">${echapper(pied)}</p>`,
  ].join("\n");

  return { sujet, texte, html };
}
