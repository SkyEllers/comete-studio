import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { recevoir } from "./entrees.ts";
import { suiviAvance, type Entree, type Suivi } from "./whatsapp-regles.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Ce que le webhook WhatsApp fait d'un message de Meta, une fois la signature
 * vérifiée par la route.
 *
 * Un message reçu rejoint la conversation de celle qui l'écrit (son numéro,
 * chez le client dont c'est le numéro WhatsApp), et se note par `recevoir`,
 * comme en simulation. Un message de quelqu'un que l'agent ne suit pas est
 * ignoré : il n'a rien à lui dire. Un suivi (distribué, lu, échec) avance le
 * statut du message sortant, sans jamais le faire reculer.
 *
 * Rend les conversations à faire tourner : la route les confie à `after()`,
 * pour répondre à Meta en moins de 2 s.
 */
export async function traiterWebhook(
  admin: Admin,
  lu: { entrees: Entree[]; suivis: Suivi[] },
): Promise<{ aTourner: string[]; ignores: number }> {
  const numeros = [...new Set([...lu.entrees, ...lu.suivis].map((e) => e.numeroId))];
  const { data: reglages } = await admin
    .from("agent_reglages")
    .select("organization_id, whatsapp_numero_id")
    .in("whatsapp_numero_id", numeros.length ? numeros : ["-"]);
  const orgDe = new Map((reglages ?? []).map((r) => [r.whatsapp_numero_id, r.organization_id]));

  const aTourner = new Set<string>();
  let ignores = 0;

  for (const e of lu.entrees) {
    const org = orgDe.get(e.numeroId);
    if (!org) {
      ignores++;
      continue;
    }
    // Rejoué par Meta : déjà noté, rien à refaire.
    const { data: deja } = await admin
      .from("agent_messages")
      .select("id")
      .eq("id_externe", e.idExterne)
      .maybeSingle();
    if (deja) continue;

    const { data: c } = await admin
      .from("agent_conversations")
      .select("id")
      .eq("organization_id", org)
      .eq("simulation", false)
      .eq("telephone", e.de)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!c) {
      ignores++;
      continue;
    }

    const recu = await recevoir(admin, c.id, e.texte, Date.now(), e.idExterne);
    if (recu && !recu.stop) aTourner.add(c.id);
  }

  for (const s of lu.suivis) {
    if (!orgDe.has(s.numeroId)) continue;
    const { data: m } = await admin
      .from("agent_messages")
      .select("id, statut")
      .eq("id_externe", s.idExterne)
      .eq("sens", "sortant")
      .maybeSingle();
    if (!m || !suiviAvance(m.statut, s.statut)) continue;
    await admin
      .from("agent_messages")
      .update({ statut: s.statut, ...(s.erreur ? { erreur: s.erreur } : {}) })
      .eq("id", m.id);
  }

  return { aTourner: [...aTourner], ignores };
}
