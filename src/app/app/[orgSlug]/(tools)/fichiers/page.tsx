import { ArrowLeft, FolderOpen } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { CardGridSkeleton } from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { ZoneDepot } from "@/tools/fichiers/drop-zone";
import { FileList } from "@/tools/fichiers/file-list";
import { FolderTile } from "@/tools/fichiers/folder-tile";
import { compteFichiers, tailleLisible } from "@/tools/fichiers/format";
import { NewFolderDialog } from "@/tools/fichiers/new-folder-dialog";
import { getMediatheque } from "@/tools/fichiers/queries";

export const VIDE =
  "Aucun fichier pour le moment. Glisse tes photos et vidéos ici, ou appuie sur Déposer.";

/**
 * Sous la garde du layout (`requireToolAccess`) et sous `requireMembership` :
 * cette partie peut passer en flux, le statut de la réponse est déjà décidé.
 */
async function Contenu({
  organizationId,
  orgSlug,
  userId,
  peutToutSupprimer,
}: {
  organizationId: string;
  orgSlug: string;
  userId: string;
  peutToutSupprimer: boolean;
}) {
  const { folders, rootFiles, usedBytes, fileCount } = await getMediatheque(
    organizationId,
    userId,
    peutToutSupprimer,
  );

  const vide = folders.length === 0 && rootFiles.length === 0;

  return (
    <>
      <p className="text-muted-foreground mb-6 font-mono text-xs">
        {compteFichiers(fileCount)}
        {fileCount > 0 ? ` · ${tailleLisible(usedBytes)}` : ""}
      </p>

      {vide ? (
        <EmptyState icon={FolderOpen} title="Ta médiathèque est vide." description={VIDE} />
      ) : null}

      {folders.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => (
            <FolderTile key={folder.id} folder={folder} orgSlug={orgSlug} />
          ))}
        </div>
      ) : null}

      {rootFiles.length > 0 ? (
        <section className={folders.length > 0 ? "mt-10" : ""}>
          {folders.length > 0 ? (
            <h2 className="text-muted-foreground mb-3 text-sm">
              Hors dossier
            </h2>
          ) : null}
          <FileList files={rootFiles} orgSlug={orgSlug} folderId={null} />
        </section>
      ) : null}
    </>
  );
}

export default async function FichiersPage({
  params,
}: PageProps<"/app/[orgSlug]/fichiers">) {
  const { orgSlug } = await params;
  // Garde hors `<Suspense>` : c'est elle qui décide du statut de la réponse.
  const { org, userId, role } = await requireMembership(orgSlug);

  return (
    <>
      <PageHeader
        title="Fichiers"
        description="Tes photos, vidéos et documents, conservés en qualité d'origine."
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}`} prefetch>
                <ArrowLeft aria-hidden="true" />
                Tes outils
              </Link>
            </Button>
            <NewFolderDialog orgSlug={orgSlug} />
            <ZoneDepot folderId={null} />
          </div>
        }
      />

      <Suspense fallback={<CardGridSkeleton />}>
        <Contenu
          organizationId={org.id}
          orgSlug={orgSlug}
          userId={userId}
          peutToutSupprimer={role === "owner" || role === "admin"}
        />
      </Suspense>
    </>
  );
}
