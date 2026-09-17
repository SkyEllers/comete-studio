import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireToolAccess } from "@/lib/access";

/**
 * Garde d'Horizon : membre de l'organisation ET outil activé pour elle, sinon
 * 404 — y compris pour Louis, qui dans un espace client voit ce que le client
 * voit.
 */
export default async function HorizonLayout({
  children,
  params,
}: LayoutProps<"/app/[orgSlug]/finances">) {
  const { orgSlug } = await params;
  await requireToolAccess(orgSlug, "finances");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl">Horizon</h1>
          <p className="text-muted-foreground text-sm">
            Ton argent, mois par mois : ce qui entre, ce qui sort, ce qui est mis de côté.
          </p>
        </div>

        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/${orgSlug}`} prefetch>
            Tes outils
          </Link>
        </Button>
      </div>

      {children}
    </div>
  );
}
