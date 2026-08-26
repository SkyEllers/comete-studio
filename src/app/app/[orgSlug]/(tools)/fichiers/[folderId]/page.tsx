import { ArrowLeft, FolderOpen } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { ZoneDepot } from "@/tools/fichiers/drop-zone";
import { FileList } from "@/tools/fichiers/file-list";
import { compteFichiers, tailleLisible } from "@/tools/fichiers/format";
import { getFolderContents } from "@/tools/fichiers/queries";

import { VIDE } from "../page";

export default async function DossierPage({
  params,
}: PageProps<"/app/[orgSlug]/fichiers/[folderId]">) {
  const { orgSlug, folderId } = await params;
  const { org, userId, role } = await requireMembership(orgSlug);

  const contenu = await getFolderContents(
    org.id,
    folderId,
    userId,
    role === "owner" || role === "admin",
  );

  // Dossier inconnu, ou appartenant à un autre client : même réponse.
  if (!contenu) notFound();

  const total = contenu.files.reduce((somme, f) => somme + f.sizeBytes, 0);

  return (
    <>
      {/* Fil d'Ariane : on sait toujours d'où l'on vient. */}
      <nav aria-label="Fil d'Ariane" className="mb-4">
        <Link
          href={`/app/${orgSlug}/fichiers`}
          prefetch
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Fichiers
        </Link>
      </nav>

      <PageHeader
        title={contenu.folder.name}
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}/fichiers`} prefetch>
                Tous les dossiers
              </Link>
            </Button>
            <ZoneDepot folderId={folderId} />
          </div>
        }
      />

      <p className="text-muted-foreground mb-6 font-mono text-xs">
        {compteFichiers(contenu.files.length)}
        {contenu.files.length > 0 ? ` · ${tailleLisible(total)}` : ""}
      </p>

      {contenu.files.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Ce dossier est vide." description={VIDE} />
      ) : (
        <FileList
          files={contenu.files}
          orgSlug={orgSlug}
          folderId={contenu.folder.id}
        />
      )}
    </>
  );
}
