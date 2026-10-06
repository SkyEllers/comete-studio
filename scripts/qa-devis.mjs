/**
 * Banc du devis signé en ligne (migration 0050, P16).
 *
 *   npm run qa:devis
 *
 * Un client A (une responsable P, deux closeuses C1 et C2) et un client B.
 * Contre la vraie base, avec le moteur du hub :
 * - créer un devis : l'empreinte du lien, le lien à part, le journal ;
 * - qui le voit : C1 (son rendez-vous) et P oui ; C2, B et un inconnu non ;
 *   le lien en clair, personne sauf le serveur ;
 * - l'ouverture notée une fois ; la signature (une seule gagne), l'empreinte,
 *   le PDF rangé dans le bucket, la vente dans Radar (montant, nombre de
 *   paiements, premier paiement, activité « source : devis ») ;
 * - un devis corrigé annule le précédent ; un devis expiré passe « expire » ;
 *   un rappel dont le site ne répond pas est rendu au passage suivant ;
 * - pas de vente sur une séance annulée.
 *
 * Le profil de devis du faux client écrit à un site injoignable : aucun mail
 * ne part. Tout est préfixé `zz-qa-` et supprimé à la fin, même en cas d'échec.
 */
import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { annoncerCible, connecter, creer, creerCompte, env, journal, par, supprimerCompte } from "./qa-commun.mjs";

const { PROFILS_DEVIS, devisPeggy } = await import("../src/tools/devis/profils/peggy.ts");
const moteur = await import("../src/tools/devis/moteur.ts");

annoncerCible("Banc du devis signé en ligne");

const { verifie, bilan } = journal();
const marque = Date.now().toString(36);
const mail = (qui) => `zz-qa-devis-${qui}-${marque}@cometestudio.fr`;
const comptes = {};
const orgs = {};
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const iso = (decalage) => new Date(Date.now() + decalage).toISOString();

async function rdv(org, nom, debutDans, closeuse = null, status = undefined) {
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
    ...(status ? { status } : {}),
  });
}

const demande = (bookingId, closeuseId, surcharge = {}) => ({
  organizationId: orgs.a.id,
  bookingId,
  closeuseId,
  creePar: closeuseId ?? comptes.p,
  prenom: "Camille",
  nom: "Qa",
  email: mail("cliente"),
  telephone: null,
  dureeMois: 6,
  paiement: "plusieurs",
  ...surcharge,
});

