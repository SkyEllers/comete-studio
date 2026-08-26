import { requireToolAccess } from "@/lib/access";

/**
 * Garde de l'outil. L'outil doit être actif au catalogue ET activé pour cette
 * organisation, sinon 404 — y compris pour Louis : dans un espace client, il
 * voit ce que le client voit.
 */
export default async function FichiersLayout({
  children,
  params,
}: LayoutProps<"/app/[orgSlug]/fichiers">) {
  const { orgSlug } = await params;
  await requireToolAccess(orgSlug, "fichiers");

  return children;
}
