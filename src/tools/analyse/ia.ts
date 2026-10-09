import "server-only";

import type { z } from "zod";

/**
 * L'appel à Claude de l'analyse des diagnostics (0056).
 *
 * `fetch` natif, comme l'agent et Sas (CLAUDE.md du hub, §2). Claude Opus 5.5,
 * réflexion adaptative à l'effort `high` : lire 45 minutes d'appel et dire
 * pourquoi une vente se fait demande du jugement. La réponse est relue par zod.
 *
 * Deux façons de tenir la forme de la réponse :
 * - `grammaire` : le schéma est imposé par l'API (structured outputs). La
 *   synthèse. L'API refuse un schéma trop gros (« compiled grammar is too
 *   large ») ;
 * - `consigne` : le schéma est donné dans les consignes, en JSON, et la
 *   réponse est extraite puis vérifiée par zod. L'analyse d'un appel, depuis
 *   que sa grille a grandi avec l'analyse de Peggy (08/10/2026). Une réponse
 *   hors schéma échoue, et l'horloge la retente.
 *
 * `fallbacks: "default"` : un refus d'un filtre de sécurité (l'appel parle de
 * santé) est rejoué sur le modèle de repli au lieu de faire échouer l'analyse.
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
  /** Par défaut `grammaire`. */
  contrainte?: "grammaire" | "consigne";
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
        output_config:
          demande.contrainte === "consigne"
            ? { effort: "high" }
            : { effort: "high", format: { type: "json_schema", schema: demande.schema } },
        system:
          demande.contrainte === "consigne"
            ? [
                { type: "text", text: demande.stables },
                { type: "text", text: consigneSchema(demande.schema), cache_control: { type: "ephemeral" } },
                { type: "text", text: demande.moment },
              ]
            : [
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
    const lu = lecteur.safeParse(demande.contrainte === "consigne" ? extraireJson(texte) : JSON.parse(texte));
    if (!lu.success) return { ok: false, erreur: "réponse de Claude hors du schéma" };
    return { ok: true, valeur: lu.data, usage: corps.usage ?? {} };
  } catch {
    return { ok: false, erreur: "réponse de Claude illisible" };
  }
}

/** La forme de la réponse, quand elle n'est pas imposée par l'API. */
function consigneSchema(schema: object): string {
  return `## La forme de ta réponse

Réponds uniquement par un objet JSON, sans texte avant ni après, qui suit exactement ce schéma (JSON Schema). Tous les champs sont obligatoires ; une chaîne vide ou une liste vide quand il n'y a rien à dire. Pour un champ qui donne une liste de valeurs (« parmi : … »), n'utilise que ces valeurs.

${JSON.stringify(schema)}`;
}

/** L'objet JSON de la réponse, même entouré d'un bloc de code ou d'une phrase. */
export function extraireJson(texte: string): unknown {
  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return null;
  try {
    return JSON.parse(texte.slice(debut, fin + 1));
  } catch {
    return null;
  }
}
