/**
 * Banc de QA — l'analyse des diagnostics (0056), contre la vraie API.
 *
 *   npm run qa:analyse-ia
 *
 * Lit les diagnostics déjà transcrits (service role, lecture seule), les fait
 * analyser par le module de production (`src/tools/analyse/ia.ts`, mêmes
 * consignes, même schéma), et affiche ce qui permet de juger la forme : les
 * repères, le nombre d'alertes, de questions sans réponse, de passages, et le
 * coût. Rien n'est écrit, ni en base ni sur le disque ; aucun nom de cliente
 * n'est affiché.
 *
 * `--conditions=react-server` : `ia.ts` commence par `import 'server-only'`.
 * Environ 0,35 $ par appel analysé (mesuré le 07/10/2026).
 *
 *   --seul <n>   n'analyse que le n-ième appel
 *   --rdv <id>   n'analyse que ce rendez-vous
 *   --montrer    affiche l'analyse entière (sans la fiche de la cliente), pour
 *                juger le fond. À lire à l'écran, jamais à ranger dans un fichier.
 */
import { createClient } from "@supabase/supabase-js";

import { env, SUPABASE } from "./qa-commun.mjs";

import { reponsesPourAnalyse } from "../src/tools/analyse/agregats.ts";
import { demanderJson } from "../src/tools/analyse/ia.ts";
import { profilDuClient } from "../src/tools/analyse/profils.ts";
import { consignesAnalyse, contenuAnalyse, momentAnalyse } from "../src/tools/analyse/prompt.ts";
import { analyseLue, SCHEMA_ANALYSE, versRangee } from "../src/tools/analyse/schema.ts";
import { compterParole, resumeParole } from "../src/tools/analyse/parole.ts";
import { texteACopier } from "../src/tools/resultats/enregistrement-format.ts";

console.log("QA — analyse des diagnostics, contre la vraie API\n");

if (!env.ANTHROPIC_API_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ANTHROPIC_API_KEY ou SUPABASE_SERVICE_ROLE_KEY absente de `.env.local`.");
  process.exit(1);
}
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

const admin = createClient(SUPABASE, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const profil = profilDuClient("peggy");
const { data: org } = await admin.from("organizations").select("id").eq("slug", "peggy").single();

const { data: lignes, error } = await admin
  .from("radar_diagnostic_enregistrements")
  .select("booking_id, transcription")
  .eq("organization_id", org.id)
  .eq("transcription_etat", "faite");
if (error) throw new Error(error.message);

const cout = (u) =>
  ((u.input_tokens ?? 0) * 4 + (u.cache_creation_input_tokens ?? 0) * 5 + (u.cache_read_input_tokens ?? 0) * 0.2 + (u.output_tokens ?? 0) * 20) / 1e6;

const args = process.argv.slice(2);
const seul = args.includes("--seul") ? Number(args[args.indexOf("--seul") + 1]) : null;
const rdvSeul = args.includes("--rdv") ? args[args.indexOf("--rdv") + 1] : null;
const montrer = args.includes("--montrer");

let echecs = 0;
for (const [i, l] of lignes.entries()) {
  if (seul !== null && i + 1 !== seul) continue;
  if (rdvSeul && l.booking_id !== rdvSeul) continue;
  const { data: rdv } = await admin
    .from("radar_bookings_effective")
    .select("closeuse_id, scheduled_start, sale_amount_cents")
    .eq("id", l.booking_id)
    .single();
  const { data: rep } = await admin.from("radar_booking_answers").select("answers").eq("booking_id", l.booking_id).maybeSingle();
  const debut = Date.now();
  const r = await demanderJson(
    {
      stables: consignesAnalyse(profil),
      moment: momentAnalyse([]),
      contenu: contenuAnalyse({
        menePar: rdv.closeuse_id ? "la closeuse" : profil.titulaire,
        parTitulaire: !rdv.closeuse_id,
        prenomCliente: "la cliente",
        dateRdv: rdv.scheduled_start,
        issue: rdv.sale_amount_cents != null ? "vente" : "inconnue",
        detailsIssue: [],
        reponses: reponsesPourAnalyse(Array.isArray(rep?.answers) ? rep.answers : []),
        parole: resumeParole(compterParole(l.transcription)),
        transcription: texteACopier(l.transcription),
      }),
      schema: SCHEMA_ANALYSE,
      contrainte: "consigne",
      maxTokens: 32000,
      delaiMs: 240000,
    },
    analyseLue,
  );
  const duree = Math.round((Date.now() - debut) / 1000);
  if (!r.ok) {
    echecs += 1;
    console.log(`Appel ${i + 1} : ÉCHEC (${r.erreur}) en ${duree} s`);
    continue;
  }
  const a = versRangee(r.valeur, compterParole(l.transcription));
  console.log(`Appel ${i + 1} : ${a.points.length} repères, ${a.alertes.length} alertes, ${a.pas_su.length} questions sans réponse, ${r.valeur.passages.length} passages, ${r.valeur.fiche.phrases.length} phrases de la cliente`);
  console.log(`  repères : ${a.points.map((p) => `${p.cle}=${p.repere}`).join(", ")}`);
  console.log(`  alertes : ${a.alertes.map((x) => `${x.cle}${x.certitude === "sure" ? "" : " (à vérifier)"}`).join(", ") || "aucune"}`);
  console.log(`  intention : ${r.valeur.fiche.intention} · capacité : ${r.valeur.fiche.capacite} · parole closeuse : ${a.parole ? Object.entries(a.parole.parts).map(([k, v]) => k + " " + v + " %").join(", ") : "?"} (voix ${a.voix_closeuse}) · suite : ${a.suite ? "oui" : "non"}`);
  console.log(`  profil : ${r.valeur.fiche.profil_disc} · verdict : ${a.pourquoi.verdict ?? "?"} · ${a.moments_cles.length} moments clés · ${a.pourquoi.freins_exprimes.length + a.pourquoi.freins_supposes.length} autres freins · ${a.pourquoi.signaux_encourageants.length} signaux`);
  if (montrer) console.log(JSON.stringify({ ...a, passages: r.valeur.passages }, null, 2));
  console.log(`  ${duree} s, ${r.usage.input_tokens ?? 0} jetons lus, ${r.usage.output_tokens ?? 0} écrits, ${cout(r.usage).toFixed(3)} $\n`);
}

console.log(echecs ? `${echecs} échec(s) sur ${lignes.length}.` : `${lignes.length} appel(s) analysé(s), aucun échec.`);
process.exit(echecs ? 1 : 0);
