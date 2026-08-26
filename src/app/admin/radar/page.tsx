import { CircleAlert, Radar } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { TableSkeleton } from "@/components/app/skeletons";
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
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { depuis, montant, silencieuxDepuis } from "@/tools/resultats/format";
import { libelleMois, moisCourant } from "@/tools/resultats/mois";

/**
 * Radar vu de haut : tous les clients d'un coup d'œil.
 *
 * Ce que Louis vient y chercher le 1er du mois : qui reste à clôturer, qui n'a
 * pas répondu, qui n'a pas payé — et surtout, quel Calendly s'est tu. Un
 * webhook muet depuis deux semaines, c'est une commission qui ne se facture
 * plus sans que personne s'en aperçoive.
 */

/** Au-delà, un agenda silencieux n'est plus une accalmie mais une panne. */
const SILENCE_ALERTE = 14;

const ETATS: Record<string, string> = {
  cloture: "attend sa réponse",
  conteste: "contesté",
  valide: "à payer",
  paye: "payé",
};

async function Tableau() {
  const supabase = await createClient();
  const mois = moisCourant();

  const [reglages, clients, brouillons, releves] = await Promise.all([
    supabase
      .from("radar_settings")
      .select("organization_id, commission_rate, currency, connected_at, last_webhook_at"),
    supabase.from("organizations").select("id, name, slug"),
    supabase
      .from("radar_bookings_effective")
      .select("organization_id, counts_for_commission, amount_cents")
      .eq("mois", mois)
      .limit(5000),
    supabase
      .from("radar_statements")
      .select("organization_id, month, status, commission_cents")
      .in("status", ["cloture", "conteste", "valide"])
      .order("month", { ascending: false })
      .limit(200),
  ]);

  const parClient = new Map((clients.data ?? []).map((org) => [org.id, org]));

  const lignes = (reglages.data ?? [])
    .map((reglage) => {
      const org = parClient.get(reglage.organization_id);
      if (!org) return null;

      const base = (brouillons.data ?? [])
        .filter(
          (ligne) =>
            ligne.organization_id === reglage.organization_id &&
            ligne.counts_for_commission,
        )
        .reduce((total, ligne) => total + (ligne.amount_cents ?? 0), 0);

      const taux = Number(reglage.commission_rate);
      return {
        org,
        devise: reglage.currency,
        connecte: Boolean(reglage.connected_at),
        dernierAppel: reglage.last_webhook_at,
        muet: silencieuxDepuis(reglage.last_webhook_at, SILENCE_ALERTE),
        brouillon: Math.round((base * taux) / 100),
        enAttente: (releves.data ?? []).filter(
          (releve) => releve.organization_id === reglage.organization_id,
        ),
      };
    })
    .filter((ligne) => ligne !== null)
    .sort((a, b) => a.org.name.localeCompare(b.org.name));

  if (lignes.length === 0) {
    return (
      <EmptyState
        icon={Radar}
        title="Aucun client sur Radar."
        description="Active l'outil depuis la fiche d'un client pour le voir apparaître ici."
      />
    );
  }

  return (
    <div className="border-line overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Calendly</TableHead>
            <TableHead className="text-right">
              Commission de {libelleMois(mois)}
            </TableHead>
            <TableHead>Relevés en attente</TableHead>
            <TableHead className="text-right">Radar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lignes.map((ligne) => {
            const muet = ligne.muet;

            return (
              <TableRow key={ligne.org.id}>
                <TableCell>
                  <p className="font-medium">{ligne.org.name}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {ligne.org.slug}
                  </p>
                </TableCell>

                <TableCell>
                  {!ligne.connecte ? (
                    <Badge variant="outline">non connecté</Badge>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs",
                        muet ? "text-danger" : "text-muted-foreground",
                      )}
                    >
                      {muet ? <CircleAlert aria-hidden="true" className="size-3.5" /> : null}
                      {ligne.dernierAppel
                        ? `dernier appel ${depuis(ligne.dernierAppel)}`
                        : "aucun appel reçu"}
                    </span>
                  )}
                </TableCell>

                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {montant(ligne.brouillon, ligne.devise)}
                  <span className="text-muted-foreground block text-xs">brouillon</span>
                </TableCell>

                <TableCell>
                  {ligne.enAttente.length === 0 ? (
                    <span className="text-muted-foreground text-xs">—</span>
                  ) : (
                    <ul className="space-y-1">
                      {ligne.enAttente.map((releve) => (
                        <li key={releve.month} className="text-xs">
                          {libelleMois(releve.month)} ·{" "}
                          <span
                            className={cn(
                              releve.status === "conteste" && "text-warning",
                              releve.status === "valide" && "text-success",
                            )}
                          >
                            {ETATS[releve.status] ?? releve.status}
                          </span>{" "}
                          <span className="text-muted-foreground font-mono">
                            {montant(releve.commission_cents, ligne.devise)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/clients/${ligne.org.id}/radar`} prefetch>
                      Ouvrir
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function RadarTransversalPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Radar"
        description="Tous les clients suivis à la commission, le mois en cours et ce qui attend une réponse."
      />

      <Suspense fallback={<TableSkeleton rows={3} />}>
        <Tableau />
      </Suspense>
    </>
  );
}
