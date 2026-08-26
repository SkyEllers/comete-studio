/**
 * Mémoire des envois interrompus.
 *
 * TUS sait reprendre un envoi : il garde l'URL du transfert en cours, retrouvée
 * par une empreinte du fichier. Mais l'empreinte ne dit rien de *notre* ligne
 * `files` — sans ce carnet, reprendre écrirait dans l'objet d'origine tout en
 * créant une nouvelle ligne, et les deux ne se retrouveraient jamais.
 *
 * Un navigateur ne peut pas garder un fichier d'une visite à l'autre : reprendre
 * demande toujours de resélectionner le même fichier. Ce carnet fait le reste.
 */
const CLE = "comete:fichiers:reprises";
const DUREE = 24 * 60 * 60 * 1000;

export type Reprise = {
  fileId: string;
  folderId: string | null;
  nom: string;
  taille: number;
  date: number;
};

/**
 * Ce qui identifie un fichier d'une visite à l'autre. `lastModified` en fait
 * partie : deux photos du même nom et de la même taille restent distinctes.
 */
export function empreinte(
  orgSlug: string,
  folderId: string | null,
  fichier: File,
): string {
  return [
    "comete",
    orgSlug,
    folderId ?? "racine",
    fichier.name,
    fichier.size,
    fichier.lastModified,
  ].join(":");
}

function lire(): Record<string, Reprise> {
  try {
    const brut = localStorage.getItem(CLE);
    return brut ? (JSON.parse(brut) as Record<string, Reprise>) : {};
  } catch {
    // Navigation privée, stockage plein, cookies refusés : on sait faire sans.
    return {};
  }
}

function ecrire(table: Record<string, Reprise>) {
  try {
    localStorage.setItem(CLE, JSON.stringify(table));
  } catch {
    // Tant pis : on perd la reprise, jamais l'envoi.
  }
}

export function memoriser(cle: string, reprise: Omit<Reprise, "date">) {
  const table = lire();
  table[cle] = { ...reprise, date: Date.now() };
  ecrire(table);
}

/** Au passage, on oublie ce qui a plus de 24 h — comme la base. */
export function retrouver(cle: string): Reprise | null {
  const table = lire();
  const limite = Date.now() - DUREE;

  let purge = false;
  for (const [autre, reprise] of Object.entries(table)) {
    if (reprise.date < limite) {
      delete table[autre];
      purge = true;
    }
  }
  if (purge) ecrire(table);

  return table[cle] ?? null;
}

export function oublier(cle: string) {
  const table = lire();
  if (!(cle in table)) return;
  delete table[cle];
  ecrire(table);
}
