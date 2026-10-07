import { ChevronRight, UsersRound } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Closeuses — une carte par closeuse, tous clients confondus (Louis,
 * 07/10/2026). Un clic ouvre son espace tel qu'elle le voit
 * (`/app/<client>/closeuse?c=<id>`, `requireCloseuse` laisse entrer l'admin).
 * Remplace le profil de test du 06/10.
 */

export const metadata = { title: "Closeuses — Comète Studio" };

const depuis = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

export default async function CloseusesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: lignes } = await supabase
    .from("radar_closeuses")
    .select("organization_id, user_id, created_at")
    .order("created_at");
  const closeuses = lignes ?? [];
  const ids = closeuses.map((c) => c.user_id);

  const [{ data: profils }, { data: orgs }, { data: aVenir }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", ids),
    supabase
      .from("organizations")
      .select("id, name, slug")
      .in(
        "id",
        closeuses.map((c) => c.organization_id),
      ),
    supabase
      .from("radar_bookings")
      .select("organization_id, closeuse_id")
      .in("closeuse_id", ids)
      .eq("status", "confirme")
      .gte("scheduled_start", new Date().toISOString()),
  ]);

  const cartes = closeuses.flatMap((c) => {
    const org = orgs?.find((o) => o.id === c.organization_id);
    if (!org) return [];
    const profil = profils?.find((p) => p.id === c.user_id);
    const nb = (aVenir ?? []).filter((r) => r.organization_id === c.organization_id && r.closeuse_id === c.user_id).length;
    return [
      {
        cle: `${c.organization_id}:${c.user_id}`,
        href: `/app/${org.slug}/closeuse?c=${c.user_id}`,
        nom: profil?.full_name || profil?.email || "Closeuse",
        email: profil?.email ?? "",
        client: org.name,
        depuis: c.created_at,
        nb,
      },
    ];
  });

  return (
    <>
      <PageHeader title="Closeuses" description="Clique sur une closeuse : tu vois son espace exactement comme elle le voit." />
      {cartes.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cartes.map((c) => (
            <li key={c.cle}>
              <Link
                href={c.href}
                prefetch={false}
                className="border-line bg-card hover:border-ember group flex h-full flex-col gap-1 rounded-lg border p-5 transition-colors"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-lg">{c.nom}</span>
                  <ChevronRight aria-hidden="true" className="text-muted-foreground group-hover:text-ember size-4 shrink-0" />
                </span>
                <span className="text-muted-foreground text-sm">
                  Chez {c.client}, depuis le {depuis.format(new Date(c.depuis))}
                </span>
                {c.email ? <span className="text-muted-foreground truncate text-xs">{c.email}</span> : null}
                <span className="mt-2 text-sm">{c.nb === 0 ? "Aucun rendez-vous à venir" : `${c.nb} rendez-vous à venir`}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={UsersRound} title="Aucune closeuse pour l'instant." description="Elles apparaissent ici dès qu'un client en a une." />
      )}
      <p className="text-muted-foreground mt-6 text-xs">
        Dans son espace, tes clics comptent pour de vrai : un résultat noté, un dépôt ou un devis envoyé partent comme si elle l&apos;avait fait.
      </p>
    </>
  );
}
