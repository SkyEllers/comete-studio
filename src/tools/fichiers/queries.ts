import "server-only";

import { tempsRelatif } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import type { FileRow, FolderContents, FolderSummary, Mediatheque } from "./types";

/**
 * Lectures de la médiathèque, à travers la RLS de l'utilisateur courant : si
 * l'outil est coupé pour l'organisation, ces requêtes ne renvoient rien.
 *
 * Seuls les fichiers `ready` sont montrés. Un envoi en cours vit dans la file
 * du panneau de dépôt, pas dans la liste — une ligne à moitié écrite n'a rien
 * à faire au milieu des autres.
 */

const CHAMPS_FICHIER =
  "id, name, size_bytes, mime_type, width, height, duration_seconds, created_at, uploaded_by, profiles (full_name, email)";

type LigneBrute = {
  id: string;
  name: string;
  size_bytes: number;
  mime_type: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string;
  uploaded_by: string | null;
  profiles: { full_name: string; email: string } | null;
};

/** Qui peut retirer ce fichier : son auteur, un responsable du client, Louis. */
function versFichier(
  ligne: LigneBrute,
  maintenant: Date,
  userId: string,
  peutToutSupprimer: boolean,
): FileRow {
  return {
    id: ligne.id,
    name: ligne.name,
    sizeBytes: ligne.size_bytes,
    mimeType: ligne.mime_type,
    width: ligne.width,
    height: ligne.height,
    durationSeconds: ligne.duration_seconds,
    authorName: ligne.profiles?.full_name || ligne.profiles?.email || "—",
    createdLabel: tempsRelatif(ligne.created_at, maintenant),
    canDelete: peutToutSupprimer || ligne.uploaded_by === userId,
  };
}

const parDateDecroissante = (a: { created_at: string }, b: { created_at: string }) =>
  b.created_at.localeCompare(a.created_at);

/**
 * La racine : les dossiers avec leur poids, les fichiers qui ne sont dans
 * aucun dossier, et l'espace occupé par le client.
 *
 * Deux requêtes. Les dossiers ne rapportent que la taille de leurs fichiers,
 * pas leurs noms : de quoi compter et peser sans transporter la médiathèque
 * entière. L'espace total se déduit de ces deux lectures, sans troisième.
 */
export async function getMediatheque(
  organizationId: string,
  userId: string,
  peutToutSupprimer: boolean,
): Promise<Mediatheque> {
  const supabase = await createClient();

  const [dossiers, racine] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name, updated_at, files (size_bytes, status)")
      .eq("organization_id", organizationId)
      .order("name"),
    supabase
      .from("files")
      .select(CHAMPS_FICHIER)
      .eq("organization_id", organizationId)
      .eq("status", "ready")
      .is("folder_id", null)
      .order("created_at", { ascending: false }),
  ]);

  const maintenant = new Date();
  let usedBytes = 0;
  let fileCount = 0;

  const folders: FolderSummary[] = (dossiers.data ?? []).map((dossier) => {
    const prets = (dossier.files ?? []).filter((f) => f.status === "ready");
    const totalBytes = prets.reduce((somme, f) => somme + f.size_bytes, 0);

    usedBytes += totalBytes;
    fileCount += prets.length;

    return {
      id: dossier.id,
      name: dossier.name,
      fileCount: prets.length,
      totalBytes,
      updatedLabel: tempsRelatif(dossier.updated_at, maintenant),
    };
  });

  const brutes = (racine.data ?? []) as LigneBrute[];
  for (const ligne of brutes) {
    usedBytes += ligne.size_bytes;
    fileCount += 1;
  }

  return {
    folders,
    rootFiles: brutes
      .slice()
      .sort(parDateDecroissante)
      .map((ligne) => versFichier(ligne, maintenant, userId, peutToutSupprimer)),
    usedBytes,
    fileCount,
  };
}

/**
 * Le contenu d'un dossier. Renvoie `null` si le dossier n'existe pas, s'il
 * appartient à un autre client, ou si la RLS le cache : la page répond alors
 * 404 sans distinguer ces cas.
 */
export async function getFolderContents(
  organizationId: string,
  folderId: string,
  userId: string,
  peutToutSupprimer: boolean,
): Promise<FolderContents | null> {
  const supabase = await createClient();

  const [dossier, fichiers] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name, created_by")
      .eq("id", folderId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("files")
      .select(CHAMPS_FICHIER)
      .eq("organization_id", organizationId)
      .eq("status", "ready")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: false }),
  ]);

  if (!dossier.data) return null;

  const maintenant = new Date();

  return {
    folder: { id: dossier.data.id, name: dossier.data.name },
    files: ((fichiers.data ?? []) as LigneBrute[]).map((ligne) =>
      versFichier(ligne, maintenant, userId, peutToutSupprimer),
    ),
    canDelete: peutToutSupprimer || dossier.data.created_by === userId,
  };
}
