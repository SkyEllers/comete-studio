/** Formes partagées entre le chargement serveur et les composants. */

export type FolderSummary = {
  id: string;
  name: string;
  fileCount: number;
  totalBytes: number;
  /** Déjà formaté côté serveur : un calcul côté navigateur divergerait. */
  updatedLabel: string;
};

export type FileRow = {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  authorName: string;
  createdLabel: string;
  /** L'utilisateur peut-il supprimer ce fichier (auteur, responsable, Louis) ? */
  canDelete: boolean;
  /** Lien signé vers la vignette, quand le fichier en a une. */
  thumbUrl?: string;
};

export type Mediatheque = {
  folders: FolderSummary[];
  rootFiles: FileRow[];
  /** Somme des fichiers `ready` du client, dossiers compris. */
  usedBytes: number;
  fileCount: number;
};

export type FolderContents = {
  folder: { id: string; name: string };
  files: FileRow[];
  /** Toutes les destinations possibles pour « Déplacer vers ». */
  dossiers: { id: string; name: string }[];
  canDelete: boolean;
};
