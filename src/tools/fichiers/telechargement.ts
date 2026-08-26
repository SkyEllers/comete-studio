"use client";

import { downloadZip } from "client-zip";

/**
 * Télécharger, à l'unité ou par lot.
 *
 * Un zip se construit en flux : les fichiers sont lus les uns après les autres
 * et écrits au fur et à mesure, jamais tous en mémoire. Quand le navigateur
 * sait ouvrir un fichier en écriture (`showSaveFilePicker`, Chrome et Edge),
 * le flux va droit sur le disque et la taille n'a plus de limite. Sinon on
 * garde le zip en mémoire, ce qui n'est raisonnable qu'en deçà de 500 Mo :
 * au-delà, mieux vaut des téléchargements successifs qu'un onglet qui meurt.
 */
const PLAFOND_MEMOIRE = 500 * 1024 * 1024;

export type Fichier = { id: string; nom: string; url: string };

type Poignee = {
  createWritable: () => Promise<WritableStream<Uint8Array>>;
};

type FenetreAvecPicker = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<Poignee>;
};

/** Un lien invisible qu'on clique : c'est ce qui déclenche un téléchargement. */
export function declencher(url: string, nom?: string) {
  const lien = document.createElement("a");
  lien.href = url;
  if (nom) lien.download = nom;
  lien.rel = "noopener";
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
}

/** Deux fichiers du même nom dans un zip : le second devient « nom (2).ext ». */
function nomsUniques(fichiers: Fichier[]): Fichier[] {
  const vus = new Map<string, number>();

  return fichiers.map((fichier) => {
    const rang = vus.get(fichier.nom) ?? 0;
    vus.set(fichier.nom, rang + 1);
    if (rang === 0) return fichier;

    const point = fichier.nom.lastIndexOf(".");
    const base = point > 0 ? fichier.nom.slice(0, point) : fichier.nom;
    const extension = point > 0 ? fichier.nom.slice(point) : "";

    return { ...fichier, nom: `${base} (${rang + 1})${extension}` };
  });
}

export type Avancement = {
  faits: number;
  total: number;
  /** `null` tant qu'on ne sait pas si l'on zippe ou si l'on télécharge un à un. */
  mode: "zip" | "un-par-un" | null;
};

export async function telechargerLot(
  fichiers: Fichier[],
  nomArchive: string,
  poidsTotal: number,
  avancer: (etat: Avancement) => void,
): Promise<void> {
  const uniques = nomsUniques(fichiers);
  const fenetre = window as FenetreAvecPicker;

  let poignee: Poignee | null = null;
  if (typeof fenetre.showSaveFilePicker === "function") {
    // Refuser la fenêtre d'enregistrement, c'est annuler : on n'enchaîne pas
    // sur un repli que personne n'a demandé.
    poignee = await fenetre.showSaveFilePicker({
      suggestedName: `${nomArchive}.zip`,
      types: [{ description: "Archive zip", accept: { "application/zip": [".zip"] } }],
    });
  }

  if (!poignee && poidsTotal > PLAFOND_MEMOIRE) {
    avancer({ faits: 0, total: uniques.length, mode: "un-par-un" });

    for (const [rang, fichier] of uniques.entries()) {
      declencher(fichier.url, fichier.nom);
      avancer({ faits: rang + 1, total: uniques.length, mode: "un-par-un" });
      // Un souffle entre deux : les navigateurs bloquent les rafales.
      await new Promise((suite) => setTimeout(suite, 400));
    }
    return;
  }

  avancer({ faits: 0, total: uniques.length, mode: "zip" });

  /*
   * Un générateur, pas un tableau de promesses : chaque fichier n'est demandé
   * qu'au moment où le zip a fini d'avaler le précédent, et sa réponse est
   * consommée en flux. Un dossier de vingt gigaoctets ne passe jamais en
   * entier par la mémoire.
   */
  async function* entrees() {
    for (const [rang, fichier] of uniques.entries()) {
      const reponse = await fetch(fichier.url);
      if (!reponse.ok) throw new Error(`téléchargement de ${fichier.nom}`);

      yield { name: fichier.nom, input: reponse };
      avancer({ faits: rang + 1, total: uniques.length, mode: "zip" });
    }
  }

  const zip = downloadZip(entrees());

  if (poignee) {
    const sortie = await poignee.createWritable();
    await zip.body!.pipeTo(sortie);
    return;
  }

  const blob = await zip.blob();
  const url = URL.createObjectURL(blob);
  declencher(url, `${nomArchive}.zip`);
  // Laisser au navigateur le temps de saisir le blob avant de le libérer.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
