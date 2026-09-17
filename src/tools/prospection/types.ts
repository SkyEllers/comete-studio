/**
 * Prospection — ce que Louis regarde avant de relancer.
 *
 * Les fiches vivent dans le vault (`20-prospects/`), poussées ici par le script
 * `prospects-vers-hub.mjs`. Cette page n'invente rien : elle range, elle trie,
 * et elle garde la trace de ce que Louis a fait.
 */

export type LigneHistorique = { date: string; canal: string; texte: string };
export type Lien = { libelle: string; url: string };

export type Suivi = {
  video_filmee_le: string | null;
  relance_envoyee_le: string | null;
  relance_type: "video" | "mail" | null;
  reponse_le: string | null;
  reponse: string | null;
  classe: boolean;
};

export type Prospect = {
  slug: string;
  nom: string;
  metier: string | null;
  ville: string | null;
  statut: string;
  source: string | null;
  canal: string | null;
  contact: string | null;
  contacte_le: string | null;
  relance_le: string | null;
  question: string | null;
  note: number | null;
  avis_google: number | null;
  message_titre: string | null;
  message: string | null;
  note_detail: string | null;
  video: string | null;
  tri_rapide: string | null;
  historique: LigneHistorique[];
  liens: Lien[];
  maj_vault: string | null;
  suivi: Suivi | null;
};

/** Ce qu'on fait de ce prospect à sa relance : une vidéo, ou un mail court. */
export type Forme = "video" | "mail";

/** Où il tombe dans la page « À relancer ». */
export type Groupe =
  | "retard"
  | "aujourdhui"
  | "semaine"
  | "plus-tard"
  | "sans-date"
  | "faite";

export const LIBELLE_GROUPE: Record<Groupe, string> = {
  retard: "En retard",
  aujourdhui: "Aujourd'hui",
  semaine: "Cette semaine",
  "plus-tard": "Plus tard",
  "sans-date": "Sans date de relance",
  faite: "Relances envoyées",
};

export const ORDRE_GROUPES: Groupe[] = [
  "retard",
  "aujourdhui",
  "semaine",
  "plus-tard",
  "sans-date",
  "faite",
];
