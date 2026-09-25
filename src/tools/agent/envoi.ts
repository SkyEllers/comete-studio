import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { canalPour } from "./canal.ts";
import { intervalleMs } from "./temps.ts";

type Admin = ReturnType<typeof createAdminClient>;

/** L'heure de la conversation : la vraie, ou celle qu'on a avancée en simulation. */
export function maintenantDe(c: { decalage: string }, reel = Date.now()): number {
  return reel + intervalleMs(c.decalage);
}

/**
 * Un message écrit librement, dans la fenêtre de 24 h ouverte par sa
 * dernière parole. Hors fenêtre, WhatsApp le refuserait : l'appelant a
 * vérifié avant.
 *
 * Avec une `cle`, l'envoi se réserve avant de partir, comme un modèle : deux
 * passages simultanés de l'horloge ne répondent pas deux fois au même
 * message. Rend `false` si la clé était déjà prise ou si le canal a refusé.
 */
export async function envoyerLibre(
  admin: Admin,
  conversationId: string,
  texte: string,
  options: { reel?: number; cle?: string } = {},
): Promise<boolean> {
  const { data: c } = await admin
    .from("agent_conversations")
    .select("id, organization_id, simulation, decalage, telephone")
    .eq("id", conversationId)
    .maybeSingle();
  if (!c) return false;
  const { data: reglages } = await admin
    .from("agent_reglages")
    .select("canal")
    .eq("organization_id", c.organization_id)
    .maybeSingle();
  if (!reglages) return false;

  const canal = canalPour(c.simulation, reglages.canal);
  const { data: reserve, error } = await admin
    .from("agent_messages")
    .insert({
      conversation_id: c.id,
      organization_id: c.organization_id,
      sens: "sortant",
      genre: "libre",
      cle_envoi: options.cle ?? null,
      texte,
      canal: canal.nom,
      created_at: new Date(maintenantDe(c, options.reel)).toISOString(),
    })
    .select("id")
    .single();
  if (error || !reserve) return false;

  const resultat = await canal.envoyer({ telephone: c.telephone, texte });
  if (!resultat.ok) {
    await admin
      .from("agent_messages")
      .update({ statut: "echec", erreur: resultat.erreur })
      .eq("id", reserve.id);
    return false;
  }
  if (resultat.idExterne) {
    await admin.from("agent_messages").update({ id_externe: resultat.idExterne }).eq("id", reserve.id);
  }
  return true;
}
