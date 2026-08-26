import { requireToolAccess } from "@/lib/access";
import { FichiersProvider } from "@/tools/fichiers/upload-context";
import { UploadPanel } from "@/tools/fichiers/upload-panel";

/**
 * Garde de l'outil. L'outil doit être actif au catalogue ET activé pour cette
 * organisation, sinon 404 — y compris pour Louis : dans un espace client, il
 * voit ce que le client voit.
 *
 * La file d'envoi est montée ici, pas dans les pages : passer de la racine à
 * un dossier ne doit pas interrompre un envoi en cours.
 */
export default async function FichiersLayout({
  children,
  params,
}: LayoutProps<"/app/[orgSlug]/fichiers">) {
  const { orgSlug } = await params;
  const { org, userId } = await requireToolAccess(orgSlug, "fichiers");

  return (
    <FichiersProvider
      orgSlug={orgSlug}
      organizationId={org.id}
      userId={userId}
    >
      {children}
      <UploadPanel />
    </FichiersProvider>
  );
}
