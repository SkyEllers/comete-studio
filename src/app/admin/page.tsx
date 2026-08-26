import {
  Building2,
  HardDrive,
  Images,
  SquareStack,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { Counter } from "@/components/admin/counter";
import { PageHeader } from "@/components/app/page-header";
import { CountersSkeleton } from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { tailleLisible } from "@/tools/fichiers/format";

const nombre = (valeur: number) => valeur.toLocaleString("fr-FR");

/** Sous la garde du layout : peut être mis en flux sans risque pour le statut. */
async function Counters() {
  const supabase = await createClient();

  const [clients, membres, outils, fichiers] = await Promise.all([
    supabase.from("organizations").select("*", { count: "exact", head: true }),
    supabase.from("memberships").select("*", { count: "exact", head: true }),
    supabase
      .from("tools")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
    // Sans argument : tous les clients à la fois. La fonction est soumise à la
    // RLS de qui l'appelle — ici Louis, qui voit tout.
    supabase.rpc("stats_fichiers"),
  ]);

  const stockage = fichiers.data?.[0] ?? { fichiers: 0, octets: 0 };

  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <Counter
        icon={Building2}
        label="Clients"
        value={nombre(clients.count ?? 0)}
      />
      <Counter
        icon={UsersRound}
        label="Membres"
        value={nombre(membres.count ?? 0)}
      />
      <Counter
        icon={SquareStack}
        label="Outils actifs"
        value={nombre(outils.count ?? 0)}
      />
      <Counter
        icon={Images}
        label="Fichiers"
        value={nombre(stockage.fichiers)}
      />
      <Counter
        icon={HardDrive}
        label="Espace utilisé"
        value={tailleLisible(stockage.octets)}
      />
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