try {
  for (const qui of ["p", "c1", "c2", "b"]) comptes[qui] = await creerCompte(mail(qui));
  orgs.a = await creer("organizations", { name: "ZZ QA Devis A", slug: `zz-qa-devis-a-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA Devis B", slug: `zz-qa-devis-b-${marque}` });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.p, role: "owner" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.c1, role: "closeuse" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.c2, role: "closeuse" });
  await creer("memberships", { organization_id: orgs.b.id, user_id: comptes.b, role: "owner" });
  await creer("radar_closeuses", { organization_id: orgs.a.id, user_id: comptes.c1 });
  await creer("radar_closeuses", { organization_id: orgs.a.id, user_id: comptes.c2 });
  const { data: radar } = await admin.from("tools").select("id").eq("slug", "resultats").single();
  for (const org of [orgs.a, orgs.b]) await creer("organization_tools", { organization_id: org.id, tool_id: radar.id });

  // Le faux client a le texte de Peggy, et un site qui ne répond pas.
  PROFILS_DEVIS[orgs.a.slug] = { ...devisPeggy, slug: orgs.a.slug, site: "http://127.0.0.1:9" };

  const r1 = await rdv(orgs.a.id, "Une", -3 * 3600_000, comptes.c1);
  const rAnnule = await rdv(orgs.a.id, "Annulee", -5 * 3600_000, comptes.c1, "annule");

  // ------------------------------ Créer ------------------------------------
  const cree = await moteur.creerDevis(admin, demande(r1.id, comptes.c1));
  verifie("création", "lien" in cree && /^[0-9a-f]{64}$/.test(cree.lien), JSON.stringify(cree));
  const lien = cree.lien;
  const { data: ligne } = await admin.from("devis").select("*").eq("id", cree.id).single();
  verifie("empreinte du lien", ligne.jeton_hash === createHash("sha256").update(lien).digest("hex"));
  verifie("total en plusieurs fois", ligne.total_cents === 152_000, String(ligne.total_cents));
  verifie("validité d'une semaine", Boolean(ligne.valide_jusqu_au));
  const { data: liens } = await admin.from("devis_liens").select("lien").eq("devis_id", cree.id);
  verifie("lien rangé à part", liens?.[0]?.lien === lien);

  // ------------------------------ Qui voit ---------------------------------
  const jetons = {};
  for (const qui of ["p", "c1", "c2", "b"]) jetons[qui] = await connecter(mail(qui));
  const voit = async (qui, table = "devis") => {
    const r = await par(jetons[qui])("GET", `${table}?select=*&${table === "devis" ? "id" : "devis_id"}=eq.${cree.id}`);
    return Array.isArray(r.data) ? r.data.length : -1;
  };
  verifie("C1 voit son devis", (await voit("c1")) === 1);
  verifie("P voit le devis", (await voit("p")) === 1);
  verifie("C2 ne voit pas", (await voit("c2")) === 0);
  verifie("B ne voit pas", (await voit("b")) === 0);
  verifie("personne ne lit le lien en clair", (await voit("p", "devis_liens")) === 0 && (await voit("c1", "devis_liens")) === 0);
  verifie("C1 voit le journal", (await voit("c1", "devis_evenements")) >= 1);
  const ecrit = await par(jetons.c1)("PATCH", `devis?id=eq.${cree.id}`, { total_cents: 1 });
  const { data: intact } = await admin.from("devis").select("total_cents").eq("id", cree.id).single();
  verifie("personne n'écrit en direct", intact.total_cents === 152_000, `statut ${ecrit.status}`);

  // ------------------------------ Lire, ouvrir -----------------------------
  const d = await moteur.devisDuLien(admin, orgs.a.id, lien);
  verifie("lu par son lien", d?.id === cree.id);
  verifie("pas chez un autre client", (await moteur.devisDuLien(admin, orgs.b.id, lien)) === null);
  await moteur.marquerOuvert(admin, d, "203.0.113.4", "Banc QA");
  await moteur.marquerOuvert(admin, { ...d, ouvert_le: null }, "203.0.113.4", "Banc QA");
  const { count: ouvertures } = await admin
    .from("devis_evenements")
    .select("id", { count: "exact", head: true })
    .eq("devis_id", cree.id)
    .eq("genre", "ouvert");
  verifie("ouverture notée une fois", ouvertures === 1, String(ouvertures));

  // ------------------------------ Signer -----------------------------------
  const avant = await moteur.devisDuLien(admin, orgs.a.id, lien);
  const s1 = await moteur.signer(admin, PROFILS_DEVIS[orgs.a.slug], avant, {
    adresse: "1 rue du Banc, 69100 Villeurbanne",
    demarrageImmediat: true,
    ip: "203.0.113.4",
    agent: "Banc QA",
  });
  verifie("signature", s1.ok && !s1.deja, JSON.stringify(s1));
  const s2 = await moteur.signer(admin, PROFILS_DEVIS[orgs.a.slug], avant, {
    adresse: "1 rue du Banc, 69100 Villeurbanne",
    demarrageImmediat: true,
    ip: null,
    agent: null,
  });
  verifie("une seule signature gagne", s2.ok && s2.deja === true, JSON.stringify(s2));
  const { data: signe } = await admin.from("devis").select("*").eq("id", cree.id).single();
  verifie("état signé", signe.statut === "signe" && /^[0-9a-f]{64}$/.test(signe.empreinte_contenu ?? ""));
  verifie("PDF rangé", Boolean(signe.pdf_chemin) && /^[0-9a-f]{64}$/.test(signe.empreinte_pdf ?? ""));
  const { data: fichier } = await admin.storage.from("devis").download(signe.pdf_chemin);
  const octets = fichier ? new Uint8Array(await fichier.arrayBuffer()) : new Uint8Array();
  verifie("le PDF est un PDF", Buffer.from(octets.slice(0, 5)).toString() === "%PDF-");
  verifie(
    "l'empreinte du PDF est la bonne",
    createHash("sha256").update(octets).digest("hex") === signe.empreinte_pdf,
  );

  const { data: signeSeul } = await admin.from("radar_bookings").select("sale_amount_cents").eq("id", r1.id).single();
  verifie("signé sans payer : pas encore de vente dans Radar", signeSeul.sale_amount_cents === null, JSON.stringify(signeSeul));

  await moteur.noterPaiement(admin, await moteur.devisDuLien(admin, orgs.a.id, lien), "paye", "cs_test_zz");
  await moteur.noterPaiement(admin, await moteur.devisDuLien(admin, orgs.a.id, lien), "paye", "cs_test_zz");
  const { data: vente } = await admin
    .from("radar_bookings")
    .select("sale_amount_cents, sale_fois, sale_premier_cents, sale_note")
    .eq("id", r1.id)
    .single();
  verifie("payé : la vente est dans Radar", vente.sale_amount_cents === 152_000, JSON.stringify(vente));
  verifie("6 paiements, 670 € le premier", vente.sale_fois === 6 && vente.sale_premier_cents === 67_000, JSON.stringify(vente));
  const { data: activite } = await admin
    .from("radar_booking_activities")
    .select("type, payload")
    .eq("booking_id", r1.id)
    .eq("type", "sale.recorded");
  verifie("activité « source : devis »", activite?.[0]?.payload?.source === "devis");

  const pdf = await moteur.pdfSigne(admin, PROFILS_DEVIS[orgs.a.slug], await moteur.devisDuLien(admin, orgs.a.id, lien));
  verifie("PDF relu", pdf && Buffer.from(pdf.slice(0, 5)).toString() === "%PDF-");
  const { count: payes } = await admin
    .from("devis_evenements")
    .select("id", { count: "exact", head: true })
    .eq("devis_id", cree.id)
    .eq("genre", "paye");
  verifie("payé noté une fois", payes === 1, String(payes));

  // ------------------------------ Remplacer, expirer, relancer -------------
  const r2 = await rdv(orgs.a.id, "Deux", -2 * 3600_000, comptes.c1);
  const premier = await moteur.creerDevis(admin, demande(r2.id, comptes.c1, { paiement: "une_fois" }));
  const second = await moteur.creerDevis(admin, demande(r2.id, comptes.c1, { dureeMois: 3 }));
  const { data: ancien } = await admin.from("devis").select("statut, total_cents").eq("id", premier.id).single();
  verifie("un devis corrigé annule le précédent", ancien.statut === "annule");
  verifie("1 fois : 50 € de moins", ancien.total_cents === 147_000, String(ancien.total_cents));

  // Le second, envoyé il y a deux jours : un rappel attendu ; le site ne répond pas.
  await admin
    .from("devis")
    .update({ envoye_le: iso(-2 * 86_400_000), valide_jusqu_au: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) })
    .eq("id", second.id);
  const demain10h = (() => {
    const j = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + 86_400_000));
    return Date.parse(`${j}T10:05:00+02:00`);
  })();
  const passe = await moteur.relancerDevis(admin, demain10h);
  const { data: apres } = await admin.from("devis").select("relances, relance_le, statut").eq("id", second.id).single();
  verifie("site muet : rappel rendu au passage suivant", passe.rappels === 0 && apres.relances === 0 && apres.relance_le === null, JSON.stringify(apres));

  await admin.from("devis").update({ valide_jusqu_au: "2020-01-01" }).eq("id", second.id);
  await moteur.relancerDevis(admin);
  const { data: perime } = await admin.from("devis").select("statut").eq("id", second.id).single();
  verifie("validité passée : expiré", perime.statut === "expire");
  const tardif = await moteur.signer(admin, PROFILS_DEVIS[orgs.a.slug], await moteur.devisDuLien(admin, orgs.a.id, second.lien), {
    adresse: "1 rue du Banc, 69100 Villeurbanne",
    demarrageImmediat: false,
    ip: null,
    agent: null,
  });
  verifie("un devis expiré ne se signe plus", !tardif.ok && tardif.raison === "expire");

  // ------------------------------ Séance annulée ---------------------------
  const surAnnule = await moteur.creerDevis(admin, demande(rAnnule.id, comptes.c1));
  await moteur.signer(admin, PROFILS_DEVIS[orgs.a.slug], await moteur.devisDuLien(admin, orgs.a.id, surAnnule.lien), {
    adresse: "1 rue du Banc, 69100 Villeurbanne",
    demarrageImmediat: false,
    ip: null,
    agent: null,
  });
  await moteur.noterPaiement(admin, await moteur.devisDuLien(admin, orgs.a.id, surAnnule.lien), "paye", "cs_test_zz_annule");
  const { data: sansVente } = await admin.from("radar_bookings").select("sale_amount_cents").eq("id", rAnnule.id).single();
  verifie("pas de vente sur une séance annulée", sansVente.sale_amount_cents === null);
} catch (erreur) {
  verifie("le banc a tourné jusqu'au bout", false, erreur instanceof Error ? erreur.stack : String(erreur));
} finally {
  // ------------------------------ Ménage -----------------------------------
  for (const org of Object.values(orgs)) {
    const { data: fichiers } = await admin.storage.from("devis").list(org.id);
    if (fichiers?.length) await admin.storage.from("devis").remove(fichiers.map((f) => `${org.id}/${f.name}`));
    await admin.from("devis").delete().eq("organization_id", org.id);
    await admin.from("radar_bookings").delete().eq("organization_id", org.id);
    await admin.from("organizations").delete().eq("id", org.id);
  }
  for (const id of Object.values(comptes)) await supprimerCompte(id);
  const { count: restes } = await admin
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .like("slug", `zz-qa-devis-%-${marque}`);
  console.log(`Ménage : ${restes ?? "?"} organisation(s) de test restante(s).`);
  bilan();
}
