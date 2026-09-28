/**
 * Soumettre à Meta les modèles WhatsApp d'un profil d'agent.
 *
 * Les textes viennent du profil (`src/tools/agent/profils/<client>.ts`), tels
 * que Louis les a validés : ce qui part chez Meta est exactement ce que le
 * hub enverra. Catégorie Utilité, langue française, pied commun du profil,
 * boutons de réponse rapide, un exemple par variable (Meta l'exige).
 *
 *   Sans argument : lecture seule. Montre chaque modèle tel qu'il partirait.
 *   --soumettre   : le soumet au compte WhatsApp Business du client.
 *
 * Rien ne part vers une cliente : c'est une demande de validation. Un refus
 * s'affiche avec la raison donnée par Meta (proposition 199 du vault).
 */
import { createClient } from "@supabase/supabase-js";

import { env } from "./qa-commun.mjs";

import { peggy } from "../src/tools/agent/profils/peggy.ts";
import { LANGUE_MODELES, nomModeleMeta, VERSION_API } from "../src/tools/agent/whatsapp-regles.ts";

const COMPTE_WHATSAPP = "1367595148781611";
const EXEMPLES = {
  prenom: "Camille",
  jour: "jeudi 8 octobre",
  heure: "14h",
  lienVisio: "https://zoom.us/j/1234567890",
  titreContenu: "Pourquoi les régimes ne marchent pas",
  lienContenu: "https://www.peggygirault.fr/blog/pourquoi-les-regimes-ne-marchent-pas/",
};

const reel = process.argv.includes("--soumettre");
// --seulement contenu : un seul modèle (les autres sont déjà chez Meta).
const iSeul = process.argv.indexOf("--seulement");
const seulement = iSeul === -1 ? null : process.argv[iSeul + 1];

const modeles = Object.entries(peggy.modeles).filter(([cle]) => !seulement || cle === seulement).map(([cle, m]) => {
  const composants = [
    {
      type: "BODY",
      text: m.corps,
      example: { body_text: [m.variables.map((v) => EXEMPLES[v])] },
    },
    { type: "FOOTER", text: peggy.pied },
  ];
  if (m.boutons.length) {
    composants.push({
      type: "BUTTONS",
      buttons: m.boutons.map((b) => ({ type: "QUICK_REPLY", text: b.texte })),
    });
  }
  return { name: nomModeleMeta(cle, m), language: LANGUE_MODELES, category: m.categorie ?? "UTILITY", components: composants };
});

for (const m of modeles) {
  const corps = m.components[0];
  console.log(`\n── ${m.name} (${m.category}, ${m.language})`);
  console.log(corps.text.replace(/^/gm, "   "));
  console.log(`   [pied] ${m.components[1].text}`);
  const boutons = m.components[2]?.buttons.map((b) => b.text) ?? [];
  console.log(`   [boutons] ${boutons.length ? boutons.join(" / ") : "aucun"}`);
  console.log(`   [exemples] ${corps.example.body_text[0].join(" · ")}`);
}

if (!reel) {
  console.log("\nLecture seule : rien n'a été soumis. Pour soumettre : --soumettre\n");
  process.exit(0);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: org } = await admin.from("organizations").select("id").eq("slug", "peggy").single();
const { data: jeton } = await admin.rpc("agent_get_secret", { org: org.id, kind: "whatsapp_token" });
if (!jeton) throw new Error("Jeton WhatsApp introuvable dans le Vault.");

console.log("\nSoumission :");
let refus = 0;
for (const m of modeles) {
  const reponse = await fetch(`https://graph.facebook.com/${VERSION_API}/${COMPTE_WHATSAPP}/message_templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json",
      "User-Agent": "comete-hub-agent/1.0",
    },
    body: JSON.stringify(m),
  });
  const corps = await reponse.json();
  if (reponse.ok) {
    console.log(`   ${m.name} : reçu par Meta, id ${corps.id}, statut ${corps.status}, catégorie ${corps.category}`);
  } else {
    refus++;
    const e = corps.error ?? {};
    console.log(`   ${m.name} : REFUS ${reponse.status} : ${e.error_user_title ?? e.type ?? ""} : ${e.error_user_msg ?? e.message ?? ""}`);
  }
}
console.log("");
process.exit(refus ? 1 : 0);
