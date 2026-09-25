/**
 * Ce qui change d'un client à l'autre : sa marque, ses modèles de messages,
 * la façon de lire son formulaire de réservation.
 *
 * Dans le code plutôt qu'en base : ces textes sont validés par Meta et par
 * Louis, ils se relisent dans une revue et gardent leur historique. La table
 * `agent_reglages` ne porte que la clé du profil.
 */

export const MODELES = ["reservation", "rappel", "preparation", "veille", "matin"] as const;
export type CleModele = (typeof MODELES)[number];

export const FACONS = ["fonce", "analyse", "pas_a_pas", "accompagnee"] as const;
export type FaconDeDecider = (typeof FACONS)[number];

/** Ce qu'un bouton veut dire, quel que soit son libellé. */
export type SensBouton = "confirme" | "changer";

export type VariableModele = "prenom" | "jour" | "heure" | "lienVisio";

export type Modele = {
  /** Le texte soumis à Meta, variables en `{{1}}`, `{{2}}`… */
  corps: string;
  /** Ce que vaut `{{1}}`, `{{2}}`… dans l'ordre. */
  variables: VariableModele[];
  boutons: { texte: string; sens: SensBouton }[];
};

export type Profil = {
  cle: string;
  /** Le nom de celle ou celui au nom de qui l'agent écrit. */
  marque: string;
  /** Le pied commun des modèles : il dit que c'est une IA. */
  pied: string;
  /** Reconnaître une question du formulaire à son libellé. */
  questions: {
    telephone: RegExp;
    faconDeDecider: RegExp;
  };
  faconsDeDecider: { facon: FaconDeDecider; motif: RegExp }[];
  modeles: Record<CleModele, Modele>;
  /** Durée du rendez-vous suivi, pour la simulation. */
  dureeMinutes: number;
  /**
   * Le formulaire de réservation tel que la simulation le remplit, avec des
   * réponses d'exemple que Louis modifie avant de lancer.
   */
  formulaire: { question: string; exemple: string; choix?: string[] }[];
  /** Les réponses fixes qui ne passent pas par l'IA. */
  textes: { stop: string };
};

export type ValeursModele = Record<VariableModele, string>;

/** Le texte tel qu'elle le lira, variables remplacées. */
export function rendreModele(modele: Modele, valeurs: ValeursModele): string {
  return modele.corps.replace(/\{\{(\d+)\}\}/g, (tout, rang: string) => {
    const variable = modele.variables[Number(rang) - 1];
    return variable ? valeurs[variable] : tout;
  });
}
