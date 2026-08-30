import { requireToolAccess } from "@/lib/access";

/**
 * Garde de l'outil : membre de l'organisation ET Sas activé pour elle, sinon
 * 404 — y compris pour Louis, qui dans un espace client voit ce que le client
 * voit.
 */
export default async function SasLayout({
  children,
  params,
}: LayoutProps<"/app/[orgSlug]/sas">) {
  const { orgSlug } = await params;
  await requireToolAccess(orgSlug, "sas");

  return children;
}
