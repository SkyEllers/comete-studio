import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { echeancier, plusMois } from "@/tools/closeuse/commission";
import { montant } from "@/tools/resultats/format";

import { ChoixIncident, ChoixTypeCloseuse, FormGrille } from "./closeuses-forms";

/**
 * Les closeuses d'un client (0036) : leur grille, les types de séance qui leur
 * reviennent, leur taux de vente comparé à celui du client sur les mêmes
 * canaux, et les paiements de leurs ventes, où Louis note un impayé ou un
 * remboursement.
 */

const JOURS_COMPARES = 90;

/** Les 90 derniers jours, jusqu'à maintenant : lu une fois par rendu serveur. */
function fenetreComparee() {
  const maintenant = Date.now();
  return {
    depuis: new Date(maintenant - JOURS_COMPARES * 86_400_000).toISOString(),
    maintenant: new Date(maintenant).toISOString(),
  };
}

export async function SectionCloseuses({
  organizationId,
  orgSlug,
}: {
  organizationId: string;
  orgSlug: string;
}) {
  const supabase = await createClient();

  const { data: adhesions } = await supabase
    .from("memberships")
    .select("user_id, profiles(full_name, email)")
    .eq("organization_id", organizationId)
    .eq("role", "closeuse");

  const closeuses = (adhesions ?? []).map((a) => ({
    id: a.user_id,
    nom: a.profiles?.full_name || a.profiles?.email || "Closeuse",
  }));

  if (closeuses.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucune closeuse chez ce client. Invite-la depuis l&apos;onglet Membres, avec le rôle « Closeuse ».
      </p>
    );
  }

  const { depuis, maintenant } = fenetreComparee();

  const [{ data: grilles }, { data: filtres }, { data: recents }, { data: canaux }, { data: ventes }] =
    await Promise.all([
      supabase
        .from("radar_closeuses")
        .select("user_id, taux, taux_palier, palier_apres")
        .eq("organization_id", organizationId),
      supabase
        .from("radar_event_filters")
        .select("id, event_type_name, tracked, closeuse_id")
        .eq("organization_id", organizationId)
        .order("first_seen_at"),
      supabase
        .from("radar_bookings_effective")
        .select("closeuse_id, channel_id, effective_status, has_sale")
        .eq("organization_id", organizationId)
        .gte("scheduled_start", depuis)
        .lte("scheduled_start", maintenant),
      supabase.from("radar_channels").select("id, label").eq("organization_id", organizationId),
      supabase
        .from("radar_bookings")
        .select("id, invitee_first_name, closeuse_id, sale_amount_cents, sale_date, sale_fois, sale_premier_cents")
        .eq("organization_id", organizationId)
        .not("closeuse_id", "is", null)
        .not("sale_amount_cents", "is", null)
        .order("sale_date", { ascending: false })
        .limit(60),
    ]);

  const ids = (ventes ?? []).map((v) => v.id);
  const { data: incidents } = ids.length
    ? await supabase.from("radar_encaissement_incidents").select("booking_id, numero, type").in("booking_id", ids)
    : { data: [] };
  const incidentPar = new Map((incidents ?? []).map((i) => [`${i.booking_id}#${i.numero}`, i.type]));
  const nomCanal = new Map((canaux ?? []).map((c) => [c.id, c.label]));

  return (
    <div className="space-y-8">
      {closeuses.map((c) => {
        const g = grilles?.find((x) => x.user_id === c.id);
        const siens = (recents ?? []).filter((r) => r.closeuse_id === c.id && r.effective_status === "honore");
        const canauxSiens = [...new Set(siens.map((r) => r.channel_id))];
        const comparaison = canauxSiens.map((canal) => {
          const elle = siens.filter((r) => r.channel_id === canal);
          const client = (recents ?? []).filter(
            (r) => !r.closeuse_id && r.channel_id === canal && r.effective_status === "honore",
          );
          return {
            canal: canal ? (nomCanal.get(canal) ?? "Canal") : "Sans canal",
            elle: { tenus: elle.length, ventes: elle.filter((r) => r.has_sale).length },
            client: { tenus: client.length, ventes: client.filter((r) => r.has_sale).length },
          };
        });

        return (
          <div key={c.id} className="border-line space-y-5 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{c.nom}</p>
              <Link href={`/app/${orgSlug}/closeuse?c=${c.id}`} className="text-ember text-sm underline-offset-4 hover:underline">
                Voir son espace
              </Link>
            </div>

            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">Sa grille</p>
              <FormGrille
                organizationId={organizationId}
                userId={c.id}
                taux={Number(g?.taux ?? 15)}
                tauxPalier={Number(g?.taux_palier ?? 18)}
                palierApres={g?.palier_apres ?? 5}
              />
            </div>

            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">
                Son taux de vente sur {JOURS_COMPARES} jours, comparé au client sur les mêmes canaux
              </p>
              {comparaison.length ? (
                <table className="text-sm">
                  <thead className="text-muted-foreground text-left text-xs">
                    <tr>
                      <th className="pr-6 font-normal">Canal</th>
                      <th className="pr-6 font-normal">{c.nom.split(" ")[0]}</th>
                      <th className="font-normal">Le client</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparaison.map((l) => (
                      <tr key={l.canal}>
                        <td className="pr-6">{l.canal}</td>
                        <td className="pr-6 tabular-nums">{taux(l.elle)}</td>
                        <td className="tabular-nums">{taux(l.client)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-muted-foreground text-sm">Pas encore de rendez-vous tenu.</p>
              )}
            </div>
          </div>
        );
      })}

      <div className="space-y-2">
        <p className="font-medium">Les types de séance</p>
        <p className="text-muted-foreground text-sm">
          Une réservation d&apos;un type relié part chez la closeuse. Les autres restent au client.
        </p>
        <div className="border-line divide-line divide-y rounded-lg border">
          {(filtres ?? []).map((f) => (
            <ChoixTypeCloseuse
              key={f.id}
              organizationId={organizationId}
              filterId={f.id}
              nom={f.event_type_name}
              suivi={f.tracked}
              closeuseId={f.closeuse_id}
              closeuses={closeuses}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Les paiements de leurs ventes</p>
        <p className="text-muted-foreground text-sm">
          Un paiement passé compte comme encaissé. Note ici un impayé (pas de commission) ou un
          remboursement (commission reprise le mois suivant).
        </p>
        {(ventes ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune vente de closeuse pour l&apos;instant.</p>
        ) : (
          <div className="border-line divide-line divide-y rounded-lg border">
            {(ventes ?? []).map((v) => {
              const parts = echeancier(v.sale_amount_cents!, v.sale_fois, v.sale_premier_cents);
              const qui = closeuses.find((c) => c.id === v.closeuse_id)?.nom ?? "";
              return (
                <div key={v.id} className="space-y-2 px-4 py-3 text-sm">
                  <p>
                    <span className="font-medium">{v.invitee_first_name ?? "Invitée"}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {montant(v.sale_amount_cents!)} le {v.sale_date} · {qui}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {parts.map((p, i) => (
                      <ChoixIncident
                        key={i}
                        organizationId={organizationId}
                        bookingId={v.id}
                        numero={i + 1}
                        libelle={`${i + 1}/${parts.length} · ${plusMois(v.sale_date!, i)} · ${montant(p)}`}
                        valeur={(incidentPar.get(`${v.id}#${i + 1}`) as "impaye" | "rembourse" | undefined) ?? "aucun"}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function taux({ tenus, ventes }: { tenus: number; ventes: number }) {
  if (!tenus) return "—";
  return `${ventes}/${tenus} · ${Math.round((ventes / tenus) * 100)} %`;
}
