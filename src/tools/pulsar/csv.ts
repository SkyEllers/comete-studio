import { libelleTache, type Entree, type Phase } from "./types.ts";

/**
 * L'export des entrées, pour le jour où Pulsar ne suffit plus.
 *
 * C'est la porte de sortie promise par le brief : pas de facturation, pas de
 * rapport PDF — un CSV et un autre outil. Elle doit donc être complète et
 * sans surprise plutôt que jolie.
 *
 * Le format est celui des autres exports du hub : points-virgules, `\r\n`,
 * et un BOM posé par le navigateur au moment du téléchargement. Avec des
 * virgules, un Excel en français range toute la ligne dans une seule colonne
 * et l'on croit le fichier cassé.
 */

const echapper = (valeur: string) =>
  /[";\n]/.test(valeur) ? `"${valeur.replace(/"/g, '""')}"` : valeur;

const LIBELLE_PHASE: Record<Phase, string> = {
  setup: "Setup",
  pilotage: "Pilotage",
  interne: "Interne",
};

export type LigneExport = {
  jour: string;
  client: string;
  entree: Pick<Entree, "task" | "phase" | "duration_minutes" | "note">;
};

/**
 * Les six colonnes du brief : date, client, type, phase, durée, note.
 *
 * La durée part en heures décimales — « 0,25 » pour un quart d'heure — et non
 * en minutes : c'est ce qu'attend une feuille de calcul qu'on multipliera par
 * un taux horaire, et toutes les valeurs tombent juste puisqu'elles sont des
 * quarts d'heure. La virgule décimale, pour la même raison que les
 * points-virgules.
 */
export function versCsv(lignes: LigneExport[]): string {
  const entete = ["Date", "Client", "Type", "Phase", "Durée (h)", "Note"];

  const corps = lignes.map((ligne) =>
    [
      ligne.jour,
      ligne.client,
      libelleTache(ligne.entree.task),
      LIBELLE_PHASE[ligne.entree.phase],
      ((ligne.entree.duration_minutes ?? 0) / 60).toFixed(2).replace(".", ","),
      ligne.entree.note ?? "",
    ]
      .map(echapper)
      .join(";"),
  );

  return [entete.join(";"), ...corps].join("\r\n");
}

/** `pulsar-2026-01-01-au-2026-03-31.csv` */
export function nomDuFichier(depuis: string, jusqua: string): string {
  return `pulsar-${depuis}-au-${jusqua}`;
}
