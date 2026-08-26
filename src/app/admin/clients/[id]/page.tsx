import {
  ArrowLeft,
  ExternalLink,
  HardDrive,
  Images,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  DangerZone,
  RenameForm,
  ToolSwitch,
} from "@/app/admin/clients/[id]/client-settings";
import {
  InviteMemberDialog,
  MemberActions,
} from "@/app/admin/clients/[id]/members-section";
import { Counter } from "@/components/admin/counter";
import { EmptyState } from "@/components/app/empty-state";
import {
  CountersSkeleton,
  TableSkeleton,
  ToolListSkeleton,
} from "@/components/app/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { tailleLisible } from "@/tools/fichiers/format";
import { getToolMeta } from "@/tools/registry";

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Ce que ce client occupe.
 *
 * Un seul aller-retour : `stats_fichiers` agrège en base plutôt que de faire
 * descendre une ligne par fichier pour les additionner ici. Elle est soumise à
 * la RLS de l'appelant, et Louis est admin — il voit donc bien ce client.
 */
async function StockageSection({ organizationId }: { organizationId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("stats_fichiers", {
    org: organizationId,
  });
  const stats = data?.[0] ?? { fichiers: 0, octets: 0 };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Counter
        icon={Images}
        label="Fichiers"
        value={stats.fichiers.toLocaleString("fr-FR")}
      />
      <Counter
        icon={HardDrive}
        label="Espace utilisé"
        value={tailleLisible(stats.octets)}
      />
    </div>
  );
}

/**
 * Section la plus lente de la page : `last_sign_in_at` vit dans auth.users et
 * demande un appel par membre. Elle passe en flux, sous le `notFound()` de la
 * page — le statut de la réponse est déjà décidé quand elle commence.
 */
async function MembersSection({ organizationId }: { organizationId: string }) {
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("memberships")
    .select("user_id, role, created_at, profiles (full_name, email)")
    .eq("organization_id", organizationId)
    .order("created_at");

  const members = memberships ?? [];

  if (members.length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title="Personne pour l'instant."
        description="Invite quelqu'un : il recevra un email pour choisir son mot de passe."
      />
    );
  }

  const admin = createAdminClient();
  const lastSignIn = new Map<string, string | null>();
  await Promise.all(
    members.map(async (member) => {
      const { data } = await admin.auth.admin.getUserById(member.user_id);
      lastSignIn.set(member.user_id, data.user?.last_sign_in_at ?? null);
    }),
  );

  return (
    <div className="border-line overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nom</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rôle</TableHead>
            <TableHead>Ajouté le</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const neverSignedIn = !lastSignIn.get(member.user_id);
            const name = member.profiles?.full_name || "—";
            return (
              <TableRow key={member.user_id}>
                <TableCell className="font-medium">
                  {name}
                  {neverSignedIn ? (
                    <Badge variant="secondary" className="ml-2">
                      jamais connecté
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {member.profiles?.email}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {member.role === "owner" ? "Responsable" : "Membre"}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {dateFormat.format(new Date(member.created_at))}
                </TableCell>
                <TableCell>
                  <MemberActions
                    organizationId={organizationId}
                    userId={member.user_id}
                    name={name}
                    neverSignedIn={neverSignedIn}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

async function ToolsSection({ organizationId }: { organizationId: string }) {
  const supabase = await createClient();
  const [{ data: tools }, { data: orgTools }] = await Promise.all([
    supabase
      .from("tools")
      .select("id, slug, name, description, kind, is_active, sort_order")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("organization_tools")
      .select("tool_id, enabled")
      .eq("organization_id", organizationId),
  ]);

  const enabledByTool = new Map<string, boolean>();
  for (const row of orgTools ?? []) enabledByTool.set(row.tool_id, row.enabled);

  return (
    <div className="border-line divide-line divide-y rounded-lg border">
      {(tools ?? []).map((tool) => {
        const missingFromRegistry =
          tool.kind === "internal" && !getToolMeta(tool.slug);

        return (
          <div
            key={tool.id}
            className="flex items-start justify-between gap-4 p-4"
          >
            <div className="space-y-1">
              <p className="font-medium">
                {tool.name}
                <span className="text-muted-foreground ml-2 font-mono text-xs">
                  {tool.slug}
                </span>
                {tool.kind === "external" ? (
                  <Badge variant="outline" className="ml-2">
                    externe
                  </Badge>
                ) : null}
              </p>
              <p className="text-muted-foreground text-sm">
                {tool.description}
              </p>
              {missingFromRegistry ? (
                <p className="text-warning flex items-center gap-1.5 text-xs">
                  <TriangleAlert aria-hidden="true" className="size-3.5" />
                  Aucune page ne correspond à cet identifiant : il restera
                  invisible côté client.
                </p>
              ) : null}
            </div>

            <ToolSwitch
              organizationId={organizationId}
              toolId={tool.id}
              toolName={tool.name}
              defaultEnabled={enabledByTool.get(tool.id) ?? false}
            />
          </div>
        );
      })}
    </div>
  );
}

export default async function ClientDetailPage({
  params,
}: PageProps<"/admin/clients/[id]">) {
  const { id } = await params;
  await requireAdmin();

  // Lecture volontairement hors `<Suspense>` : c'est elle qui décide entre 200
  // et 404, et le statut ne se change plus une fois la réponse commencée.
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!org) notFound();

  return (
    <>
      <div className="mb-8 space-y-4">
        <Link
          href="/admin/clients"
          prefetch
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Clients
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <RenameForm organizationId={org.id} defaultName={org.name} />
            <p className="text-muted-foreground font-mono text-xs">
              {org.slug} · créé le {dateFormat.format(new Date(org.created_at))}
            </p>
          </div>

          <Button asChild variant="outline">
            <Link href={`/app/${org.slug}`} prefetch>
              <ExternalLink aria-hidden="true" />
              Ouvrir l&apos;espace
            </Link>
          </Button>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg">Fichiers</h2>

        <Suspense fallback={<CountersSkeleton compteurs={2} />}>
          <StockageSection organizationId={org.id} />
        </Suspense>
      </section>

      <section className="mt-10 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg">Membres</h2>
          <InviteMemberDialog organizationId={org.id} />
        </div>

        <Suspense fallback={<TableSkeleton rows={2} />}>
          <MembersSection organizationId={org.id} />
        </Suspense>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-lg">Outils</h2>

        <Suspense fallback={<ToolListSkeleton />}>
          <ToolsSection organizationId={org.id} />
        </Suspense>
      </section>

      <section className="mt-10">
        <DangerZone organizationId={org.id} slug={org.slug} name={org.name} />
      </section>
    </>
  );
}
