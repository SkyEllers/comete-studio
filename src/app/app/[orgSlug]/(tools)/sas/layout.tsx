import { requireToolAccess } from "@/lib/access";
import { NavBasse } from "@/tools/sas/nav";

/**
 * Garde de l'outil : membre de l'organisation ET Sas activé pour elle, sinon
 * 404 — y compris pour Louis, qui dans un espace client voit ce que le client
 * voit.
 *
 * La barre du bas est fixée : elle sort du flux, et sans le `pb-16` le dernier
 * élément de chaque liste finirait dessous. Sur grand écran elle disparaît, et
 * la marge avec elle.
 */
export default async function SasLayout({
  children,
  params,
}: LayoutProps<"/app/[orgSlug]/sas">) {
  const { orgSlug } = await params;
  await requireToolAccess(orgSlug, "sas");

  return (
    <div className="mx-auto w-full max-w-3xl pb-16 sm:pb-0">
      {children}
      <NavBasse orgSlug={orgSlug} />
    </div>
  );
}
