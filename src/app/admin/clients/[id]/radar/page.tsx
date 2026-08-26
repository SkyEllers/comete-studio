import { ArrowLeft, CalendarClock, RadioTower } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  CanalForm,
  ConnexionCalendly,
  CorrigerRendezVous,
  ReglagesRadar,
  type CanalAdmin,
} from "@/app/admin/clients/[id]/radar/radar-forms";
import { ClientTabs } from "@/components/admin/client-tabs";
import { EmptyState } from "@/components/app/empty-state";
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
import {
  attributionLisible,
  dateHeure,
  depuis,
  montant,
  statutLisible,
} from "@/tools/resultats/format";

/**
 * L'onglet Radar d'un client.
 *
 * Tout ce que Louis règle et surveille : la connexion Calendly, le taux, les
 * canaux, les rendez-vous reçus et le journal des appels. Le client, lui, ne
 * verra ni ce journal ni les corrections en train de se faire — seulement leur
 * résultat et leur motif.
 */

const OUTIL = "resultats";

async function reglagesEtCanaux(organizationId: string) {
  const supabase = await createClient();

  const [reglages, canaux] = await Promise.all([
    supabase
      .from("radar_settings")
      .select(
        "commission_rate, window_days, currency, calendly_user_uri, calendly_webhook_uri, connected_at, last_webhook_at",
      )
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("radar_channels")
      .select("id, key, label, is_comete, is_active, sort_order, rules")
      .eq("organization_id", organizationId)
      .order("sort_order"),
  ]);

  return { reglages: reglages.data, canaux: (canaux.data ?? []) as CanalAdmin[] };
}

async function SectionConnexion({ organizationId }: { organizationId: string }) {
  const { reglages } = await reglagesEtCanaux(organizationId);
  const connecteLe = reglages?.connected_at ?? null;

  return (
    <div className="border-line bg-surface-1 space-y-4 rounded-lg border p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={connecteLe ? "default" : "outline"}>
          {connecteLe ? "Connecté" : "Non connecté"}
        </Badge>
        {connecteLe ? (
          <p className="text-muted-foreground font-mono text-xs">
            depuis le {dateHeure(connecteLe)} · dernier appel reçu{" "}
            {depuis(reglages?.last_webhook_at ?? null)}
          </p>
        ) : null}
      </div>

      <ConnexionCalendly
        organizationId={organizationId}
        connecte={Boolean(connecteLe)}
      />
    </div>
  );
}

async function SectionReglages({ organizationId }: { organizationId: string }) {
  const { reglages, canaux } = await reglagesEtCanaux(organizationId);

  return (
    <>
      <ReglagesRadar
        organizationId={organizationId}
        commissionRate={Number(reglages?.commission_rate ?? 20)}
        windowDays={reglages?.window_days ?? 90}
        currency={reglages?.currency ?? "EUR"}
      />

      <section className="mt-10 space-y-4">
        <div>
          <h2 className="text-lg">Canaux</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            L&apos;ordre est celui dans lequel le moteur les interroge : Google
            Ads avant SEO, sinon <code className="font-mono">google/cpc</code>{" "}
            tomberait dans le référencement naturel.
          </p>
        </div>

        <div className="border-line overflow-hidden rounded-lg border">
          {canaux.map((canal) => (
            <CanalForm key={canal.id} organizationId={organizationId} canal={canal} />
          ))}
        </div>
      </section>
    </>
  );
}

