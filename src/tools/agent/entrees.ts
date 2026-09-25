import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { estStop, sensDuBouton } from "./lecture.ts";
import { envoyerLibre, maintenantDe } from "./envoi.ts";
import { profil as profilDe } from "./profils/index.ts";
import type { SensBouton } from "./profil.ts";

type Admin = ReturnType<typeof createAdminClient>;

export type Lu = { stop: boolean; sens: SensBouton | null; messageId: string } | null;

/**
 * Elle a écrit : noter le message, et ce qui se lit sans IA.
 *
 * Un bouton « Oui » confirme. Un STOP arrête tout, tout de suite, et reçoit
 * une seule réponse fixe. Le reste (une question, un empêchement écrit en
 * toutes lettres) est laissé à la réponse libre de l'agent.
 */
export async function recevoir(
  admin: Admin,
  conversationId: string,
  texte: string,
  reel = Date.now(),
): Promise<Lu> {
  const { data: c } = await admin
    .from("agent_conversations")
    .select("id, organization_id, simulation, decalage, etat, premiere_reponse_le, telephone")
    .eq("id", conversationId)
    .maybeSingle();
  if (!c) return null;

  const { data: reglages } = await admin
    .from("agent_reglages")
    .select("profil, canal")
    .eq("organization_id", c.organization_id)
    .maybeSingle();
  const profil = reglages ? profilDe(reglages.profil) : null;
  if (!reglages || !profil) return null;

  const maintenant = new Date(maintenantDe(c, reel)).toISOString();
  const stop = estStop(texte);
  const sens = stop ? null : sensDuBouton(profil, texte);

  const { data: message } = await admin
    .from("agent_messages")
    .insert({
      conversation_id: c.id,
      organization_id: c.organization_id,
      sens: "entrant",
      genre: sens ? "bouton" : "texte",
      texte: texte.slice(0, 4000),
      comprehension: { stop, sens },
      canal: c.simulation ? "simule" : reglages.canal === "whatsapp" ? "whatsapp" : "simule",
      statut: "recu",
      created_at: maintenant,
    })
    .select("id")
    .single();
  if (!message) return null;

  // Après un STOP, on garde ce qu'elle écrit, et on ne répond plus rien.
  if (c.etat !== "active") return { stop, sens, messageId: message.id };

  await admin
    .from("agent_conversations")
    .update({
      derniere_entree_le: maintenant,
      premiere_reponse_le: c.premiere_reponse_le ?? maintenant,
      ...(sens === "confirme" ? { confirme_le: maintenant } : {}),
      ...(stop ? { etat: "stop", stop_le: maintenant } : {}),
    })
    .eq("id", c.id);

  if (stop) await envoyerLibre(admin, c.id, profil.textes.stop, { reel, cle: `stop:${message.id}` });

  return { stop, sens, messageId: message.id };
}
