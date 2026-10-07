import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { createAdminClient } from "@/lib/supabase/admin";

import { pdfDuDevis, type Evenement } from "./pdf.ts";
import { PROFILS_DEVIS } from "./profils/peggy.ts";
import {
  contenu,
  empreinte,
  empreinteLien,
  expire,
  montants,
  propre,
  rappelDu,
  valideJusquAu,
  type Contenu,
  type Paiement,
  type ProfilDevis,
} from "./regles.ts";

/**
 * Le moteur du devis signé en ligne (P16, 28/09/2026) : créer, montrer,
 * signer, relancer. Toutes les écritures passent par le serveur (service
 * role) ; les droits de celle qui crée se vérifient avant, dans l'action.
 *
 * Les mails partent du site du client, de son adresse, comme ceux de l'outil
 * de réservation : le hub demande, le site relit le devis au hub avec son
 * propre jeton, puis écrit à la cliente (`notifierSite`).
 */

type Admin = ReturnType<typeof createAdminClient>;

export type LigneDevis = {
  id: string;
  organization_id: string;
  booking_id: string | null;
  closeuse_id: string | null;
  cree_par: string | null;
  prenom: string;
  nom: string | null;
  email: string;
  telephone: string | null;
  adresse: string | null;
  duree_mois: number;
  paiement: Paiement;
  investigation_cents: number;
  mensualite_cents: number;
  remise_une_fois_cents: number;
  total_cents: number;
  devise: string;
  vendeur: unknown;
  version_texte: string;
  valide_jusqu_au: string;
  statut: "envoye" | "signe" | "expire" | "annule";
  envoye_le: string;
  ouvert_le: string | null;
  relance_le: string | null;
  relances: number;
  signe_le: string | null;
  demarrage_immediat: boolean | null;
  empreinte_contenu: string | null;
  pdf_chemin: string | null;
  paiement_lien_le: string | null;
  paye_le: string | null;
};

const COLONNES =
  "id, organization_id, booking_id, closeuse_id, cree_par, prenom, nom, email, telephone, adresse, duree_mois, paiement, investigation_cents, mensualite_cents, remise_une_fois_cents, total_cents, devise, vendeur, version_texte, valide_jusqu_au, statut, envoye_le, ouvert_le, relance_le, relances, signe_le, demarrage_immediat, empreinte_contenu, pdf_chemin, paiement_lien_le, paye_le";

/*
 * Les tables du devis (0050) ne sont pas encore dans les types générés de la
 * base au moment d'écrire ce fichier : on passe par un client non typé pour
 * elles seules.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brut = (admin: Admin) => admin as any;

export async function profilDe(admin: Admin, organizationId: string): Promise<ProfilDevis | null> {
  const { data } = await admin.from("organizations").select("slug").eq("id", organizationId).maybeSingle();
  return data?.slug ? (PROFILS_DEVIS[data.slug] ?? null) : null;
}

/** Le devis tel que la cliente l'a vu ou le voit : texte, montants, identité. */
export function contenuDe(p: ProfilDevis, d: LigneDevis): Contenu {
  const m = montants(
    {
      investigationCents: d.investigation_cents,
      mensualiteCents: d.mensualite_cents,
      remiseUneFoisCents: d.remise_une_fois_cents,
    },
    d.duree_mois,
    d.paiement,
  );
  return contenu(
    p,
    { prenom: d.prenom, nom: d.nom, email: d.email, telephone: d.telephone, adresse: d.adresse },
    m,
    d.valide_jusqu_au,
  );
}

export async function noter(
  admin: Admin,
  devisId: string,
  genre: string,
  o: { ip?: string | null; agent?: string | null; details?: Record<string, unknown> } = {},
) {
  await brut(admin)
    .from("devis_evenements")
    .insert({ devis_id: devisId, genre, ip: o.ip ?? null, agent: o.agent ?? null, details: o.details ?? {} });
}

// ------------------------------ Créer ---------------------------------------

export type Demande = {
  organizationId: string;
  bookingId: string;
  closeuseId: string | null;
  creePar: string;
  prenom: string;
  nom: string | null;
  email: string;
  telephone: string | null;
  dureeMois: number;
  paiement: Paiement;
};

