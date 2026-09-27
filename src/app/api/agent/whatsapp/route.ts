import { createHash, timingSafeEqual } from "node:crypto";

import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { tournerConversation } from "@/tools/agent/moteur";
import { traiterWebhook } from "@/tools/agent/whatsapp";
import { lireWebhook, signatureValide } from "@/tools/agent/whatsapp-regles";

/**
 * Le webhook WhatsApp de l'agent : ce que Meta nous dit des clientes.
 *
 * Route sans session (CLAUDE.md §7). Deux secrets, dans les variables de
 * Vercel, que Louis pose :
 *
 *   AGENT_WHATSAPP_VERIFY_TOKEN  le mot que Meta renvoie quand on enregistre
 *                                l'adresse du webhook dans l'app (GET)
 *   AGENT_WHATSAPP_APP_SECRET    la clé secrète de l'app Meta, qui signe
 *                                chaque message (POST, `X-Hub-Signature-256`)
 *
 * Sans eux, la route répond 503 et ne fait rien.
 *
 *   401  signature absente ou fausse. Sans corps.
 *   200  reçu et traité, ou volontairement ignoré (un numéro que l'agent ne
 *        suit pas, un événement qui ne le concerne pas). Jamais de 4xx pour
 *        un message qui ne passera jamais : Meta le rejouerait.
 *   500  c'est nous qui sommes en panne : que Meta rejoue.
 *
 * Aucune donnée personnelle dans les journaux : des nombres, jamais un numéro
 * ni un texte. La réponse de l'agent part après la réponse à Meta (`after`).
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const sansCorps = (code: number) => new Response(null, { status: code });

function memeTexte(recu: string, attendu: string): boolean {
  const a = createHash("sha256").update(recu).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}

/** Meta vérifie l'adresse : il renvoie le défi si le mot est le bon. */
export async function GET(request: Request) {
  const attendu = process.env.AGENT_WHATSAPP_VERIFY_TOKEN?.trim();
  if (!attendu) return sansCorps(503);

  const p = new URL(request.url).searchParams;
  const defi = p.get("hub.challenge") ?? "";
  if (p.get("hub.mode") !== "subscribe" || !memeTexte(p.get("hub.verify_token") ?? "", attendu)) {
    return sansCorps(403);
  }
  if (!/^[0-9A-Za-z_-]{1,200}$/.test(defi)) return sansCorps(400);
  return new Response(defi, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request) {
  const secret = process.env.AGENT_WHATSAPP_APP_SECRET?.trim();
  if (!secret) return sansCorps(503);

  const brut = await request.text();
  if (!signatureValide(brut, request.headers.get("x-hub-signature-256"), secret)) return sansCorps(401);

  let json: unknown;
  try {
    json = JSON.parse(brut);
  } catch {
    return sansCorps(200);
  }
  const lu = lireWebhook(json);
  if (!lu || (lu.entrees.length === 0 && lu.suivis.length === 0)) return sansCorps(200);

  try {
    const admin = createAdminClient();
    const { aTourner, ignores } = await traiterWebhook(admin, lu);
    if (ignores) console.info("Agent WhatsApp : messages ignorés (numéro non suivi)", ignores);

    // Répondre à Meta tout de suite ; l'agent répond à la cliente juste après.
    after(async () => {
      for (const id of aTourner) {
        try {
          await tournerConversation(admin, id);
        } catch (erreur) {
          console.error("Agent WhatsApp : réponse échouée", erreur instanceof Error ? erreur.message : erreur);
        }
      }
    });
    return sansCorps(200);
  } catch (erreur) {
    console.error("Agent WhatsApp : webhook en panne", erreur instanceof Error ? erreur.message : erreur);
    return sansCorps(500);
  }
}
