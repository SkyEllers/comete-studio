import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { estReaction, estStop, sensDuBouton } from "./lecture.ts";
import { envoyerLibre, maintenantDe } from "./envoi.ts";
import { profil as profilDe } from "./profils/index.ts";
import type { SensBouton } from "./profil.ts";

type Admin = ReturnType<typeof createAdminClient>;

/** `muet` : un message qui n'appelle aucune réponse (une réaction). */
export type Lu = { stop: boolean; sens: SensBouton | null; messageId: string; muet?: boolean } | null;

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
  /** L'identifiant du message chez Meta : un webhook rejoué ne le note pas deux fois. */
  idExterne: string | null = null,
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
      id_externe: idExterne,
      created_at: maintenant,
    })
    .select("id")
    .single();
  if (!message) return null;

  // Après un STOP, on garde ce qu'elle écrit, et on ne répond plus rien.
  if (c.etat !== "active") return { stop, sens, messageId: message.id };

  // Une réaction se garde, et c'est tout : elle ne compte pas comme un message
  // qui attend une réponse.
  if (estReaction(texte)) {
    if (!c.premiere_reponse_le) {
      await admin.from("agent_conversations").update({ premiere_reponse_le: maintenant }).eq("id", c.id);
    }
    return { stop: false, sens: null, messageId: message.id, muet: true };
  }

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
