/**
 * Lire chez Meta l'état d'un modèle WhatsApp du compte de Peggy (lecture seule).
 *
 *   node --conditions=react-server scripts/agent-etat-modele.mjs diag_reservation_v2
 *
 * Rend son statut (PENDING, APPROVED, REJECTED…), sa catégorie et, s'il est
 * refusé, la raison donnée par Meta.
 */
import { createClient } from "@supabase/supabase-js";

import { env } from "./qa-commun.mjs";

import { VERSION_API } from "../src/tools/agent/whatsapp-regles.ts";

const COMPTE_WHATSAPP = "1367595148781611";
const nom = process.argv[2];
if (!nom) throw new Error("Donne le nom du modèle, par exemple diag_reservation_v2.");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: org } = await admin.from("organizations").select("id").eq("slug", "peggy").single();
const { data: jeton } = await admin.rpc("agent_get_secret", { org: org.id, kind: "whatsapp_token" });
if (!jeton) throw new Error("Jeton WhatsApp absent du Vault.");

const r = await fetch(
  `https://graph.facebook.com/${VERSION_API}/${COMPTE_WHATSAPP}/message_templates?name=${encodeURIComponent(nom)}&fields=name,status,category,rejected_reason`,
  { headers: { Authorization: `Bearer ${jeton}`, "User-Agent": "comete-hub-agent/1.0" } },
);
const corps = await r.json();
if (!r.ok) throw new Error(`Meta refuse la lecture : ${corps?.error?.message ?? r.status}`);
for (const m of corps.data ?? []) {
  console.log(`${m.name} : ${m.status}, ${m.category}${m.rejected_reason && m.rejected_reason !== "NONE" ? `, refusé : ${m.rejected_reason}` : ""}`);
}
if (!corps.data?.length) console.log(`${nom} : introuvable chez Meta`);
