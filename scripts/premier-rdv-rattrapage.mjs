/**
 * Le mail « choisis ton premier rendez-vous » aux clientes qui ont payé leur
 * devis AVANT la mise en ligne du premier rendez-vous (0055, 07/10/2026) :
 * leur paiement n'a déclenché aucun mail. Géraldine T., le 07/10 à 17h50.
 *
 * Sans option : la liste, rien ne part. Avec `--envoyer` : le site envoie le
 * mail (geste « paye » de /api/devis/notifier, qui revérifie : payé, sans
 * rendez-vous), puis l'événement `mail_rdv` est noté sur le devis.
 * Une cliente qui a déjà reçu ce mail (événement `mail_rdv`) est sautée.
 *
 *   node scripts/premier-rdv-rattrapage.mjs
 *   node scripts/premier-rdv-rattrapage.mjs --envoyer
 */
import { createClient } from "@supabase/supabase-js";

import { env } from "./qa-commun.mjs";

const envoyer = process.argv.includes("--envoyer");
const SITE = "https://www.peggygirault.fr";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: payes, error } = await admin
  .from("devis")
  .select("id, prenom, nom, paye_le")
  .eq("statut", "signe")
  .not("paye_le", "is", null)
  .order("paye_le");
if (error) throw new Error(error.message);

for (const d of payes ?? []) {
  const [{ count: rdv }, { count: deja }, { data: lien }] = await Promise.all([
    admin.from("reservation_rendez_vous").select("id", { count: "exact", head: true }).eq("devis_id", d.id).eq("genre", "premier"),
    admin.from("devis_evenements").select("id", { count: "exact", head: true }).eq("devis_id", d.id).eq("genre", "mail_rdv"),
    admin.from("devis_liens").select("lien").eq("devis_id", d.id).maybeSingle(),
  ]);
  const qui = `${d.prenom} ${d.nom ?? ""}`.trim();
  if (rdv || deja) {
    console.log(`- ${qui} (payé le ${d.paye_le}) : ${rdv ? "rendez-vous déjà pris" : "mail déjà parti"}, sautée`);
    continue;
  }
  if (!lien?.lien) {
    console.log(`- ${qui} : pas de lien, sautée`);
    continue;
  }
  if (!envoyer) {
    console.log(`- ${qui} (payé le ${d.paye_le}) : recevrait le mail`);
    continue;
  }
  const r = await fetch(`${SITE}/api/devis/notifier`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "comete-hub/rattrapage" },
    body: JSON.stringify({ lien: lien.lien, geste: "paye" }),
  });
  const corps = await r.text();
  if (r.ok) await admin.from("devis_evenements").insert({ devis_id: d.id, genre: "mail_rdv", details: { rattrapage: true } });
  console.log(`- ${qui} : ${r.ok ? "mail envoyé" : `refusé (${r.status} ${corps.slice(0, 120)})`}`);
}
