import { ChevronRight, UsersRound } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LIBELLES_MOTIF, type Motif } from "@/tools/resultats/non-vente";

/**
 * Closeuses — une carte par closeuse, tous clients confondus (Louis,
 * 07/10/2026). Un clic ouvre son espace tel qu'elle le voit
 * (`/app/<client>/closeuse?c=<id>`, `requireCloseuse` laisse entrer l'admin).
 * Remplace le profil de test du 06/10.
 */

export const metadata = { title: "Closeuses — Comète Studio" };

const depuis = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });
const quand = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
const euros = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);

/** Les gestes qui disent ce qu'un rendez-vous a donné (Louis, 08/10/2026). */
const TYPES_RESULTAT = ["sale.recorded", "sale.reason", "sale.declined", "status.changed"];

type Activite = { booking_id: string; type: string; payload: Record<string, unknown> | null; created_at: string };

function libelleResultat(a: Activite): string | null {
  const p = a.payload ?? {};
  if (a.type === "sale.recorded") {
    const montant = typeof p.montant_cents === "number" ? euros(p.montant_cents) : "";
    const fois = typeof p.fois === "number" && p.fois > 1 ? ` en ${p.fois} fois` : "";
    return `Vendu${montant ? ` · ${montant} HT${fois}` : ""}`;
  }
  if (a.type === "sale.reason") {
    const motif = LIBELLES_MOTIF[p.motif as Motif];
    return `Pas de vente${motif ? ` · ${motif}` : ""}`;
  }
  if (a.type === "sale.declined") return "Pas de vente";
  if (a.type === "status.changed" && p.to === "no_show") return "Pas venue";
  return null;
}

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

  // Sous les cartes (Louis, 08/10/2026) : les trois prochains rendez-vous des
  // closeuses, et leurs trois derniers résultats, sans entrer dans chaque espace.
  const [{ data: prochains }, { data: activites }, { data: r2s }] = await Promise.all([
    supabase
      .from("radar_bookings")
      .select("id, organization_id, closeuse_id, scheduled_start, invitee_first_name, invitee_last_name")
      .in("closeuse_id", ids)
      .eq("status", "confirme")
      .gte("scheduled_start", new Date().toISOString())
      .order("scheduled_start")
      .limit(3),
    supabase
      .from("radar_booking_activities")
      .select("booking_id, type, payload, created_at, radar_bookings!inner(closeuse_id)")
      .in("radar_bookings.closeuse_id", ids)
      .in("type", TYPES_RESULTAT)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("radar_r2")
      .select("booking_id, closeuse_id, demandee_le, resultat")
      .in("closeuse_id", ids)
      .order("demandee_le", { ascending: false })
      .limit(5),
  ]);

  // Un résultat par rendez-vous, son dernier geste : une absence annulée
  // (retour à « confirmé ») efface l'absence. Puis les trois derniers.
  const candidats: { bookingId: string; le: string; libelle: string | null }[] = [
    ...((activites ?? []) as unknown as Activite[]).map((a) => ({
      bookingId: a.booking_id,
      le: a.created_at,
      libelle: libelleResultat(a),
    })),
    ...(r2s ?? []).map((r) => ({ bookingId: r.booking_id, le: r.demandee_le, libelle: "R2 avec la titulaire demandé" })),
  ].sort((a, b) => Date.parse(b.le) - Date.parse(a.le));
  const vus = new Set<string>();
  const derniers = candidats
    .filter((x) => (vus.has(x.bookingId) ? false : (vus.add(x.bookingId), true)))
    .filter((x): x is { bookingId: string; le: string; libelle: string } => x.libelle !== null)
    .slice(0, 3);
  const { data: rdvsDerniers } = derniers.length
    ? await supabase
        .from("radar_bookings")
        .select("id, organization_id, closeuse_id, scheduled_start, invitee_first_name, invitee_last_name")
        .in(
          "id",
          derniers.map((d) => d.bookingId),
        )
    : { data: [] };

  const nomDe = (id: string | null) => {
    const p = profils?.find((x) => x.id === id);
    return p?.full_name || p?.email || "Closeuse";
  };
  const cliente = (r: { invitee_first_name: string | null; invitee_last_name: string | null }) =>
    [r.invitee_first_name, r.invitee_last_name ? `${r.invitee_last_name.charAt(0)}.` : null].filter(Boolean).join(" ") ||
    "Une cliente";
  const lien = (orgId: string, closeuseId: string | null) => {
    const org = orgs?.find((o) => o.id === orgId);
    return org && closeuseId ? `/app/${org.slug}/closeuse?c=${closeuseId}` : null;
  };
  const lignesProchains = (prochains ?? []).map((r) => ({
    cle: r.id,
    quand: quand.format(new Date(r.scheduled_start)),
    cliente: cliente(r),
    closeuse: nomDe(r.closeuse_id),
    href: lien(r.organization_id, r.closeuse_id),
  }));
  const lignesDerniers = derniers.flatMap((d) => {
    const r = rdvsDerniers?.find((x) => x.id === d.bookingId);
    if (!r) return [];
    return [
      {
        cle: d.bookingId,
        libelle: d.libelle,
        cliente: cliente(r),
        closeuse: nomDe(r.closeuse_id),
        rdv: quand.format(new Date(r.scheduled_start)),
        href: lien(r.organization_id, r.closeuse_id),
      },
    ];
  });

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

      {cartes.length ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="space-y-3">
            <h2 className="text-base">Les 3 prochains rendez-vous</h2>
            {lignesProchains.length ? (
              <ul className="border-line divide-line divide-y rounded-lg border">
                {lignesProchains.map((l) => (
                  <li key={l.cle} className="px-4 py-3 text-sm">
                    <p className="font-medium first-letter:uppercase">{l.quand}</p>
                    <p className="text-muted-foreground">
                      {l.cliente} · avec{" "}
                      {l.href ? (
                        <Link href={l.href} prefetch={false} className="text-ember underline-offset-4 hover:underline">
                          {l.closeuse}
                        </Link>
                      ) : (
                        l.closeuse
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Aucun rendez-vous à venir.</p>
            )}
          </section>
          <section className="space-y-3">
            <h2 className="text-base">Les 3 derniers résultats</h2>
            {lignesDerniers.length ? (
              <ul className="border-line divide-line divide-y rounded-lg border">
                {lignesDerniers.map((l) => (
                  <li key={l.cle} className="px-4 py-3 text-sm">
                    <p className="font-medium">{l.libelle}</p>
                    <p className="text-muted-foreground">
                      {l.cliente} · avec{" "}
                      {l.href ? (
                        <Link href={l.href} prefetch={false} className="text-ember underline-offset-4 hover:underline">
                          {l.closeuse}
                        </Link>
                      ) : (
                        l.closeuse
                      )}{" "}
                      · rendez-vous du {l.rdv}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Aucun résultat noté pour l&apos;instant.</p>
            )}
          </section>
        </div>
      ) : null}
      <p className="text-muted-foreground mt-6 text-xs">
        Dans son espace, tes clics comptent pour de vrai : un résultat noté, un dépôt ou un devis envoyé partent comme si elle l&apos;avait fait.
      </p>
    </>
  );
}
