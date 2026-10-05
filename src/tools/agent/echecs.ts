import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { envoyer } from "../fichiers/courriel.ts";
import { mailEchecEnvoi } from "./file-regles.ts";
import { numeroInjoignable } from "./whatsapp-regles.ts";

type Admin = ReturnType<typeof createAdminClient>;

const HEURE_MS = 60 * 60 * 1000;

/**
 * Un refus qui dit qu'on ne la joindra jamais par WhatsApp : la conversation
 * passe hors champ, l'agent cesse de lui écrire, et le mail de la veille dit
 * à Peggy de l'appeler ou de lui écrire. Ne lève jamais.
 */
export async function marquerSiInjoignable(admin: Admin, conversationId: string, erreur: string): Promise<void> {
  if (!numeroInjoignable(erreur)) return;
  try {
    await admin
      .from("agent_conversations")
      .update({ etat: "hors_champ" })
      .eq("id", conversationId)
      .eq("etat", "active");
  } catch {
    console.error("Agent : conversation injoignable non marquée");
  }
}

/**
 * Prévenir Louis qu'un envoi est refusé pour de bon. Un mail par heure et par
 * client au plus : quand le moyen de paiement manque, tous les envois
 * échouent à la fois, et un mail suffit à le dire. Ne lève jamais.
 */
export async function signalerEchec(
  admin: Admin,
  e: { organisationId: string; conversationId: string; erreur: string },
): Promise<void> {
  try {
    const depuis = new Date(Date.now() - HEURE_MS).toISOString();
    const { count } = await admin
      .from("agent_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", e.organisationId)
      .eq("sens", "sortant")
      .eq("statut", "echec")
      .gte("created_at", depuis);
    // Le message qui vient d'échouer compte déjà : au-delà, un mail est parti.
    if ((count ?? 0) > 1) return;

    const { data: org } = await admin.from("organizations").select("name").eq("id", e.organisationId).single();
    const racine = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
    await envoyer(
      mailEchecEnvoi({
        client: org?.name ?? "?",
        erreur: e.erreur,
        lien: `${racine}/admin/agent/${e.conversationId}`,
      }),
    );
  } catch {
    console.error("Agent : échec d'envoi non signalé à Louis");
  }
}
