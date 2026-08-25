import { ArrowUpRight, Building2, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Ton espace — Comète Studio",
};

/**
 * Aiguillage à l'entrée. La RLS fait le tri : un client ne voit que ses
 * organisations, Louis les voit toutes.
 */
export default async function AppPage() {
  const { profile } = await requireUser();

  const supabase = await createClient();
  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .order("name");

  const orgs = organizations ?? [];

  if (orgs.length === 1) redirect(`/app/${orgs[0].slug}`);

  const user = {
    name: profile.full_name,
    email: profile.email,
    isAdmin: profile.is_admin,
  };

  if (orgs.length === 0) {
    return (
      <AppShell user={user}>
        <EmptyState
          icon={Building2}
          title="Aucun espace ne t'est encore attribué."
          description="Contacte Louis, il t'ouvrira l'accès."
          action={
            profile.is_admin ? (
              <Button asChild variant="outline">
                <Link href="/admin">
                  <ShieldCheck aria-hidden="true" />
                  Administration
                </Link>
              </Button>
            ) : undefined
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <PageHeader
        title="Tes espaces"
        description="Choisis le client dont tu veux ouvrir l'espace."
        action={
          profile.is_admin ? (
            <Button asChild variant="outline">
              <Link href="/admin">
                <ShieldCheck aria-hidden="true" />
                Administration
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {orgs.map((org) => (
          <Link
            key={org.id}
            href={`/app/${org.slug}`}
            className="group border-line bg-surface-1 hover:bg-surface-2 focus-visible:ring-ring block rounded-lg border p-5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <Building2
                aria-hidden="true"
                className="text-ember size-5 shrink-0"
                strokeWidth={1.75}
              />
              <ArrowUpRight
                aria-hidden="true"
                className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
              />
            </div>
            <p className="font-display mt-4 font-semibold">{org.name}</p>
            <p className="text-muted-foreground mt-1 font-mono text-xs">
              {org.slug}
            </p>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
