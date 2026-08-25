import { Building2, SquareStack, UsersRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/app/page-header";
import { CountersSkeleton } from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

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

/** Sous la garde du layout : peut être mis en flux sans risque pour le statut. */
async function Counters() {
  const supabase = await createClient();

  const [clients, membres, outils] = await Promise.all([
    supabase.from("organizations").select("*", { count: "exact", head: true }),
    supabase.from("memberships").select("*", { count: "exact", head: true }),
    supabase
      .from("tools")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Counter icon={Building2} label="Clients" value={clients.count ?? 0} />
      <Counter icon={UsersRound} label="Membres" value={membres.count ?? 0} />
      <Counter icon={SquareStack} label="Outils actifs" value={outils.count ?? 0} />
    </div>
  );
}

export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Administration"
        description="Les clients, leurs membres, et les outils que tu leur ouvres."
        action={
          <Button asChild>
            <Link href="/admin/clients" prefetch>
              Nouveau client
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<CountersSkeleton />}>
        <Counters />
      </Suspense>
    </>
  );
}
