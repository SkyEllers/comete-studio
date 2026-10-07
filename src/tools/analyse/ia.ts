import "server-only";

import type { z } from "zod";

/**
 * L'appel à Claude de l'analyse des diagnostics (0055).
 *
 * `fetch` natif, comme l'agent et Sas (CLAUDE.md du hub, §2). Claude Opus 5.5,
 * réflexion adaptative à l'effort `high` : lire 45 minutes d'appel et dire
 * pourquoi une vente se fait demande du jugement. La réponse est contrainte
 * par un schéma JSON, puis relue par zod. `fallbacks: "default"` : un refus
 * d'un filtre de sécurité (l'appel parle de santé) est rejoué sur le modèle
 * de repli au lieu de faire échouer l'analyse.
 *
 * Ne lève jamais : toute panne rend un message d'erreur court, rangé sur la
 * ligne, et l'analyse se relance plus tard ou à la main. Rien du contenu
 * n'est journalisé. Sans analyse, l'espace des closeuses et Radar marchent
 * comme avant (CLAUDE.md du hub, §8).
 */

export const MODELE = "claude-opus-5-5";

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type Demande = {
  stables: string;
  moment: string;
  contenu: string;
  schema: object;
  maxTokens: number;
  delaiMs: number;
};

export async function demanderJson<T>(
  demande: Demande,
  lecteur: z.ZodType<T>,
): Promise<{ ok: true; valeur: T; usage: Usage } | { ok: false; erreur: string }> {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return { ok: false, erreur: "ANTHROPIC_API_KEY absente" };

  let reponse: Response;
  try {
    reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(demande.delaiMs),
      headers: {
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
        "user-agent": "comete-hub-analyse/1.0",
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: demande.maxTokens,
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: demande.schema },
        },
        system: [
          { type: "text", text: demande.stables, cache_control: { type: "ephemeral" } },
          { type: "text", text: demande.moment },
        ],
        messages: [{ role: "user", content: demande.contenu }],
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, erreur: "l'API Claude n'a pas répondu à temps" };
  }

  if (!reponse.ok) return { ok: false, erreur: `l'API Claude a refusé l'appel (HTTP ${reponse.status})` };

  try {
    const corps = (await reponse.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
      usage?: Usage;
    };
    if (corps.stop_reason !== "end_turn") {
      return { ok: false, erreur: `réponse de Claude inutilisable (${corps.stop_reason ?? "sans fin"})` };
    }
    const texte = (corps.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const lu = lecteur.safeParse(JSON.parse(texte));
    if (!lu.success) return { ok: false, erreur: "réponse de Claude hors du schéma" };
    return { ok: true, valeur: lu.data, usage: corps.usage ?? {} };
  } catch {
    return { ok: false, erreur: "réponse de Claude illisible" };
  }
}
