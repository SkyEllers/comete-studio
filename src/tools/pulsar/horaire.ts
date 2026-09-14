import {
  ecartJours,
  instantParis,
  jourParis,
  minutesParis,
} from "../../lib/dates.ts";

import { arrondirQuartHeure, formatDuree } from "./duree.ts";
import { MAXIMUM_MANUEL, MINIMUM_MINUTES, PAS_MINUTES, type Entree } from "./types.ts";

/**
 * Le début, la fin et la durée d'une entrée — et ce qu'il faut pour les
 * corriger sans jamais supprimer puis ressaisir.
 *
 * Les heures se comptent ici en minutes depuis le minuit du jour de l'entrée,
 * à Paris : 14 h 07, c'est 847. Une fin après minuit dépasse 1 440, et c'est
 * toute la gestion du lendemain. Rien de ce module ne fait d'arithmétique de
 * fuseau : `jourParis`, `minutesParis` et `instantParis` la font, une fois.
 *
 * Il sert deux fois, et c'est pour ça qu'il est pur : le formulaire s'en sert
 * pour lier les trois champs et dire ce qui cloche avant l'envoi ; l'action
 * s'en sert pour décider de ce qui s'écrit. Une règle dite deux fois finit
 * toujours par être dite de deux façons.
 */

const MINUTES_PAR_JOUR = 24 * 60;

/** « 14:07 » → 847. `null` pour tout ce qui n'est pas une heure. */
export function lireHeure(texte: string): number | null {
  const lu = /^(\d{2}):(\d{2})$/.exec(texte);
  if (!lu) return null;

  const heures = Number(lu[1]);
  const minutes = Number(lu[2]);
  if (heures > 23 || minutes > 59) return null;

  return heures * 60 + minutes;
}

/** 847 → « 14:07 ». Le lendemain se dit à côté : 1 455 → « 00:15 ». */
export function ecrireHeure(minutes: number): string {
  const dansLaJournee =
    ((minutes % MINUTES_PAR_JOUR) + MINUTES_PAR_JOUR) % MINUTES_PAR_JOUR;

  return `${String(Math.floor(dansLaJournee / 60)).padStart(2, "0")}:${String(dansLaJournee % 60).padStart(2, "0")}`;
}

export type Horaire = {
  jour: string;
  debut: number;
  /** `null` tant que le chronomètre tourne. */
  fin: number | null;
};

/** Le jour, le début et la fin d'une entrée, lus à Paris. */
export function horaireDe(entree: Pick<Entree, "started_at" | "ended_at">): Horaire {
  const jour = jourParis(entree.started_at);
  const debut = minutesParis(entree.started_at);

  if (entree.ended_at === null) return { jour, debut, fin: null };

  return {
    jour,
    debut,
    fin:
      ecartJours(jour, jourParis(entree.ended_at)) * MINUTES_PAR_JOUR +
      minutesParis(entree.ended_at),
  };
}

// ---------------------------- Les trois champs liés ---------------------------

export type Plage = { debut: number; fin: number; minutes: number };

/**
 * Le quart d'heure voisin, dans un sens : 14 h 07 → 14 h 15 ou 14 h 00.
 *
 * Les boutons avancent par quinze minutes, mais une heure réelle tombe
 * rarement pile : le premier appui la ramène sur la grille, les suivants la
 * parcourent. Sans ça, 14 h 07 ne donnerait jamais que 14 h 22, 14 h 37…
 */
export function cran(valeur: number, sens: 1 | -1): number {
  const reste = ((valeur % PAS_MINUTES) + PAS_MINUTES) % PAS_MINUTES;
  if (reste === 0) return valeur + sens * PAS_MINUTES;
  return sens === 1 ? valeur + (PAS_MINUTES - reste) : valeur - reste;
}

const compter = (debut: number, fin: number) =>
  arrondirQuartHeure((fin - debut) * 60_000);

/**
 * Le début bouge, la fin reste : « en vrai, j'ai commencé à 14 h ».
 *
 * La durée se recompte, arrondie comme au chronomètre. Si le nouveau début
 * passe la fin, c'est l'entrée entière qui glisse et garde sa durée — on
 * déplace une séance, on ne la retourne pas.
 */
export function avecDebut(plage: Plage, debut: number): Plage {
  if (plage.fin > debut) {
    return { debut, fin: plage.fin, minutes: compter(debut, plage.fin) };
  }
  return { debut, fin: debut + plage.minutes, minutes: plage.minutes };
}

/** La fin bouge, le début reste : « j'ai arrêté à 16 h ». */
export function avecFin(plage: Plage, fin: number): Plage {
  return { debut: plage.debut, fin, minutes: compter(plage.debut, fin) };
}

/**
 * Une fin tapée au clavier, entre 00:00 et 23:59.
 *
 * Tapée avant le début, c'est celle du lendemain : on a fini après minuit.
 * Les boutons, eux, ne passent jamais par ici — ils ne descendent pas sous le
 * début, et une fin qui recule ne doit pas sauter au jour suivant.
 */
export function avecFinTapee(plage: Plage, heure: number): Plage {
  return avecFin(plage, heure <= plage.debut ? heure + MINUTES_PAR_JOUR : heure);
}

/** La durée bouge, le début reste, la fin suit : « coupe à 45 min ». */
export function avecDuree(plage: Plage, minutes: number): Plage {
  return { debut: plage.debut, fin: plage.debut + minutes, minutes };
}

// ------------------------------ Ce qui s'écrit --------------------------------

