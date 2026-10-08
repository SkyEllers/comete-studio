/**
 * L'issue d'un diagnostic, telle que l'analyse la lit, et le moment de
 * (re)lancer l'analyse. Module pur, testé sans base.
 *
 * L'issue se lit dans Radar (vente, raison du non, absente), les devis
 * (signé, payé) et le R2 (0054). Elle peut changer après l'appel : un devis
 * signé trois jours plus tard, un R2 qui vend. Quand elle change, l'analyse
 * est refaite, pour que « pourquoi elle a dit oui » parle du bon oui.
 */

import type { Issue } from "./grille.ts";

export type FaitsIssue = {
  /** Le statut effectif du rendez-vous (`radar_bookings_effective`). */
  statut: string;
  venteCents: number | null;
  devisSigne: boolean;
  devisPaye: boolean;
  /** Le résultat du R2, s'il a été demandé : null tant que Peggy n'a pas rappelé. */
  r2: { resultat: "demarrer" | "reflechit" | "non" | null } | null;
  /** Le dernier motif « pas de vente » noté (non-vente.ts), ou null. */
  motif: string | null;
  declinee: boolean;
};

export type IssueLue = { issue: Issue; cle: string };

export function lireIssue(f: FaitsIssue): IssueLue {
  const r2 = f.r2 ? (f.r2.resultat ?? "attente") : "";
  const cle = (issue: Issue) => [issue, f.motif ?? "", r2, f.devisPaye ? "paye" : f.devisSigne ? "signe" : ""].join("|");

  if (f.venteCents != null || f.devisPaye || f.devisSigne) return { issue: "vente", cle: cle("vente") };
  if (f.r2) {
    if (f.r2.resultat === "non") return { issue: "non", cle: cle("non") };
    return { issue: "r2", cle: cle("r2") };
  }
  if (f.motif === "pas_encore") return { issue: "en_attente", cle: cle("en_attente") };
  if (f.motif || f.declinee) return { issue: "non", cle: cle("non") };
  return { issue: "inconnue", cle: cle("inconnue") };
}

export type EtatAnalyse = {
  etat: "a_faire" | "en_cours" | "faite" | "echec";
  issueCle: string | null;
  tentatives: number;
  commenceeLe: string | null;
  majLe: string;
};

/** Sans résultat noté, on attend deux jours avant d'analyser quand même. */
export const ATTENTE_SANS_ISSUE_MS = 48 * 3_600_000;
/** Une analyse « en cours » depuis plus longtemps a été coupée : on la reprend. */
export const EN_COURS_PERIME_MS = 15 * 60_000;
/** Trois essais ratés, une heure entre chaque, puis on laisse Louis relancer. */
export const ESSAIS_MAX = 3;
export const ENTRE_ESSAIS_MS = 3_600_000;

/**
 * Faut-il (re)lancer l'analyse de ce rendez-vous ? La transcription doit être
 * faite ; ensuite, une première analyse dès que le résultat est noté (ou deux
 * jours après le rendez-vous), puis une nouvelle chaque fois que l'issue
 * change.
 */
export function aAnalyser(args: {
  transcriptionFaite: boolean;
  /**
   * Quand la transcription a été rangée. Un enregistrement remplacé (le bon
   * fichier, l'appel complet) donne une transcription plus récente que
   * l'analyse : on la refait (Louis, 08/10/2026).
   */
  transcriptionLe?: string | null;
  statut: string;
  issue: IssueLue;
  finRdv: string;
  analyse: EtatAnalyse | null;
  maintenant: number;
}): boolean {
  const { transcriptionFaite, transcriptionLe, statut, issue, finRdv, analyse, maintenant } = args;
  if (!transcriptionFaite) return false;
  if (statut === "annule" || statut === "no_show") return false;

  if (analyse && (analyse.etat === "faite" || analyse.etat === "echec") && transcriptionLe) {
    const lue = Date.parse(analyse.commenceeLe ?? analyse.majLe);
    if (Number.isFinite(lue) && Date.parse(transcriptionLe) > lue) return true;
  }

  const fin = Date.parse(finRdv);
  const assezAttendu = Number.isFinite(fin) && maintenant - fin >= ATTENTE_SANS_ISSUE_MS;

  if (!analyse) return issue.issue !== "inconnue" || assezAttendu;

  switch (analyse.etat) {
    case "a_faire":
      return true;
    case "en_cours": {
      const depuis = analyse.commenceeLe ? Date.parse(analyse.commenceeLe) : 0;
      return maintenant - depuis >= EN_COURS_PERIME_MS;
    }
    case "echec":
      return analyse.tentatives < ESSAIS_MAX && maintenant - Date.parse(analyse.majLe) >= ENTRE_ESSAIS_MS;
    case "faite":
      return issue.issue !== "inconnue" && analyse.issueCle !== issue.cle;
  }
}

/** Lundi, heure de Paris, après 6h, et pas encore de synthèse aujourd'hui ; ou jamais de synthèse. */
export function syntheseDue(derniere: string | null, nouvelles: number, maintenant: Date): boolean {
  if (nouvelles === 0) return false;
  if (!derniere) return true;
  const parties = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Paris" })
    .formatToParts(maintenant);
  const jour = parties.find((p) => p.type === "weekday")?.value;
  const heure = Number(parties.find((p) => p.type === "hour")?.value ?? "0");
  const jourParis = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
  return jour === "Mon" && heure >= 6 && jourParis(new Date(derniere)) !== jourParis(maintenant);
}
