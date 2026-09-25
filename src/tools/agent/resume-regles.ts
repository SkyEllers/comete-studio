/**
 * Le mail du matin (P12, « Le résumé pour Peggy avant son Zoom ») : un seul
 * mail à 8h, les diagnostics de la journée, trois lignes chacun. Lecture
 * facultative : s'il n'est pas ouvert, rien ne casse.
 *
 * Ce fichier ne fait que l'écrire. Il se teste sans base.
 */

import { heureEnMots, jourEnMots } from "./temps.ts";

export const HEURE_DU_RESUME = 8;

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
};

/** Où en est son rendez-vous, en une phrase. */
export function etatEnMots(d: DiagnosticDuJour): string {
  if (d.etat === "hors_champ") return "Réservé moins de 24 h avant : l'assistante ne lui a pas écrit.";
  if (d.etat === "stop") return "Elle a demandé à ne plus recevoir de messages. Le rendez-vous tient.";
  const suite = d.confirme_le
    ? "confirmé"
    : d.sans_reponse_veille
      ? "sans réponse depuis la veille. Le lien Zoom lui part ce matin"
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

export function blocDuDiagnostic(d: DiagnosticDuJour): string[] {
  return [
    `${heureEnMots(d.rdv_debut, d.fuseau)} · ${d.prenom}${d.simulation ? " (simulation)" : ""}`,
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
 * Le mail. Rien quand la journée est vide : un mail pour dire « rien »,
 * c'est un mail de trop.
 */
export function mailDuResume(q: {
  jour: string;
  fuseau: string;
  diagnostics: DiagnosticDuJour[];
  test?: boolean;
}): { sujet: string; texte: string; html: string } | null {
  if (q.diagnostics.length === 0) return null;

  const n = q.diagnostics.length;
  // Midi, pour que le jour ne glisse pas d'un fuseau à l'autre.
  const date = jourEnMots(`${q.jour}T12:00:00Z`, q.fuseau);
  const prefixe = q.test ? "[Test] " : "";
  const sujet = `${prefixe}${n === 1 ? "Ton diagnostic" : `Tes ${n} diagnostics`} du ${date}`;
  const intro = `Aujourd'hui, ${n === 1 ? "1 diagnostic" : `${n} diagnostics`} :`;
  const pied = "Rien à faire de ton côté. C'est juste pour que tu saches, avant chaque Zoom, où elle en est.";

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