/**
 * Crée le devis et rend son lien personnel. Un devis encore ouvert sur le même
 * rendez-vous passe « annule » : c'est le nouveau qui compte.
 */
export async function creerDevis(admin: Admin, q: Demande): Promise<{ id: string; lien: string } | { erreur: string }> {
  const p = await profilDe(admin, q.organizationId);
  if (!p) return { erreur: "Le devis en ligne n'est pas encore ouvert pour cet espace." };

  const m = montants(p, q.dureeMois, q.paiement);
  const lien = randomBytes(32).toString("hex");
  const maintenant = Date.now();

  const { data: anciens } = await brut(admin)
    .from("devis")
    .select("id")
    .eq("booking_id", q.bookingId)
    .eq("statut", "envoye");
  for (const a of (anciens ?? []) as { id: string }[]) {
    await brut(admin).from("devis").update({ statut: "annule" }).eq("id", a.id);
    await noter(admin, a.id, "annule", { details: { raison: "remplacé par un nouveau devis" } });
  }

  const { data, error } = await brut(admin)
    .from("devis")
    .insert({
      organization_id: q.organizationId,
      booking_id: q.bookingId,
      closeuse_id: q.closeuseId,
      cree_par: q.creePar,
      jeton_hash: empreinteLien(lien),
      prenom: q.prenom,
      nom: q.nom,
      email: q.email,
      telephone: q.telephone,
      duree_mois: m.dureeMois,
      paiement: m.paiement,
      investigation_cents: m.investigationCents,
      mensualite_cents: m.mensualiteCents,
      remise_une_fois_cents: m.remiseUneFoisCents,
      total_cents: m.totalCents,
      vendeur: p.vendeur,
      version_texte: p.versionTexte,
      valide_jusqu_au: valideJusquAu(maintenant, p.validiteJours),
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("Devis, création :", error?.message);
    return { erreur: "Le devis n'a pas pu être créé." };
  }
  await brut(admin).from("devis_liens").insert({ devis_id: data.id, lien });
  await noter(admin, data.id, "cree", { details: { par: q.creePar } });
  return { id: data.id, lien };
}

// ------------------------------ Lire ----------------------------------------

export async function devisDuLien(admin: Admin, organizationId: string, lien: string): Promise<LigneDevis | null> {
  const { data } = await brut(admin)
    .from("devis")
    .select(COLONNES)
    .eq("organization_id", organizationId)
    .eq("jeton_hash", empreinteLien(lien))
    .maybeSingle();
  return (data as LigneDevis | null) ?? null;
}

/** Ce que le site montre : le texte, les montants, l'état. Jamais d'identifiant interne. */
export function vuePourSite(p: ProfilDevis, d: LigneDevis, maintenant = Date.now()) {
  const statut = expire(d, maintenant) ? "expire" : d.statut;
  return {
    statut,
    contenu: contenuDe(p, d),
    signeLe: d.signe_le,
    payeLe: d.paye_le,
    demarrageImmediat: d.demarrage_immediat,
    email: d.email,
    prenom: d.prenom,
    nom: d.nom,
  };
}

/** Première ouverture par la cliente : l'heure, l'adresse IP, le navigateur. */
export async function marquerOuvert(admin: Admin, d: LigneDevis, ip: string | null, agent: string | null) {
  if (d.ouvert_le) return;
  const { data } = await brut(admin)
    .from("devis")
    .update({ ouvert_le: new Date().toISOString() })
    .eq("id", d.id)
    .is("ouvert_le", null)
    .select("id");
  if (data?.length) await noter(admin, d.id, "ouvert", { ip, agent });
}

// ------------------------------ Signer --------------------------------------

export type Signature = { adresse: string; demarrageImmediat: boolean; ip: string | null; agent: string | null };

/**
 * La cliente signe. Dans l'ordre : l'état passe « signe » avec l'empreinte de
 * ce qu'elle a vu (une seule signature gagne) ; le PDF signé, avec son
 * dossier de preuve, se range dans le bucket. **La vente ne s'inscrit pas ici** :
 * elle attend le paiement (`noterPaiement`), signé ne voulant pas dire payé
 * (Louis, 06/10/2026).
 * Le mail avec le PDF et le lien de paiement, c'est le site qui l'envoie.
 */
export async function signer(
  admin: Admin,
  p: ProfilDevis,
  d: LigneDevis,
  s: Signature,
): Promise<{ ok: true; deja?: boolean } | { ok: false; raison: "expire" | "annule" | "erreur" }> {
  if (d.statut === "signe") return { ok: true, deja: true };
  if (d.statut === "annule") return { ok: false, raison: "annule" };
  if (d.statut === "expire" || expire(d, Date.now())) return { ok: false, raison: "expire" };

  const adresse = propre(s.adresse, 400);
  if (!adresse) return { ok: false, raison: "erreur" };
  const signeLe = new Date().toISOString();
  const signe: LigneDevis = { ...d, adresse, signe_le: signeLe, demarrage_immediat: s.demarrageImmediat };
  const c = contenuDe(p, signe);
  const e = empreinte(c);

  const { data: gagne, error } = await brut(admin)
    .from("devis")
    .update({
      statut: "signe",
      adresse,
      signe_le: signeLe,
      demarrage_immediat: s.demarrageImmediat,
      signature_ip: s.ip,
      signature_agent: s.agent,
      empreinte_contenu: e,
    })
    .eq("id", d.id)
    .eq("statut", "envoye")
    .select("id");
  if (error) {
    console.error("Devis, signature :", error.message);
    return { ok: false, raison: "erreur" };
  }
  if (!gagne?.length) return { ok: true, deja: true };

  await noter(admin, d.id, "signe", {
    ip: s.ip,
    agent: s.agent,
    details: { empreinte: e, demarrage_immediat: s.demarrageImmediat, total_cents: d.total_cents },
  });

  await rangerPdf(admin, p, { ...signe, empreinte_contenu: e, statut: "signe" });
  return { ok: true };
}

async function evenementsDe(admin: Admin, devisId: string): Promise<Evenement[]> {
  const { data } = await brut(admin)
    .from("devis_evenements")
    .select("genre, le, ip, agent")
    .eq("devis_id", devisId)
    .order("le");
  return (data ?? []) as Evenement[];
}

/** Fabrique et range le PDF signé. Ne lève jamais : le devis reste signé. */
export async function rangerPdf(admin: Admin, p: ProfilDevis, d: LigneDevis): Promise<Uint8Array | null> {
  try {
    const pdf = await pdfDuDevis(contenuDe(p, d), {
      signeLe: d.signe_le!,
      ip: null,
      agent: null,
      demarrageImmediat: Boolean(d.demarrage_immediat),
      empreinte: d.empreinte_contenu!,
      evenements: await evenementsDe(admin, d.id),
      identifiantDevis: d.id,
    });
    const chemin = `${d.organization_id}/${d.id}.pdf`;
    const { error } = await admin.storage
      .from("devis")
      .upload(chemin, pdf, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(error.message);
    await brut(admin)
      .from("devis")
      .update({ pdf_chemin: chemin, empreinte_pdf: createHash("sha256").update(pdf).digest("hex") })
      .eq("id", d.id);
    await noter(admin, d.id, "pdf", { details: { octets: pdf.length } });
    return pdf;
  } catch (erreur) {
    console.error("Devis, PDF :", erreur instanceof Error ? erreur.message : "erreur");
    return null;
  }
}

/** Le PDF signé, depuis le bucket ; refait s'il manque. */
export async function pdfSigne(admin: Admin, p: ProfilDevis, d: LigneDevis): Promise<Uint8Array | null> {
  if (d.statut !== "signe") return null;
  if (d.pdf_chemin) {
    const { data } = await admin.storage.from("devis").download(d.pdf_chemin);
    if (data) return new Uint8Array(await data.arrayBuffer());
  }
  return rangerPdf(admin, p, d);
}

// ------------------------------ Le site -------------------------------------

/**
 * Demander au site le mail de la cliente : « envoi » (le devis), « rappel »,
 * « signe » (le PDF et le lien de paiement). Ne lève jamais.
 */
export async function notifierSite(site: string, lien: string, geste: "envoi" | "rappel" | "signe"): Promise<boolean> {
  try {
    const r = await fetch(`${site.replace(/\/+$/, "")}/api/devis/notifier`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "comete-hub/devis" },
      body: JSON.stringify({ lien, geste }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) console.error("Devis : le site refuse le mail", geste, r.status);
    return r.ok;
  } catch {
    console.error("Devis : le site ne répond pas", geste);
    return false;
  }
}

/** Écrire à la cliente par le site du client. */
export async function prevenirCliente(p: ProfilDevis, lien: string, geste: "envoi" | "rappel" | "signe"): Promise<boolean> {
  return notifierSite(p.site, lien, geste);
}

async function lienDe(admin: Admin, devisId: string): Promise<string | null> {
  const { data } = await brut(admin).from("devis_liens").select("lien").eq("devis_id", devisId).maybeSingle();
  return (data?.lien as string | undefined) ?? null;
}

/** Envoyer le devis juste créé. */
export async function envoyerDevis(admin: Admin, organizationId: string, devisId: string, lien: string): Promise<boolean> {
  const p = await profilDe(admin, organizationId);
  if (!p) return false;
  const ok = await prevenirCliente(p, lien, "envoi");
  if (ok) await noter(admin, devisId, "envoye");
  return ok;
}

/**
 * L'horloge : le rappel du jour à chaque devis qui l'attend, et « expiré »
 * pour ceux dont la validité est passée. Rend le nombre de rappels partis.
 */
export async function relancerDevis(admin: Admin, maintenant = Date.now()): Promise<{ rappels: number; expires: number }> {
  const { data } = await brut(admin)
    .from("devis")
    .select("id, organization_id, statut, envoye_le, relance_le, relances, valide_jusqu_au")
    .eq("statut", "envoye");
  let rappels = 0;
  let expires = 0;
  for (const d of (data ?? []) as Pick<LigneDevis, "id" | "organization_id" | "statut" | "envoye_le" | "relance_le" | "relances" | "valide_jusqu_au">[]) {
    if (expire(d, maintenant)) {
      await brut(admin).from("devis").update({ statut: "expire" }).eq("id", d.id).eq("statut", "envoye");
      await noter(admin, d.id, "expire");
      expires++;
      continue;
    }
    if (!rappelDu(d, maintenant)) continue;

    // Réserver le rappel du jour : un seul passage gagne.
    const { data: reserve } = await brut(admin)
      .from("devis")
      .update({ relance_le: new Date(maintenant).toISOString(), relances: d.relances + 1 })
      .eq("id", d.id)
      .eq("relances", d.relances)
      .select("id");
    if (!reserve?.length) continue;

    const [p, lien] = await Promise.all([profilDe(admin, d.organization_id), lienDe(admin, d.id)]);
    if (!p || !lien) continue;
    if (await prevenirCliente(p, lien, "rappel")) {
      await noter(admin, d.id, "relance", { details: { numero: d.relances + 1 } });
      rappels++;
    } else {
      // Le site n'a pas envoyé : le passage suivant réessaie.
      await brut(admin).from("devis").update({ relance_le: d.relance_le, relances: d.relances }).eq("id", d.id);
    }
  }
  return { rappels, expires };
}

/**
 * Le site a ouvert la page de paiement, ou Stripe dit que c'est payé. Au
 * premier « payé », la vente s'inscrit dans Radar et chez la closeuse, datée
 * du jour du paiement : une cliente qui signe sans payer n'est pas une vente
 * (Louis, 06/10/2026 ; avant, la vente s'inscrivait à la signature).
 */
export async function noterPaiement(
  admin: Admin,
  d: LigneDevis,
  genre: "paiement_lien" | "paye",
  session: string | null,
): Promise<void> {
  const maintenant = new Date().toISOString();
  if (genre === "paye") {
    if (d.paye_le) return;
    await brut(admin).from("devis").update({ paye_le: maintenant, stripe_session: session }).eq("id", d.id);
    const { data: radar, error: erreurRadar } = await admin.rpc("devis_vers_radar", { devis_cible: d.id });
    if (erreurRadar || radar === false) {
      console.error("Devis : la vente n'a pas pu s'inscrire dans Radar", erreurRadar?.message ?? "refusée");
    }
  } else {
    await brut(admin)
      .from("devis")
      .update({ paiement_lien_le: d.paiement_lien_le ?? maintenant, stripe_session: session })
      .eq("id", d.id);
  }
  await noter(admin, d.id, genre, { details: session ? { session } : {} });
}
