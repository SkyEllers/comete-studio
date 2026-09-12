/**
 * Les mois vivent dans `lib/mois.ts` depuis que Pulsar compte les siens.
 *
 * Ré-exportés ici : c'est la porte par laquelle Radar les connaît — une
 * douzaine de fichiers — et les renommer n'apprendrait rien à personne. Le
 * raisonnement du fichier d'origine n'a pas bougé : un mois est une date, le
 * premier jour, en heure de Paris ; c'est la base qui tranche, et ces
 * fonctions ne font que nommer et enchaîner ces dates.
 */
export {
  libelleMois,
  moisAOffrir,
  moisCourant,
  moisDemande,
  moisPrecedent,
  moisSuivant,
  nomDuMois,
} from "../../lib/mois.ts";
