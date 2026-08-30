/**
 * Le vocabulaire de Sas, partagé par le serveur et le navigateur.
 *
 * Une destination dit tout ce qu'il faut savoir pour ranger une idée : dans
 * quel univers elle tombe, et dans quelle boîte. Les quatre cas sont
 * exhaustifs — c'est ce qui permet à l'écran de vérification de n'avoir aucun
 * état intermédiaire indécidable au moment d'enregistrer.
 */

export type Boite = { id: string; name: string };

export type Destination =
  /** Perso : jamais de boîte, la base le refuserait. */
  | { type: "perso" }
  /** Pro sans boîte : la pile « À ranger ». */
  | { type: "aranger" }
  /** Pro, dans une boîte qui existe déjà. */
  | { type: "boite"; boiteId: string }
  /** Pro, dans une boîte à créer au moment d'enregistrer. */
  | { type: "nouvelle"; nom: string };

/**
 * Une idée en attente de validation. Elle ne vit que dans l'écran de
 * vérification : rien de tout ça n'est en base tant que Louis n'a pas validé.
 *
 * `cle` est locale à l'écran (React en a besoin pour suivre les cartes) et ne
 * part jamais au serveur. `destination` à `null` est l'état du mode manuel :
 * aucune destination proposée, à Louis de choisir.
 */
export type IdeeProposee = {
  cle: string;
  texte: string;
  destination: Destination | null;
  /** L'IA doute, ou propose une boîte inconnue : la carte ressort en ambre. */
  incertain: boolean;
};

/** Ce que renvoie le classement : les idées, et par quel chemin on les a eues. */
export type Classement = {
  mode: "ia" | "manuel";
  idees: IdeeProposee[];
};

export const LIMITE_CAPTURE = 10_000;
export const LIMITE_IDEE = 2_000;
export const LIMITE_NOM_BOITE = 60;
