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
import {
  BoutonCloture,
  BoutonPaiement,
  FormulaireSaisie,
} from "@/app/admin/clients/[id]/radar/radar-releves";
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
import { cn } from "@/lib/utils";
import {
  attributionLisible,
  dateHeure,
  depuis,
  jour,
  montant,
  statutLisible,
} from "@/tools/resultats/format";
import { libelleMois, moisAOffrir, moisCourant, moisDemande } from "@/tools/resultats/mois";
import { estRevolu } from "@/tools/resultats/releve";
import { SelecteurMois } from "@/tools/resultats/tuiles";

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


/**
 * Les relevés d'un client, et les saisies qui vont avec.
 *
 * Un seul mois à la fois — celui qu'on choisit dans l'URL — parce que la
 * clôture, la saisie et l'entonnoir parlent tous du même mois, et qu'on les
 * lit ensemble.
 */
async function SectionReleves({
  organizationId,
  mois,
}: {
  organizationId: string;
  mois: string;
}) {
  const supabase = await createClient();

  const [releves, reglages, canaux, seances, saisies, moisConnus] = await Promise.all([
    supabase
      .from("radar_statements")
      .select("id, month, status, base_cents, commission_cents, closed_at, reviewed_at, review_comment, paid_at")
      .eq("organization_id", organizationId)
      .order("month", { ascending: false })
      .limit(24),
    supabase
      .from("radar_settings")
      .select("commission_rate, currency")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("radar_channels")
      .select("id, label, is_comete")
      .eq("organization_id", organizationId)
      .order("sort_order"),
    supabase
      .from("radar_bookings_effective")
      .select("channel_id, counts_for_commission, amount_cents, mois")
      .eq("organization_id", organizationId)
      .eq("mois", mois)
      .limit(1000),
    supabase
      .from("radar_channel_entries")
      .select("channel_id, spend_cents, visitors, clicks")
      .eq("organization_id", organizationId)
      .eq("month", mois),
    supabase
      .from("radar_bookings_effective")
      .select("mois")
      .eq("organization_id", organizationId)
      .limit(1000),
  ]);

  const taux = Number(reglages.data?.commission_rate ?? 20);
  const devise = reglages.data?.currency ?? "EUR";
  const parMois = new Map((releves.data ?? []).map((r) => [r.month, r]));
  const cometeCanaux = (canaux.data ?? []).filter((canal) => canal.is_comete);
  const parCanalSaisie = new Map((saisies.data ?? []).map((s) => [s.channel_id, s]));

  const choix = moisAOffrir([
    ...new Set([
      ...((moisConnus.data ?? []).map((l) => l.mois).filter(Boolean) as string[]),
      ...(releves.data ?? []).map((r) => r.month),
    ]),
  ]);

  const releve = parMois.get(mois);
  const revolu = estRevolu(mois, moisCourant());

  // L'entonnoir : ce que Louis a dépensé, ce que ça a donné, ce qu'il gagne.
  const entonnoir = cometeCanaux.map((canal) => {
    const lignes = (seances.data ?? []).filter((l) => l.channel_id === canal.id);
    const honorees = lignes.filter((l) => l.counts_for_commission);
    const base = honorees.reduce((total, l) => total + (l.amount_cents ?? 0), 0);
    const saisie = parCanalSaisie.get(canal.id) ?? null;
    const depense = saisie?.spend_cents ?? 0;
    const commission = Math.round((base * taux) / 100);

    return {
      canal,
      saisie,
      visiteurs: saisie?.visitors ?? 0,
      clics: saisie?.clicks ?? 0,
      reservations: lignes.length,
      honorees: honorees.length,
      depense,
      commission,
      marge: commission - depense,
      coutParReservation: lignes.length > 0 ? Math.round(depense / lignes.length) : null,
      coutParHonoree: honorees.length > 0 ? Math.round(depense / honorees.length) : null,
    };
  });

  return (
    <>
      <SelecteurMois
        mois={mois}
        choix={choix}
        href={(valeur) => `/admin/clients/${organizationId}/radar?mois=${valeur}`}
      />

      <div className="border-line bg-surface-1 space-y-4 rounded-lg border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{libelleMois(mois)}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {releve
                ? `${montant(releve.commission_cents, devise)} sur ${montant(releve.base_cents, devise)} de base · clôturé le ${jour(releve.closed_at)}`
                : revolu
                  ? "Pas encore clôturé."
                  : "Mois en cours : il se clôturera à partir du 1er du mois prochain."}
            </p>
            {releve?.review_comment ? (
              <p className="text-warning mt-2 text-sm">
                « {releve.review_comment} »
                {releve.reviewed_at ? ` — le ${jour(releve.reviewed_at)}` : ""}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {releve ? (
              <Badge variant={releve.status === "paye" ? "default" : "outline"}>
                {releve.status}
              </Badge>
            ) : null}

            {revolu && (!releve || releve.status === "conteste") ? (
              <BoutonCloture
                organizationId={organizationId}
                mois={mois}
                reCloture={Boolean(releve)}
              />
            ) : null}

            {releve && (releve.status === "valide" || releve.status === "cloture") ? (
              <BoutonPaiement
                organizationId={organizationId}
                statementId={releve.id}
                valide={releve.status === "valide"}
              />
            ) : null}
          </div>
        </div>
      </div>

      <section className="mt-8 space-y-4">
        <div>
          <h3 className="text-sm">Dépenses et audience</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Ce que tu saisis ici ne sort jamais de l&apos;administration : c&apos;est
            ta marge, pas la sienne.
          </p>
        </div>

        <div className="border-line space-y-4 rounded-lg border p-4">
          {cometeCanaux.map((canal) => (
            <FormulaireSaisie
              key={canal.id}
              organizationId={organizationId}
              mois={mois}
              canal={canal}
              saisie={parCanalSaisie.get(canal.id) ?? null}
            />
          ))}
        </div>
      </section>

      <section className="mt-8 space-y-3">
        <h3 className="text-sm">L&apos;entonnoir de {libelleMois(mois)}</h3>

        <div className="border-line overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Canal</TableHead>
                <TableHead className="text-right">Visiteurs</TableHead>
                <TableHead className="text-right">Clics</TableHead>
                <TableHead className="text-right">Réservations</TableHead>
                <TableHead className="text-right">Honorées</TableHead>
                <TableHead className="text-right">Coût / résa</TableHead>
                <TableHead className="text-right">Coût / honorée</TableHead>
                <TableHead className="text-right">Dépense</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Marge</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entonnoir.map((ligne) => (
                <TableRow key={ligne.canal.id}>
                  <TableCell className="font-medium">{ligne.canal.label}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {ligne.visiteurs || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {ligne.clics || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {ligne.reservations}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {ligne.honorees}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {ligne.coutParReservation === null
                      ? "—"
                      : montant(ligne.coutParReservation, devise)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {ligne.coutParHonoree === null
                      ? "—"
                      : montant(ligne.coutParHonoree, devise)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {montant(ligne.depense, devise)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {montant(ligne.commission, devise)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      ligne.marge >= 0 ? "text-success" : "text-danger",
                    )}
                  >
                    {montant(ligne.marge, devise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
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
  const { resultat, mois } = await searchParams;
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
            <h2 className="text-lg">Relevés et saisies</h2>
            <Suspense fallback={<TableSkeleton rows={3} />}>
              <SectionReleves organizationId={org.id} mois={moisDemande(mois)} />
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