export type Correction = {
  jour: string;
  debut: number;
  /** `null`, avec `minutes`, pour un chronomètre qu'on laisse tourner. */
  fin: number | null;
  minutes: number | null;
};

export type Ecriture = {
  started_at: string;
  ended_at?: string;
  duration_minutes?: number;
  is_manual: boolean;
};

type Resolution =
  | { ok: true; ecriture: Ecriture }
  | { ok: false; error: string; champ: "jour" | "debut" | "fin" | "minutes" };

const refus = (error: string, champ: "jour" | "debut" | "fin" | "minutes"): Resolution => ({
  ok: false,
  error,
  champ,
});

/**
 * Ce que devient une entrée corrigée — terminée, ou encore en marche.
 *
 * **Ouvrir puis enregistrer ne change rien.** Les écrans travaillent à la
 * minute ; la base garde les secondes. Un début ou une fin qu'on n'a pas
 * touchés gardent donc leur instant exact, et une entrée d'avant les règles
 * d'aujourd'hui — un chronomètre oublié vingt heures, une durée corrigée sans
 * sa fin — se laisse annoter sans qu'on lui oppose une règle qu'elle n'a
 * jamais eu à suivre. Les règles jugent ce qu'on déplace, pas ce qui était là.
 *
 * Pour un chronomètre en marche, deux gestes, qui se combinent :
 *
 * - avancer ou reculer son début, et le laisser tourner ;
 * - l'arrêter à la durée choisie. La fin enregistrée est alors le début plus
 *   ce qu'on a choisi, jamais plus tard que maintenant, et la durée ne peut
 *   dépasser ce qu'il a réellement tourné, arrondi : au-delà, on compterait
 *   des heures à l'avance.
 *
 * Une saisie sans heure — posée à midi par « Ajouter une heure » — le reste
 * tant qu'on ne lui donne pas un vrai début. Quand on le fait, elle quitte
 * « Saisie » et affiche son heure comme les autres.
 */
export function resoudreCorrection(
  stockee: Pick<Entree, "started_at" | "ended_at" | "duration_minutes" | "is_manual">,
  correction: Correction,
  maintenant: number,
): Resolution {
  const avant = horaireDe(stockee);
  const enCours = stockee.ended_at === null;

  if (correction.jour > jourParis(maintenant)) {
    return refus("On ne compte pas des heures à l'avance.", "jour");
  }

  const debutIntact =
    correction.jour === avant.jour && correction.debut === avant.debut;
  const started_at = debutIntact
    ? stockee.started_at
    : instantParis(correction.jour, correction.debut);
  const depart = Date.parse(started_at);

  if (!debutIntact && depart > maintenant) {
    return refus("Ce début tombe dans le futur.", "debut");
  }

  const is_manual = stockee.is_manual && correction.debut === avant.debut;

  if (correction.fin === null || correction.minutes === null) {
    if (!enCours) return refus("Une entrée terminée garde sa fin et sa durée.", "fin");
    return { ok: true, ecriture: { started_at, is_manual } };
  }

  const finIntacte =
    !enCours && correction.jour === avant.jour && correction.fin === avant.fin;
  const deplacee = !(debutIntact && finIntacte);

  if (deplacee) {
    if (correction.fin <= correction.debut) {
      return refus("La fin tombe avant le début.", "fin");
    }
    if (correction.fin - correction.debut > MAXIMUM_MANUEL) {
      return refus("Plus de 12 h d'un coup : coupe la saisie en deux.", "fin");
    }
  }

  if (
    correction.minutes !== stockee.duration_minutes &&
    correction.minutes > MAXIMUM_MANUEL
  ) {
    return refus("Plus de 12 h d'un coup : coupe la saisie en deux.", "minutes");
  }

  if (correction.minutes < MINIMUM_MINUTES) {
    return refus("Un quart d'heure au minimum.", "minutes");
  }

  if (enCours) {
    const tourne = arrondirQuartHeure(maintenant - depart);

    if (correction.minutes > tourne) {
      return refus(
        `Il a tourné ${formatDuree(tourne)} au plus : on ne compte pas des heures à l'avance.`,
        "minutes",
      );
    }

    const fin = Math.min(
      depart + (correction.fin - correction.debut) * 60_000,
      maintenant,
    );

    return {
      ok: true,
      ecriture: {
        started_at,
        ended_at: new Date(fin).toISOString(),
        duration_minutes: correction.minutes,
        is_manual,
      },
    };
  }

  const ended_at = finIntacte
    ? (stockee.ended_at as string)
    : instantParis(correction.jour, correction.fin);

  if (Date.parse(ended_at) < depart) {
    return refus("La fin tombe avant le début.", "fin");
  }

  return {
    ok: true,
    ecriture: {
      started_at,
      ended_at,
      duration_minutes: correction.minutes,
      is_manual,
    },
  };
}

/**
 * Ce qu'un chronomètre en marche peut compter au plus, si on l'arrête à ce
 * début-là : ce qu'il a tourné, arrondi. L'écran s'en sert pour borner ses
 * boutons ; l'action le revérifie dans `resoudreCorrection`.
 */
export function plafondDeCourse(
  stockee: Pick<Entree, "started_at" | "ended_at">,
  jour: string,
  debut: number,
  maintenant: number,
): number {
  const avant = horaireDe(stockee);
  const depart =
    jour === avant.jour && debut === avant.debut
      ? Date.parse(stockee.started_at)
      : Date.parse(instantParis(jour, debut));

  return Math.min(MAXIMUM_MANUEL, arrondirQuartHeure(maintenant - depart));
}
