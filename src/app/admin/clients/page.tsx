import { Building2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { DeletedToast } from "@/app/admin/clients/deleted-toast";
import { NewClientDialog } from "@/app/admin/clients/new-client-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { TableSkeleton } from "@/components/app/skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Sous la garde du layout : peut passer en flux sans risque pour le statut. */
async function ClientsTable() {
  const supabase = await createClient();

  // Trois lectures simples plutôt qu'une jointure agrégée : à cette échelle
  // c'est aussi rapide, et le typage reste évident.
  const [{ data: organizations }, { data: memberships }, { data: orgTools }] =
    await Promise.all([
      supabase
        .from("organizations")
        .select("id, name, slug, created_at")
        .order("name"),
      supabase.from("memberships").select("organization_id"),
      supabase
        .from("organization_tools")
        .select("organization_id")
        .eq("enabled", true),
    ]);

  const orgs = organizations ?? [];

  if (orgs.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Aucun client pour l'instant."
        description="Crée le premier, tu pourras ensuite y inviter quelqu'un."
      />
    );
  }

  const memberCount = new Map<string, number>();
  for (const m of memberships ?? []) {
    memberCount.set(
      m.organization_id,
      (memberCount.get(m.organization_id) ?? 0) + 1,
    );
  }
  const toolCount = new Map<string, number>();
  for (const t of orgTools ?? []) {
    toolCount.set(t.organization_id, (toolCount.get(t.organization_id) ?? 0) + 1);
  }

  return (
    <div className="border-line overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nom</TableHead>
            <TableHead>Identifiant</TableHead>
            <TableHead className="text-right">Membres</TableHead>
            <TableHead className="text-right">Outils activés</TableHead>
            <TableHead className="text-right">Créé le</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.map((org) => (
            <TableRow key={org.id}>
              <TableCell>
                <Link
                  href={`/admin/clients/${org.id}`}
                  prefetch
                  className="hover:text-ember font-medium transition-colors"
                >
                  {org.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-xs">
                {org.slug}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {memberCount.get(org.id) ?? 0}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {toolCount.get(org.id) ?? 0}
              </TableCell>
              <TableCell className="text-muted-foreground text-right font-mono text-xs">
                {dateFormat.format(new Date(org.created_at))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function AdminClientsPage({
  searchParams,
}: PageProps<"/admin/clients">) {
  const params = await searchParams;
  const supprime = typeof params.supprime === "string" ? params.supprime : null;

  return (
    <>
      {supprime ? <DeletedToast slug={supprime} /> : null}

      <PageHeader
        title="Clients"
        description="Une organisation par client. Chacune a ses membres et ses outils."
        action={<NewClientDialog />}
      />

      <Suspense fallback={<TableSkeleton />}>
        <ClientsTable />
      </Suspense>
    </>
  );
}
