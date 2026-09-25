import "server-only";

import { SCHEMA_DECISION, decision, texteDePage, type Decision } from "./prompt.ts";

/**
 * L'appel à Claude qui décide de la réponse de l'agent.
 *
 * `fetch` natif, comme Sas (CLAUDE.md du hub, §2) : un appel, quelques
 * en-têtes, un corps JSON, et une clé qui ne quitte jamais le serveur.
 *
 * Claude Opus 5 (Louis, 25/09/2026), réflexion adaptative à l'effort
 * `medium` : des messages de deux à quatre lignes, mais des règles à tenir
 * (santé, détresse, prix). La réponse est contrainte par un schéma JSON, et
 * repassée au crible de zod. Les consignes stables portent le marqueur de
 * cache ; le contexte du moment vient après.
 *
 * `fallbacks: "default"` : si un filtre de sécurité refuse la requête (une
 * cliente qui parle de détresse peut en déclencher un), l'API la rejoue sur
 * le modèle de repli recommandé au lieu de rendre un refus.
 *
 * Ne lève jamais. Toute panne rend `null`, et l'appelant fait monter la
 * question chez Louis : aucun message ne dépend de l'IA sans issue manuelle
 * (CLAUDE.md du hub, §8). Rien du contenu n'est journalisé.
 */

export const MODELE = "claude-opus-5";
const DELAI_MS = 90_000;

export type Appel = { stables: string; moment: string; fil: string };

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export async function demanderDecision(
  appel: Appel,
): Promise<{ decision: Decision; usage: Usage } | null> {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return null;

  let reponse: Response;
  try {
    reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(DELAI_MS),
      headers: {
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
        "user-agent": "comete-hub-agent/1.0",
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 8000,
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: SCHEMA_DECISION },
        },
        system: [
          { type: "text", text: appel.stables, cache_control: { type: "ephemeral" } },
          { type: "text", text: appel.moment },
        ],
        messages: [{ role: "user", content: appel.fil }],
      }),
    });
  } catch {
    console.error("Agent : l'API Claude n'a pas répondu à temps");
    return null;
  }

  if (!reponse.ok) {
    console.error("Agent : l'API Claude a refusé l'appel", reponse.status);
    return null;
  }

  try {
    const corps = (await reponse.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
      usage?: Usage;
    };
    if (corps.stop_reason !== "end_turn") {
      console.error("Agent : réponse de Claude inutilisable", corps.stop_reason);
      return null;
    }
    const texte = (corps.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const lu = decision.safeParse(JSON.parse(texte));
    if (!lu.success) {
      console.error("Agent : réponse de Claude hors du schéma");
      return null;
    }
    return { decision: lu.data, usage: corps.usage ?? {} };
  } catch {
    console.error("Agent : réponse de Claude illisible");
    return null;
  }
}

// ------------------------------ La page Tarifs ------------------------------

const UNE_HEURE = 3_600_000;
const tarifsLus = new Map<string, { le: number; texte: string }>();

/**
 * Le texte de la page des prix, relu au plus une fois par heure : un prix
 * qui change sur le site change dans les réponses dans l'heure, sans rien
 * recopier dans le code (P12 : les prix montent de 20 % avec l'EURL).
 */
export async function lireTarifs(url: string | null): Promise<string | null> {
  if (!url) return null;
  const connu = tarifsLus.get(url);
  if (connu && Date.now() - connu.le < UNE_HEURE) return connu.texte;

  try {
    const reponse = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "comete-hub-agent/1.0" },
    });
    if (!reponse.ok) return connu?.texte ?? null;
    const texte = texteDePage(await reponse.text());
    tarifsLus.set(url, { le: Date.now(), texte });
    return texte;
  } catch {
    return connu?.texte ?? null;
  }
}
