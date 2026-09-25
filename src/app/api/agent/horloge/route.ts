import { createHash, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { tournerTout } from "@/tools/agent/moteur";

/**
 * L'horloge de l'agent.
 *
 * La base du hub l'appelle toutes les 5 minutes (pg_cron et pg_net, migration
 * 0039) : c'est elle qui fait partir les modèles à l'heure dite quand
 * personne n'écrit. Pas une tâche planifiée de Vercel : sur le compte
 * gratuit, elles ne passent qu'une fois par jour.
 *
 * Un secret partagé, `Authorization: Bearer <64 caractères hexadécimaux>`,
 * rangé d'un côté dans le Vault de la base, de l'autre dans la variable
 * `AGENT_HORLOGE_SECRET` de Vercel. Sans la variable, la route répond 503 et
 * ne fait rien.
 *
 * Deux passages qui se chevauchent n'envoient rien en double : chaque envoi
 * se réserve par sa `cle_envoi` avant de partir (`moteur.ts`).
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const SECRET = /^[0-9a-f]{64}$/;

const sansCorps = (code: number) => new Response(null, { status: code });

/** Les deux empreintes ont la même longueur : la comparaison est en temps constant. */
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
    const faits = await tournerTout(createAdminClient());
    return Response.json(
      { faits, duree_ms: Date.now() - debut },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (erreur) {
    console.error("Agent : l'horloge a échoué", erreur instanceof Error ? erreur.message : erreur);
    return sansCorps(500);
  }
}
