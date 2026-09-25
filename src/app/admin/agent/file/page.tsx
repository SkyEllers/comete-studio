import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { finDeFenetre } from "@/tools/agent/file";
import { maintenantDe } from "@/tools/agent/moteur";
import { cn } from "@/lib/utils";

import { Retirer, Traiter } from "./formulaires";

/**
 * La file : ce que l'agent n'a pas su trancher seul, et la détresse, dont
 * Louis est seulement prévenu. Chaque réponse gardée devient une réponse
 * fixe, relue par l'agent à chaque message.
 */

export const metadata = { title: "File — Agent — Comète Studio" };

const quand = (instant: string | number) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instant));

const HEURE = 60 * 60 * 1000;

function fenetre(c: { simulation: boolean; decalage: string; derniere_entree_le: string | null }) {
  const fin = finDeFenetre(c.derniere_entree_le);
  const reste = fin === null ? -1 : fin - maintenantDe(c);
  if (reste <= 0) return { ouverte: false, texte: "fenêtre de 24 h fermée" };
  return { ouverte: true, texte: `fenêtre ouverte encore ${Math.max(1, Math.floor(reste / HEURE))} h` };
}

export default async function FilePage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: ouvertes }, { data: traitees }, { data: fixes }, { data: organisations }, { data: reglages }] =
    await Promise.all([
      supabase
        .from("agent_questions")
        .select("id, genre, question, brouillon, created_at, notifie_le, conversation_id, organization_id")
        .eq("etat", "ouverte")
        .order("created_at"),
      supabase
        .from("agent_questions")
        .select("id, genre, etat, question, reponse, traitee_le, conversation_id")
        .neq("etat", "ouverte")
        .order("traitee_le", { ascending: false })
        .limit(15),
      supabase
        .from("agent_reponses_fixes")
        .select("id, organization_id, question, reponse, created_at")
        .eq("actif", true)
        .order("created_at", { ascending: false }),
      supabase.from("organizations").select("id, name"),
      supabase.from("agent_reglages").select("organization_id, canal"),
    ]);

  const file = ouvertes ?? [];
  const ids = [...new Set(file.map((q) => q.conversation_id))];
  const [{ data: conversations }, { data: messages }] = await Promise.all([
    ids.length
      ? supabase
          .from("agent_conversations")
          .select("id, prenom, simulation, decalage, rdv_debut, etat, derniere_entree_le")
          .in("id", ids)
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase
          .from("agent_messages")
          .select("id, conversation_id, sens, texte, created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const nomDe = new Map((organisations ?? []).map((o) => [o.id, o.name]));
  const canalDe = new Map((reglages ?? []).map((r) => [r.organization_id, r.canal]));
  const conversationDe = new Map((conversations ?? []).map((c) => [c.id, c]));
  const derniers = (id: string) =>
    (messages ?? [])
      .filter((m) => m.conversation_id === id)
      .slice(0, 4)
      .reverse();

  // La détresse d'abord : c'est la seule qu'on veut voir tout de suite.
  const triees = [...file].sort((a, b) => (a.genre === b.genre ? 0 : a.genre === "detresse" ? -1 : 1));

  return (
    <>
      <Link href="/admin/agent" className="text-muted-foreground hover:text-foreground text-sm">
        ← Agent
      </Link>
      <PageHeader
        title="La file"
        description="Ce que l'agent n'a pas su trancher seul. Ta réponse part dans sa voix, et devient une réponse fixe si tu la gardes."
      />

      {triees.length === 0 ? (
        <EmptyState title="Rien en attente" description="L'agent a tout géré seul." />
      ) : (
        <ul className="mb-10 space-y-4">
          {triees.map((q) => {
            const c = conversationDe.get(q.conversation_id);
            const f = c ? fenetre(c) : null;
            const bloque =
              !c || c.etat !== "active" || (!c.simulation && canalDe.get(q.organization_id) === "whatsapp" && !f?.ouverte);
            return (
              <li
                key={q.id}
                className={cn(
                  "rounded-lg border p-4",
                  q.genre === "detresse" ? "border-destructive/60 bg-destructive/5" : "border-line bg-surface-1",
                )}
              >
                <p className="mb-2 flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className={q.genre === "detresse" ? "text-destructive" : "text-ember"}>
                    {q.genre === "detresse" ? "Détresse · 3114 envoyé" : "L'agent n'est pas sûr"}
                  </span>
                  <span className="text-muted-foreground">{nomDe.get(q.organization_id)}</span>
                  {c ? (
                    <Link href={`/admin/agent/${c.id}`} className="underline underline-offset-2">
                      {c.prenom}
                    </Link>
                  ) : null}
                  {c?.simulation ? <span className="text-muted-foreground text-xs">simulation</span> : null}
                  <span className="text-muted-foreground font-mono text-xs">{quand(q.created_at)}</span>
                  {c ? <span className="font-mono text-xs">rdv {quand(c.rdv_debut)}</span> : null}
                  {f ? <span className="text-muted-foreground text-xs">{f.texte}</span> : null}
                  {c && c.etat !== "active" ? <span className="text-xs">conversation {c.etat}</span> : null}
                  {!q.notifie_le ? <span className="text-muted-foreground text-xs">mail non parti</span> : null}
                </p>

                <p className="mb-3 text-sm">{q.question}</p>

                {c ? (
                  <ol className="border-line mb-2 space-y-1 border-l pl-3 text-xs">
                    {derniers(c.id).map((m) => (
                      <li key={m.id}>
                        <span className="text-muted-foreground">{m.sens === "entrant" ? "elle" : "agent"} · </span>
                        {m.texte}
                      </li>
                    ))}
                  </ol>
                ) : null}

                <Traiter
                  id={q.id}
                  genre={q.genre as "incertain" | "detresse"}
                  brouillon={q.brouillon}
                  question={q.question}
                  peutEnvoyer={!bloque}
                />
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mb-3 text-lg">Réponses fixes</h2>
      {(fixes ?? []).length === 0 ? (
        <p className="text-muted-foreground mb-10 text-sm">Aucune pour l&apos;instant.</p>
      ) : (
        <ul className="border-line divide-line mb-10 divide-y rounded-lg border">
          {(fixes ?? []).map((r) => (
            <li key={r.id} className="flex items-start gap-4 px-4 py-3 text-sm">
              <div className="flex-1">
                <p className="text-muted-foreground text-xs">
                  {nomDe.get(r.organization_id)} · {quand(r.created_at)}
                </p>
                <p>{r.question}</p>
                <p className="text-muted-foreground mt-1">{r.reponse}</p>
              </div>
              <Retirer id={r.id} />
            </li>
          ))}
        </ul>
      )}

      <details>
        <summary className="mb-3 cursor-pointer text-lg">Traitées récemment</summary>
        <ul className="border-line divide-line divide-y rounded-lg border">
          {(traitees ?? []).map((q) => (
            <li key={q.id} className="px-4 py-3 text-sm">
              <p className="text-muted-foreground text-xs">
                {q.etat === "envoyee" ? "envoyée" : "classée"}
                {q.traitee_le ? ` · ${quand(q.traitee_le)}` : ""} ·{" "}
                <Link href={`/admin/agent/${q.conversation_id}`} className="underline underline-offset-2">
                  conversation
                </Link>
              </p>
              <p>{q.question}</p>
              {q.reponse ? <p className="text-muted-foreground mt-1">{q.reponse}</p> : null}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
