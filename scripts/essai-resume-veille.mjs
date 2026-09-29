/**
 * Lecture seule : ce que contiendrait le mail de la veille d'un client pour
 * un jour donné (sujet, nombre de diagnostics, états), sans rien envoyer.
 *
 *   node --conditions=react-server scripts/essai-resume-veille.mjs <slug> <AAAA-MM-JJ>
 */
import { createClient } from "@supabase/supabase-js";

import { env } from "./qa-commun.mjs";

const { diagnosticsDuJour } = await import("../src/tools/agent/resume.ts");
const { mailDuResume, etatEnMots } = await import("../src/tools/agent/resume-regles.ts");

const [slug, jour] = process.argv.slice(2);
if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(jour ?? "")) throw new Error("Donne le slug et le jour, par exemple peggy 2026-09-29.");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org } = await admin.from("organizations").select("id").eq("slug", slug).single();
const d = await diagnosticsDuJour(admin, org.id, jour, false);
const mail = mailDuResume({ jour, fuseau: "Europe/Paris", diagnostics: d });
console.log(`Sujet : ${mail?.sujet ?? "(aucun mail : journée vide)"}`);
console.log(`Diagnostics : ${d.length}`);
for (const x of d) console.log(`- ${x.rdv_debut.slice(11, 16)} UTC · ${etatEnMots(x)}${x.closeuse_id ? " · closeuse" : ""}`);
