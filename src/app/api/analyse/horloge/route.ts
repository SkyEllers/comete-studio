import { createHash, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { passerHorloge } from "@/tools/analyse/moteur";

/**
 * L'horloge de l'analyse des diagnostics (0056).
 *
 * La base l'appelle toutes les dix minutes (pg_cron et pg_net,
 * `analyse_horloge()`), avec le secret de l'horloge de l'agent (0039) : même
 * variable `AGENT_HORLOGE_SECRET`, même contrôle. À part de l'horloge de
 * l'agent parce qu'une analyse prend une à trois minutes et que l'agent
 * doit passer toutes les cinq minutes sans attendre.
 *
 * Un passage analyse les appels prêts tant qu'il a le temps d'en finir un,
 * puis fait la synthèse du lundi. Ne journalise aucune donnée personnelle.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

/** Ce qu'on garde pour répondre avant que la fonction soit coupée. */
const BUDGET_MS = 290_000;

const SECRET = /^[0-9a-f]{64}$/;

const sansCorps = (code: number) => new Response(null, { status: code });

function memeSecret(recu: string, attendu: string): boolean {
  const a = createHash("sha256").update(recu).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const attendu = process.env.AGENT_HORLOGE_SECRET?.trim();
  if (!attendu || !SECRET.test(attendu)) return sansCorps(503);

  const [schema, valeur] = (request.headers.get("authorization") ?? "").split(" ");
  if (schema?.toLowerCase() !== "bearer" || !valeur || !memeSecret(valeur.trim(), attendu)) {
    return sansCorps(401);
  }

  const debut = Date.now();
  try {
    const passage = await passerHorloge(createAdminClient(), BUDGET_MS);
    return Response.json({ ...passage, duree_ms: Date.now() - debut }, { headers: { "cache-control": "no-store" } });
  } catch (erreur) {
    console.error("[analyse] l'horloge a échoué", erreur instanceof Error ? erreur.message : erreur);
    return sansCorps(500);
  }
}
