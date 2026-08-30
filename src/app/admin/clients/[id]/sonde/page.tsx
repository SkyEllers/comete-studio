import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ClientTabs } from "@/components/admin/client-tabs";
import { TableSkeleton } from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSites } from "@/tools/sonde/queries";

import { SondeSites } from "./sonde-sites";

/**
 * L'onglet Sonde d'une fiche client : les pages suivies, et leurs balises.
 *
 * Une route à part plutôt qu'une section de plus sur la fiche : elle n'a rien
 * à faire là quand on vient renommer un client, et l'onglet ne s'affiche que
 * si l'outil est activé.
 */
export default async function AdminSondePage({
  params,
}: PageProps<"/admin/clients/[id]/sonde">) {
  const { id } = await params;
  await requireAdmin();

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("id", id)
    .maybeSingle();

  if (!org) notFound();

  const [{ data: sonde }, { data: radar }] = await Promise.all([
    supabase
      .from("organization_tools")
      .select("enabled, tools!inner(slug)")
      .eq("organization_id", org.id)
      .eq("tools.slug", "sonde")
      .maybeSingle(),
    supabase
      .from("organization_tools")
      .select("enabled, tools!inner(slug)")
      .eq("organization_id", org.id)
      .eq("tools.slug", "resultats")
      .maybeSingle(),
  ]);

  // L'outil coupé, l'onglet n'existe pas : on ne se laisse pas atteindre par
  // l'adresse non plus.
  if (!sonde?.enabled) notFound();

  return (
    <>
      <div className="mb-8 space-y-4">
        <Link
          href={`/admin/clients/${org.id}`}
          prefetch
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {org.name}
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl">Sonde</h1>
            <p className="text-muted-foreground text-sm">
              Les pages suivies de {org.name}, et la balise à poser sur chacune.
            </p>
          </div>

          <Button asChild variant="outline">
            <Link href={`/app/${org.slug}/sonde`} prefetch>
              <ExternalLink aria-hidden="true" />
              Voir son tableau de bord
            </Link>
          </Button>
        </div>
      </div>

      <ClientTabs
        organizationId={org.id}
        actif="sonde"
        radarActif={Boolean(radar?.enabled)}
        sondeActif
      />

      <section className="mt-8">
        <Suspense fallback={<TableSkeleton rows={2} />}>
          <Liste organizationId={org.id} />
        </Suspense>
      </section>
    </>
  );
}

async function Liste({ organizationId }: { organizationId: string }) {
  const sites = await getSites(organizationId);
  const origine = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cometestudio.fr";

  return (
    <SondeSites organizationId={organizationId} sites={sites} origine={origine} />
  );
}