async function SectionRendezVous({ organizationId }: { organizationId: string }) {
  const supabase = await createClient();

  const [rdv, canaux] = await Promise.all([
    supabase
      .from("radar_bookings_effective")
      .select(
        "id, scheduled_start, event_type_name, channel_id, attribution, attribution_note, declared_source, status, effective_status, amount_cents, currency, payment_ok, counts_for_commission",
      )
      .eq("organization_id", organizationId)
      .order("scheduled_start", { ascending: false })
      .limit(50),
    supabase
      .from("radar_channels")
      .select("id, label, is_comete")
      .eq("organization_id", organizationId)
      .order("sort_order"),
  ]);

  const lignes = rdv.data ?? [];
  const parCanal = new Map((canaux.data ?? []).map((canal) => [canal.id, canal]));

  if (lignes.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Aucun rendez-vous."
        description="Ils arriveront d'eux-mêmes dès que Calendly sera branché."
      />
    );
  }

  return (
    <div className="border-line overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Séance</TableHead>
            <TableHead>Canal</TableHead>
            <TableHead>Montant</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="text-right">Corriger</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lignes.map((ligne) => {
            const canal = ligne.channel_id ? parCanal.get(ligne.channel_id) : null;

            return (
              <TableRow key={ligne.id}>
                <TableCell>
                  <p className="font-medium">{ligne.event_type_name}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {dateHeure(ligne.scheduled_start!)}
                  </p>
                </TableCell>

                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={canal?.is_comete ? "default" : "outline"}>
                      {canal?.label ?? "—"}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {attributionLisible(ligne.attribution!)}
                    </span>
                  </div>
                  {ligne.declared_source ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      déclaré : {ligne.declared_source}
                    </p>
                  ) : null}
                  {ligne.attribution_note ? (
                    <p className="text-warning mt-1 text-xs">{ligne.attribution_note}</p>
                  ) : null}
                </TableCell>

                <TableCell>
                  <span className="font-mono text-sm tabular-nums">
                    {montant(ligne.amount_cents ?? 0, ligne.currency ?? "EUR")}
                  </span>
                  {ligne.amount_cents && !ligne.payment_ok ? (
                    <p className="text-danger text-xs">paiement manquant</p>
                  ) : null}
                </TableCell>

                <TableCell>
                  <p className="text-sm">{statutLisible(ligne.effective_status!)}</p>
                  {ligne.counts_for_commission ? (
                    <p className="text-success font-mono text-xs">compte</p>
                  ) : null}
                </TableCell>

                <TableCell>
                  <CorrigerRendezVous
                    organizationId={organizationId}
                    bookingId={ligne.id!}
                    channelId={ligne.channel_id}
                    statut={ligne.status!}
                    canaux={canaux.data ?? []}
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

const RESULTATS = [
  "accepted",
  "duplicate",
  "ignored",
  "invalid_signature",
  "invalid_payload",
  "error",
] as const;

async function SectionJournal({
  organizationId,
  resultat,
}: {
  organizationId: string;
  resultat?: string;
}) {
  const supabase = await createClient();

  let requete = supabase
    .from("radar_webhook_log")
    .select("id, received_at, event_kind, outcome, message")
    .eq("organization_id", organizationId)
    .order("received_at", { ascending: false })
    .limit(200);

  if (resultat && RESULTATS.includes(resultat as (typeof RESULTATS)[number])) {
    requete = requete.eq("outcome", resultat);
  }

  const { data } = await requete;
  const lignes = data ?? [];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant={resultat ? "outline" : "default"} size="sm">
          <Link href={`/admin/clients/${organizationId}/radar`}>Tout</Link>
        </Button>
        {RESULTATS.map((valeur) => (
          <Button
            key={valeur}
            asChild
            variant={resultat === valeur ? "default" : "outline"}
            size="sm"
          >
            <Link href={`/admin/clients/${organizationId}/radar?resultat=${valeur}`}>
              {valeur}
            </Link>
          </Button>
        ))}
      </div>

      {lignes.length === 0 ? (
        <EmptyState
          icon={RadioTower}
          title="Rien dans le journal."
          description="Chaque appel de Calendly y laissera une ligne, reçue ou refusée."
        />
      ) : (
        <div className="border-line overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reçu le</TableHead>
                <TableHead>Événement</TableHead>
                <TableHead>Résultat</TableHead>
                <TableHead>Détail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.map((ligne) => (
                <TableRow key={ligne.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {dateHeure(ligne.received_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {ligne.event_kind ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ligne.outcome === "accepted" ? "default" : "outline"}>
                      {ligne.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {ligne.message ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

export default async function RadarAdminPage({
  params,
  searchParams,
}: PageProps<"/admin/clients/[id]/radar">) {
  const { id } = await params;
  const { resultat } = await searchParams;
  const filtre = Array.isArray(resultat) ? resultat[0] : resultat;
  await requireAdmin();

  // Hors `<Suspense>` : c'est elle qui décide entre 200 et 404.
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("id", id)
    .maybeSingle();

  if (!org) notFound();

  const { data: actif } = await supabase
    .from("organization_tools")
    .select("enabled, tools!inner(slug)")
    .eq("organization_id", org.id)
    .eq("tools.slug", OUTIL)
    .maybeSingle();

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

        <div>
          <h1 className="font-display text-2xl font-semibold">{org.name}</h1>
          <p className="text-muted-foreground font-mono text-xs">{org.slug} · Radar</p>
        </div>

        <ClientTabs organizationId={org.id} actif="radar" radarActif />
      </div>

      {!actif?.enabled ? (
        <EmptyState
          icon={RadioTower}
          title="Radar n'est pas activé pour ce client."
          description="Active-le depuis la fiche : ses réglages et ses canaux se posent tout seuls."
        />
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-lg">Connexion Calendly</h2>
            <Suspense fallback={<TableSkeleton rows={1} />}>
              <SectionConnexion organizationId={org.id} />
            </Suspense>
          </section>

          <section className="mt-10 space-y-4">
            <h2 className="text-lg">Réglages</h2>
            <Suspense fallback={<TableSkeleton rows={2} />}>
              <SectionReglages organizationId={org.id} />
            </Suspense>
          </section>

          <section className="mt-10 space-y-4">
            <h2 className="text-lg">Rendez-vous</h2>
            <Suspense fallback={<TableSkeleton rows={3} />}>
              <SectionRendezVous organizationId={org.id} />
            </Suspense>
          </section>

          <section className="mt-10 space-y-4">
            <h2 className="text-lg">Journal des webhooks</h2>
            <Suspense fallback={<TableSkeleton rows={3} />}>
              <SectionJournal organizationId={org.id} resultat={filtre} />
            </Suspense>
          </section>
        </>
      )}
    </>
  );
}
