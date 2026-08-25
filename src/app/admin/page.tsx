import { Building2, SquareStack, UsersRound } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

async function counts() {
  const supabase = await createClient();

  const [clients, membres, outils] = await Promise.all([
    supabase.from("organizations").select("*", { count: "exact", head: true }),
    supabase.from("memberships").select("*", { count: "exact", head: true }),
    supabase
      .from("tools")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  return {
    clients: clients.count ?? 0,
    membres: membres.count ?? 0,
    outils: outils.count ?? 0,
  };
}

function Counter({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: number;
}) {
  return (
    <div className="border-line bg-surface-1 rounded-lg border p-5">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {label}
      </div>
      <p className="font-display mt-3 text-3xl font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

export default async function AdminPage() {
  const { clients, membres, outils } = await counts();

  return (
    <>
      <PageHeader
        title="Administration"
        description="Les clients, leurs membres, et les outils que tu leur ouvres."
        action={
          <Button asChild>
            <Link href="/admin/clients">Nouveau client</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Counter icon={Building2} label="Clients" value={clients} />
        <Counter icon={UsersRound} label="Membres" value={membres} />
        <Counter icon={SquareStack} label="Outils actifs" value={outils} />
      </div>
    </>
  );
}
