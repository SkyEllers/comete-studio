import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { maintenantDe } from "@/tools/agent/moteur";
import { profil as profilDe } from "@/tools/agent/profils";

import { Fil, Horloge, Repondre, Supprimer } from "./conversation";

/**
 * Une conversation : ce que l'agent a écrit, ce qu'elle a répondu, et où en
 * est son rendez-vous. En simulation, Louis y répond à sa place et avance
 * l'horloge.
 */

export const metadata = { title: "Conversation — Agent — Comète Studio" };

const FACONS: Record<string, string> = {
  fonce: "elle fonce",
  analyse: "elle analyse tout",
  pas_a_pas: "pas à pas",
  accompagnee: "besoin d'être accompagnée",
};

const quand = (instant: string | number) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instant));

export default async function ConversationPage({ params }: PageProps<"/admin/agent/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const { data: c } = await supabase
    .from("agent_conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const [{ data: messages }, { data: reglages }] = await Promise.all([
    supabase
      .from("agent_messages")
      .select("id, sens, genre, modele, texte, boutons, statut, erreur, created_at")
      .eq("conversation_id", id)
      .order("created_at"),
    supabase.from("agent_reglages").select("profil").eq("organization_id", c.organization_id).maybeSingle(),
  ]);
  const profil = reglages ? profilDe(reglages.profil) : null;
  const maintenant = maintenantDe(c);
  const fil = messages ?? [];
  const dernierModele = [...fil].reverse().find((m) => m.sens === "sortant" && m.boutons.length > 0);

  const lignes: [string, string][] = [
    ["Rendez-vous", quand(c.rdv_debut)],
    ["État", c.etat],
    ["Confirmé", c.confirme_le ? quand(c.confirme_le) : "non"],
    ["Façon de décider", c.facon_de_decider ? FACONS[c.facon_de_decider] : "—"],
    ["Reports par l'agent", String(c.reports_agent)],
    ["Sans réponse à la veille", c.sans_reponse_veille ? "oui" : "non"],
    ["Téléphone", c.telephone ?? "—"],
    ["Effacée après", quand(c.efface_apres)],
  ];

  return (
    <>
      <Link href="/admin/agent" className="text-muted-foreground hover:text-foreground text-sm">
        ← Agent
      </Link>
      <h1 className="mt-2 mb-1 text-2xl">
        {c.prenom}
        {c.simulation ? <span className="text-muted-foreground ml-3 text-sm">simulation</span> : null}
      </h1>
      <p className="text-muted-foreground mb-6 font-mono text-xs">
        {c.simulation ? "heure simulée : " : "maintenant : "}
        {quand(maintenant)}
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          <Fil messages={fil} pied={profil?.pied ?? null} />
          {c.simulation ? (
            <Repondre
              id={c.id}
              boutons={dernierModele?.boutons ?? []}
              desactive={c.etat !== "active"}
            />
          ) : null}
        </div>

        <aside className="space-y-4">
          <dl className="border-line bg-surface-1 rounded-lg border p-4 text-sm">
            {lignes.map(([cle, valeur]) => (
              <div key={cle} className="flex justify-between gap-3 py-1">
                <dt className="text-muted-foreground">{cle}</dt>
                <dd className="text-right">{valeur}</dd>
              </div>
            ))}
          </dl>

          <details className="border-line bg-surface-1 rounded-lg border p-4 text-sm">
            <summary className="cursor-pointer">Ses réponses au formulaire</summary>
            <dl className="mt-3 space-y-2">
              {(c.reponses as { question: string; answer: string }[]).map((r) => (
                <div key={r.question}>
                  <dt className="text-muted-foreground text-xs">{r.question}</dt>
                  <dd>{r.answer || "—"}</dd>
                </div>
              ))}
            </dl>
          </details>

          {c.simulation ? (
            <>
              <Horloge id={c.id} />
              <Supprimer id={c.id} />
            </>
          ) : null}
        </aside>
      </div>
    </>
  );
}
