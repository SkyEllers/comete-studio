import { requireToolAccess } from "@/lib/access";

/**
 * Garde de l'outil : membre de l'organisation ET Radar activé pour elle,
 * sinon 404 — y compris pour Louis, qui dans un espace client voit ce que le
 * client voit.
 */
export default async function RadarLayout({
  children,
  params,
}: LayoutProps<"/app/[orgSlug]/resultats">) {
  const { orgSlug } = await params;
  await requireToolAccess(orgSlug, "resultats");

  return children;
}
