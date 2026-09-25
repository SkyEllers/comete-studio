import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CLES_PROFILS, profil as profilDe } from "@/tools/agent/profils";

import { FormulaireReglages, FormulaireSimulation } from "./formulaires";

/**
 * L'agent — ce qu'il fait entre la réservation et le rendez-vous.
 *
 * Réservé à Louis : les conversations portent le téléphone et les réponses
 * des clientes. Tant que WhatsApp n'est pas branché, c'est aussi la salle de
 * simulation : Louis y ouvre une fausse réservation et joue la cliente.
 */

export const metadata = { title: "Agent — Comète Studio" };

const ETATS: Record<string, string> = {
  active: "en cours",
  hors_champ: "hors champ",
  stop: "STOP",
  annulee: "annulé",
  terminee: "terminé",
};

const quand = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export default async function AgentPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: reglages }, { data: organisations }, { data: conversations }] = await Promise.all([
    supabase.from("agent_reglages").select("organization_id, profil, actif, canal, types_suivis"),
    supabase.from("organizations").select("id, name").order("name"),
    supabase
      .from("agent_conversations")
      .select("id, organization_id, simulation, prenom, rdv_debut, etat, confirme_le, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const nomDe = new Map((organisations ?? []).map((o) => [o.id, o.name]));
  const avecAgent = (reglages ?? []).map((r) => ({
    id: r.organization_id,
    nom: nomDe.get(r.organization_id) ?? "?",
    profil: r.profil,
    formulaire: profilDe(r.profil)?.formulaire ?? [],
  }));

  return (
    <>
      <PageHeader
        title="Agent"
        description="Ce que l'agent écrit entre la réservation et le rendez-vous. Tant que WhatsApp n'est pas branché, tu joues la cliente ici."
      />

      <section className="mb-8 grid gap-4 lg:grid-cols-2">
        <div className="border-line bg-surface-1 rounded-lg border p-5">
          <h2 className="mb-3 text-lg">Clients</h2>
          {(reglages ?? []).length === 0 ? (
            <p className="text-muted-foreground mb-4 text-sm">Aucun client n&apos;a encore d&apos;agent.</p>
          ) : (
            <ul className="mb-4 space-y-2 text-sm">
              {(reglages ?? []).map((r) => (
                <li key={r.organization_id} className="flex flex-wrap items-baseline gap-x-3">
                  <span>{nomDe.get(r.organization_id)}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    profil {r.profil} · canal {r.canal} ·{" "}
                    {r.actif ? (
                      <span className="text-ember">vraies réservations suivies</span>
                    ) : (
                      "simulation seulement"
                    )}{" "}
                    · {r.types_suivis.length} type(s) suivi(s)
                  </span>
                </li>
              ))}
            </ul>
          )}
          <FormulaireReglages
            organisations={(organisations ?? []).map((o) => ({ id: o.id, nom: o.name }))}
            profils={CLES_PROFILS}
          />
        </div>

        <div className="border-line bg-surface-1 rounded-lg border p-5">
          <h2 className="mb-3 text-lg">Nouvelle simulation</h2>
          {avecAgent.length === 0 ? (
            <p className="text-muted-foreground text-sm">Règle d&apos;abord un agent pour un client.</p>
          ) : (
            <FormulaireSimulation clients={avecAgent} />
          )}
        </div>
      </section>

      <h2 className="mb-3 text-lg">Conversations</h2>
      {(conversations ?? []).length === 0 ? (
        <EmptyState
          title="Aucune conversation"
          description="Lance une simulation : l'agent enverra son premier message tout de suite."
        />
      ) : (
        <ul className="border-line divide-line divide-y rounded-lg border">
          {(conversations ?? []).map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/agent/${c.id}`}
                className="hover:bg-surface-2 flex flex-wrap items-baseline gap-x-4 px-4 py-3 text-sm transition-colors"
              >
                <span className="min-w-24">{c.prenom}</span>
                <span className="text-muted-foreground">{nomDe.get(c.organization_id)}</span>
                <span className="font-mono text-xs">rdv {quand(c.rdv_debut)}</span>
                <span className="font-mono text-xs">{ETATS[c.etat] ?? c.etat}</span>
                {c.confirme_le ? <span className="text-xs text-emerald-400">confirmé</span> : null}
                {c.simulation ? (
                  <span className="text-muted-foreground ml-auto text-xs">simulation</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
