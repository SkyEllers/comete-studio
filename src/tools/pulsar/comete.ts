import { formatDuree } from "./duree.ts";
import { encaisseDuMois, tauxHoraire } from "./revenus.ts";
import type { Entree, FicheClient, Profil } from "./types.ts";

/**
 * Le mois vu du studio, et non plus client par client.
 *
 * Une seule question : quelle part de mon temps se vend ? Tout le reste en
 * découle — le taux moyen de l'activité, la répartition par profil, et la
 * ligne de prospection qui dit ce que coûte le fait de chercher du travail.
 *
 * Le non facturable n'est pas une perte, et l'écran ne le dit jamais comme
 * ça : administrer et prospecter sont le métier autant que livrer. Ce qu'on
 * mesure, c'est la proportion — un mois à 28 % de non facturable se lit
 * autrement qu'un mois à 60 %, et sans ce chiffre on ne sait ni l'un ni
 * l'autre.
 */

export type PartProfil = { profil: Profil | null; minutes: number };

export type VueComete = {
  minutesFacturables: number;
  minutesNonFacturables: number;
  /** La part du non facturable, en pourcentage entier du temps compté. */
  partNonFacturable: number;
  encaisseCents: number;
  /** Encaissé total ÷ heures facturables. `null` sans heures facturables. */
  tauxMoyenCents: number | null;
  parProfil: PartProfil[];
  minutesProspection: number;
};

/** L'ordre des profils à l'écran. `null` ferme la marche : c'est un oubli. */
const ORDRE_PROFILS: (Profil | null)[] = ["p1", "p2", "p3", "hors_cible", null];

/**
 * Le mois du studio.
 *
 * Le partage facturable / non facturable se lit sur le client, pas sur le type
 * de tâche : une réunion pour Peggy est facturable, une réunion pour Comète ne
 * l'est pas, et c'est bien le même type de tâche. C'est pour ça que le client
 * interne existe.
 */
export function vueComete(
  clients: FicheClient[],
  entrees: Entree[],
  mois: string,
): VueComete {
  const interne = new Set(
    clients.filter((client) => client.is_internal).map((client) => client.id),
  );
  const profils = new Map(clients.map((client) => [client.id, client.profil]));

  let minutesFacturables = 0;
  let minutesNonFacturables = 0;
  let minutesProspection = 0;
  const parProfil = new Map<Profil | null, number>();

  for (const entree of entrees) {
    const minutes = entree.duration_minutes ?? 0;
    if (minutes === 0) continue;

    if (entree.task === "prospection") minutesProspection += minutes;

    if (interne.has(entree.client_id)) {
      minutesNonFacturables += minutes;
      continue;
    }

    minutesFacturables += minutes;

    const profil = profils.get(entree.client_id) ?? null;
    parProfil.set(profil, (parProfil.get(profil) ?? 0) + minutes);
  }

  const total = minutesFacturables + minutesNonFacturables;

  const encaisseCents = clients.reduce(
    (somme, client) => somme + encaisseDuMois(client, mois),
    0,
  );

  return {
    minutesFacturables,
    minutesNonFacturables,
    partNonFacturable: total === 0 ? 0 : Math.round((minutesNonFacturables / total) * 100),
    encaisseCents,
    tauxMoyenCents: tauxHoraire(encaisseCents, minutesFacturables),
    /*
     * Les cinq seaux sont toujours là, même vides : un profil à zéro heure ce
     * mois-ci est une information — c'est une cible qu'on ne sert pas.
     */
    parProfil: ORDRE_PROFILS.map((profil) => ({
      profil,
      minutes: parProfil.get(profil) ?? 0,
    })),
    minutesProspection,
  };
}

/**
 * La comparaison avec le mois d'avant, en toutes lettres.
 *
 * « 2 h de plus qu'en août » plutôt qu'un « +2 h » qui demande de deviner par
 * rapport à quoi — c'est la règle des tuiles de Radar, et il n'y a pas de
 * raison de la dire autrement ici.
 *
 * `null` quand il n'y a rien à comparer : deux mois vides n'ont pas d'écart,
 * et une phrase qui dit « autant qu'en août » sous deux zéros est du bruit.
 */
export function ecart(
  courant: number,
  precedent: number,
  nomDuMoisPrecedent: string,
): string | null {
  if (courant === 0 && precedent === 0) return null;
  if (precedent === 0) return `rien en ${nomDuMoisPrecedent}`;
  if (courant === precedent) return `autant qu'en ${nomDuMoisPrecedent}`;

  const difference = Math.abs(courant - precedent);
  const sens = courant > precedent ? "de plus" : "de moins";

  return `${formatDuree(difference)} ${sens} qu'en ${nomDuMoisPrecedent}`;
}

/** Le même écart, en points de pourcentage. */
export function ecartPourcentage(
  courant: number,
  precedent: number,
  nomDuMoisPrecedent: string,
): string | null {
  if (courant === precedent) return null;

  const difference = Math.abs(courant - precedent);
  const sens = courant > precedent ? "de plus" : "de moins";

  return `${difference} point${difference > 1 ? "s" : ""} ${sens} qu'en ${nomDuMoisPrecedent}`;
}
