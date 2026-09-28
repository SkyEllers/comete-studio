/**
 * Banc de l'enregistrement du diagnostic (migration 0049).
 *
 *   npm run qa:diagnostic -- [--video chemin/vers/un-diagnostic.mp4]
 *
 * Un client A avec sa responsable P et deux closeuses C1 et C2, et un autre
 * client B. On vérifie, contre la vraie base :
 * - qu'une closeuse ne dépose, ne lit et ne signe un lien que sur SES
 *   rendez-vous, et que ni l'autre closeuse ni le client B ne voient rien ;
 * - que la responsable voit tout chez elle, et dépose sur ses propres rendez-vous ;
 * - que personne n'écrit dans la table en direct : tout passe par les fonctions ;
 * - le bucket : type de fichier, rangement, remplacement ;
 * - « pas d'enregistrement » : le résumé en quatre parties, obligatoire ;
 * - la purge à six mois (fichier et ligne) ;
 * - avec `--video` et `ASSEMBLYAI_API_KEY` : la vraie transcription, en
 *   français, rapatriée puis effacée chez AssemblyAI.
 *
 * Tout est préfixé `zz-qa-` et supprimé à la fin, même en cas d'échec.
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import {
  annoncerCible,
  connecter,
  creer,
  creerCompte,
  env,
  journal,
  par,
  refuse,
  srv,
  stockage,
  supprimerCompte,
  vide,
} from "./qa-commun.mjs";

process.env.ASSEMBLYAI_API_KEY ??= env.ASSEMBLYAI_API_KEY ?? "";
const { entretenirEnregistrements, lancerTranscription, rapatrier } = await import(
  "../src/tools/resultats/enregistrement-assemblyai.ts"
);

annoncerCible("Banc de l'enregistrement du diagnostic");

const { verifie, bilan } = journal();
const marque = Date.now().toString(36);
const mail = (qui) => `zz-qa-diagnostic-${qui}-${marque}@cometestudio.fr`;
const comptes = {};
const orgs = {};
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const argVideo = process.argv.indexOf("--video");
const video = argVideo > 0 ? readFileSync(process.argv[argVideo + 1]) : null;
const petit = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]); // un faux début de .mp4

const jour = 86_400_000;
const iso = (decalage) => new Date(Date.now() + decalage).toISOString();

async function rdv(org, nom, debutDans, closeuse = null) {
  return creer("radar_bookings", {
    organization_id: org,
    invitee_uri: `https://api.calendly.com/zz-qa/${marque}/${nom}`,
    event_uri: `https://api.calendly.com/zz-qa/${marque}/ev-${nom}`,
    invitee_key: `zz-qa-${marque}-${nom}`,
    invitee_first_name: nom,
    scheduled_start: iso(debutDans),
    scheduled_end: iso(debutDans + 45 * 60_000),
    event_type_name: "ZZ QA diagnostic",
    closeuse_id: closeuse,
  });
}

const envoyer = (jeton, chemin, corps = petit, type = "video/mp4") =>
  stockage(jeton, "POST", `object/diagnostics/${chemin}`, { corps, entetes: { "content-type": type } });

const RESUME = { probleme: "Ventre gonflé", objectif: "De l'énergie", freins: "Le prix", propose: "Le programme" };

try {
  // ------------------------------- Décor ------------------------------------

  for (const qui of ["p", "c1", "c2", "b"]) comptes[qui] = await creerCompte(mail(qui));

  orgs.a = await creer("organizations", { name: "ZZ QA Diagnostic A", slug: `zz-qa-diagnostic-a-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA Diagnostic B", slug: `zz-qa-diagnostic-b-${marque}` });

  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.p, role: "owner" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.c1, role: "closeuse" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.c2, role: "closeuse" });
  await creer("memberships", { organization_id: orgs.b.id, user_id: comptes.b, role: "owner" });
  await creer("radar_closeuses", { organization_id: orgs.a.id, user_id: comptes.c1 });
  await creer("radar_closeuses", { organization_id: orgs.a.id, user_id: comptes.c2 });

  const outils = (await srv("GET", "tools?select=id,slug&slug=eq.resultats")).data;
  for (const org of [orgs.a, orgs.b]) {
    for (const outil of outils) {
      await creer("organization_tools", { organization_id: org.id, tool_id: outil.id, enabled: true });
    }
  }

  const r1 = await rdv(orgs.a.id, "Une", -2 * 3600_000, comptes.c1);
  const r2 = await rdv(orgs.a.id, "Deux", -3 * 3600_000, comptes.c2);
  const rp = await rdv(orgs.a.id, "Peggy", -4 * 3600_000);
  const vieux = await rdv(orgs.a.id, "Vieux", -200 * jour, comptes.c1);
  const rb = await rdv(orgs.b.id, "Bee", -2 * 3600_000);

  const jetons = {};
  for (const qui of ["p", "c1", "c2", "b"]) jetons[qui] = await connecter(mail(qui));
  const [p, c1, c2, b] = ["p", "c1", "c2", "b"].map((qui) => par(jetons[qui]));

  const chemin = (org, booking, nom = "video.mp4") => `${org.id}/${booking.id}/${marque}-${nom}`;

  // ------------------------------ 1. Le bucket ------------------------------

  console.log("== 1. Le bucket ==");

  const cheminR1 = chemin(orgs.a, r1);
  let r = await envoyer(jetons.c1, cheminR1);
  verifie("C1 dépose sur son rendez-vous", r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);

  r = await envoyer(jetons.c1, chemin(orgs.a, r2));
  verifie("C1 ne dépose pas sur celui de C2", r.status >= 400, `${r.status}`);
  r = await envoyer(jetons.c1, chemin(orgs.a, rp));
  verifie("C1 ne dépose pas sur un rendez-vous de la responsable", r.status >= 400, `${r.status}`);
  r = await envoyer(jetons.c1, chemin(orgs.b, rb));
  verifie("C1 ne dépose pas chez B", r.status >= 400, `${r.status}`);
  r = await envoyer(jetons.b, chemin(orgs.a, r1, "b.mp4"));
  verifie("B ne dépose pas chez A", r.status >= 400, `${r.status}`);
  r = await envoyer(jetons.c1, `${orgs.b.id}/${r1.id}/${marque}-mauvais.mp4`);
  verifie("un rendez-vous rangé sous une autre organisation est refusé", r.status >= 400, `${r.status}`);
  r = await envoyer(jetons.c1, chemin(orgs.a, r1, "doc.pdf"), petit, "application/pdf");
  verifie("un PDF est refusé par le bucket", r.status >= 400, `${r.status}`);
  r = await envoyer(jetons.c1, chemin(orgs.a, r1, "son.m4a"), petit, "audio/mp4");
  verifie("un son est accepté", r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);

  const signer = (jeton, c) => stockage(jeton, "POST", `object/sign/diagnostics/${c}`, {
    corps: JSON.stringify({ expiresIn: 60 }),
    entetes: { "content-type": "application/json" },
  });
  r = await signer(jetons.c1, cheminR1);
  verifie("C1 signe un lien vers sa vidéo", r.status === 200, `${r.status}`);
  r = await signer(jetons.p, cheminR1);
  verifie("la responsable signe un lien vers la vidéo de C1", r.status === 200, `${r.status}`);
  r = await signer(jetons.c2, cheminR1);
  verifie("C2 ne signe pas de lien vers la vidéo de C1", r.status >= 400, `${r.status}`);
  r = await signer(jetons.b, cheminR1);
  verifie("B ne signe pas de lien vers la vidéo de C1", r.status >= 400, `${r.status}`);

  // ----------------------------- 2. Le dépôt --------------------------------

  console.log("== 2. Le dépôt ==");

  const deposer = (client, booking, c, nom = "video.mp4") =>
    client("POST", "rpc/radar_diagnostic_deposer", { booking_id: booking.id, chemin: c, nom, taille: 8 });

  r = await deposer(c2, r1, cheminR1);
  verifie("C2 ne range pas un fichier sur le rendez-vous de C1", r.status >= 400, `${r.status}`);
  r = await deposer(c1, r1, `${orgs.a.id}/${r1.id}/${marque}-absent.mp4`);
  verifie("un fichier jamais arrivé n'est pas rangé", r.status >= 400 && /pas arrivé/.test(JSON.stringify(r.data)), JSON.stringify(r.data));
  r = await deposer(c1, r1, cheminR1);
  verifie("C1 range sa vidéo sur la fiche", r.status === 200 && r.data === null, `${r.status} ${JSON.stringify(r.data)}`);

  const lire = (client, booking) =>
    client("GET", `radar_diagnostic_enregistrements?select=booking_id,chemin,resume&booking_id=eq.${booking.id}`);
  r = await lire(c1, r1);
  verifie("C1 voit sa fiche", r.status === 200 && r.data?.length === 1, JSON.stringify(r.data));
  r = await lire(p, r1);
  verifie("la responsable voit la fiche de C1", r.status === 200 && r.data?.length === 1, JSON.stringify(r.data));
  r = await lire(c2, r1);
  verifie("C2 ne voit pas la fiche de C1", vide(r), JSON.stringify(r.data));
  r = await lire(b, r1);
  verifie("B ne voit pas la fiche de C1", vide(r), JSON.stringify(r.data));

  r = await c1("PATCH", `radar_diagnostic_enregistrements?booking_id=eq.${r1.id}`, { nom_fichier: "x" });
  verifie("C1 n'écrit pas dans la table en direct", refuse(r), `${r.status} ${JSON.stringify(r.data)}`);
  r = await p("DELETE", `radar_diagnostic_enregistrements?booking_id=eq.${r1.id}`);
  verifie("la responsable n'efface pas en direct", refuse(r), `${r.status} ${JSON.stringify(r.data)}`);
  r = await c2("POST", "radar_diagnostic_enregistrements", {
    booking_id: r2.id, organization_id: orgs.a.id, sans_enregistrement: true, resume: RESUME,
  });
  verifie("C2 n'insère pas en direct", refuse(r), `${r.status} ${JSON.stringify(r.data)}`);

  // Remplacer : l'ancien chemin revient, pour que l'app le retire.
  const cheminR1b = chemin(orgs.a, r1, "video-2.mp4");
  await envoyer(jetons.c1, cheminR1b);
  r = await deposer(c1, r1, cheminR1b, "video-2.mp4");
  verifie("remplacer rend l'ancien fichier", r.status === 200 && r.data === cheminR1, `${r.status} ${JSON.stringify(r.data)}`);

  const cheminP = chemin(orgs.a, rp);
  r = await envoyer(jetons.p, cheminP, video ?? petit);
  verifie("la responsable dépose sur son propre rendez-vous", r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);
  r = await deposer(p, rp, cheminP, "diagnostic.mp4");
  verifie("et le range sur la fiche", r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);

  // ----------------------- 3. Pas d'enregistrement --------------------------

  console.log("== 3. Pas d'enregistrement ==");

  const sans = (client, booking, resume) =>
    client("POST", "rpc/radar_diagnostic_sans", { booking_id: booking.id, resume });

  r = await sans(c2, r2, { ...RESUME, freins: "  " });
  verifie("un résumé incomplet est refusé", r.status >= 400 && /quatre parties/.test(JSON.stringify(r.data)), JSON.stringify(r.data));
  r = await sans(c1, r2, RESUME);
  verifie("C1 n'écrit pas de résumé sur le rendez-vous de C2", r.status >= 400, `${r.status}`);
  r = await sans(c2, r2, RESUME);
  verifie("C2 écrit son résumé", r.status === 200 || r.status === 204, `${r.status} ${JSON.stringify(r.data)}`);
  r = await lire(p, r2);
  verifie("la responsable lit le résumé", r.data?.[0]?.resume?.probleme === "Ventre gonflé", JSON.stringify(r.data));
  r = await sans(c1, r1, RESUME);
  verifie("pas de résumé à la place d'une vidéo déposée", r.status >= 400, `${r.status}`);
  const trace = await srv("GET", `radar_booking_activities?select=type,payload&booking_id=eq.${r2.id}`);
  verifie(
    "le geste est au journal, sans le résumé",
    trace.data?.some((a) => a.type === "recording.missing") && !JSON.stringify(trace.data).includes("Ventre"),
    JSON.stringify(trace.data),
  );

  // ------------------------------ 4. La purge -------------------------------

  console.log("== 4. La purge à six mois ==");

  const cheminVieux = chemin(orgs.a, vieux);
  await envoyer(jetons.c1, cheminVieux);
  r = await deposer(c1, vieux, cheminVieux);
  verifie("un vieux diagnostic se dépose", r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);

  const entretien = await entretenirEnregistrements(admin);
  verifie("la purge efface un diagnostic de plus de six mois", entretien.effaces >= 1, JSON.stringify(entretien));
  r = await srv("GET", `radar_diagnostic_enregistrements?select=booking_id&booking_id=in.(${[vieux.id, r1.id, r2.id].join(",")})`);
  const restants = (r.data ?? []).map((l) => l.booking_id);
  verifie("sa ligne est partie", !restants.includes(vieux.id), JSON.stringify(r.data));
  verifie("les récents restent", restants.includes(r1.id) && restants.includes(r2.id), JSON.stringify(r.data));
  r = await signer(null, cheminVieux);
  verifie("son fichier est parti du Storage", r.status >= 400, `${r.status}`);

  // --------------------------- 5. La transcription --------------------------

  console.log("== 5. La transcription ==");

  if (!video || !process.env.ASSEMBLYAI_API_KEY) {
    console.log("  (sautée : il faut --video et ASSEMBLYAI_API_KEY)");
  } else {
    const etat = await lancerTranscription(admin, rp.id);
    verifie("la transcription part", etat === "en_cours", etat);

    let ligne = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((ok) => setTimeout(ok, 5000));
      ligne = (await srv("GET", `radar_diagnostic_enregistrements?select=transcription_etat,transcription_id,transcription,transcription_erreur&booking_id=eq.${rp.id}`)).data?.[0];
      if (ligne?.transcription_etat === "en_cours") await rapatrier(admin, [{ booking_id: rp.id, transcription_id: ligne.transcription_id }]);
      else break;
    }
    ligne = (await srv("GET", `radar_diagnostic_enregistrements?select=transcription_etat,transcription_id,transcription,transcription_erreur&booking_id=eq.${rp.id}`)).data?.[0];
    const texte = (ligne?.transcription ?? []).map((x) => x.texte).join(" ");
    const voix = new Set((ligne?.transcription ?? []).map((x) => x.qui));
    verifie("la transcription revient", ligne?.transcription_etat === "faite", `${ligne?.transcription_etat} ${ligne?.transcription_erreur ?? ""}`);
    verifie("en français", /ventre/i.test(texte) && /diagnostic/i.test(texte), texte.slice(0, 200));
    verifie("avec deux voix", voix.size >= 2, [...voix].join(","));
    console.log(`  Transcription relue (${ligne?.transcription?.length ?? 0} répliques) :`);
    for (const x of ligne?.transcription ?? []) console.log(`    ${x.qui} : ${x.texte}`);

    // Effacée chez AssemblyAI une fois rangée chez nous.
    const chezEux = await fetch(`https://api.eu.assemblyai.com/v2/transcript/${ligne?.transcription_id}`, {
      headers: { authorization: process.env.ASSEMBLYAI_API_KEY, "user-agent": "comete-hub-qa/1" },
    }).then((x) => x.json());
    verifie("et effacée chez AssemblyAI", !/ventre/i.test(String(chezEux.text ?? "")), String(chezEux.text).slice(0, 80));
  }
} catch (erreur) {
  verifie("le banc s'exécute sans erreur", false, erreur.message);
} finally {
  // Les fichiers d'abord (le Storage ne suit pas la cascade), puis les lignes.
  for (const org of Object.values(orgs)) {
    const { data: dossiers } = await admin.storage.from("diagnostics").list(org.id, { limit: 1000 });
    for (const d of dossiers ?? []) {
      const { data: fichiers } = await admin.storage.from("diagnostics").list(`${org.id}/${d.name}`, { limit: 1000 });
      const chemins = (fichiers ?? []).map((f) => `${org.id}/${d.name}/${f.name}`);
      if (chemins.length) await admin.storage.from("diagnostics").remove(chemins);
    }
    await srv("DELETE", `organizations?id=eq.${org.id}`);
  }
  for (const id of Object.values(comptes)) await supprimerCompte(id);
  const restes = await admin.storage.from("diagnostics").list(orgs.a?.id ?? "x");
  verifie("le ménage ne laisse aucun fichier", !restes.data?.length, JSON.stringify(restes.data));
  bilan();
}
