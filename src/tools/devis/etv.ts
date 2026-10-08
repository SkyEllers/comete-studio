import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { envoyer } from "../fichiers/courriel.ts";

import { comptePret, demandeEtv, type DevisPourEtv, type EtatEtv } from "./etv-regles.ts";
import { noter } from "./moteur.ts";

/**
 * Le compte de la cliente dans l'app de Peggy, créé quand elle réserve son
 * premier rendez-vous (Louis, 08/10/2026), par la fonction `creer-cliente`
 * de l'app (dépôt etincelle-communaute). Elle passe le tunnel puis attend
 * que Peggy valide ses tests pendant ce rendez-vous.
 *
 * L'adresse de l'app et sa clé publique (anon, la même que dans l'app
 * servie à toutes) sont ici ; le secret partagé, `ETV_CREATION_SECRET`, est
 * dans Vercel et dans les secrets des fonctions de l'app. Sans lui, rien ne
 * part et la réservation ne change pas.
 */

type Admin = ReturnType<typeof createAdminClient>;

const APPS: Record<string, { url: string; cleAnon: string; app: string }> = {
  peggy: {
    url: "https://mjzosqertxnejpetqwdg.supabase.co",
    cleAnon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qem9zcWVydHhuZWpwZXRxd2RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Nzc3ODAsImV4cCI6MjA5MjQ1Mzc4MH0.EUhi4iyBjOy3r_LnItBDUR5LfcQuL0ZDTeV73NN7GIg",
    app: "https://app.peggygirault.fr",
  },
};

export type CompteEtv = { etat: EtatEtv; invitation: boolean; pret: boolean; app: string };

/**
 * Créer (ou mettre à jour : rendez-vous déplacé) son compte. Ne lève jamais :
 * un échec laisse la réservation intacte, se note sur le devis et prévient
 * Louis.
 */
export async function ouvrirCompteEtv(
  admin: Admin,
  slug: string,
  d: DevisPourEtv & { id: string },
  premierRdvLe: string | null,
): Promise<CompteEtv | null> {
  const app = APPS[slug];
  const secret = process.env.ETV_CREATION_SECRET?.trim();
  if (!app) return null;
  if (!secret) {
    console.error("Compte ETV : ETV_CREATION_SECRET absent, rien n'est créé");
    return null;
  }
  try {
    const r = await fetch(`${app.url}/functions/v1/creer-cliente`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${app.cleAnon}`,
        apikey: app.cleAnon,
        "x-etv-secret": secret,
        "content-type": "application/json",
        "user-agent": "comete-hub/etv",
      },
      body: JSON.stringify(demandeEtv(d, premierRdvLe)),
      signal: AbortSignal.timeout(12_000),
    });
    const corps = (await r.json().catch(() => null)) as { etat?: EtatEtv; invitation?: boolean } | null;
    if (!r.ok || !corps?.etat) throw new Error(`réponse ${r.status}`);
    await noter(admin, d.id, "etv_compte", { details: { etat: corps.etat, invitation: Boolean(corps.invitation) } });
    if (corps.etat === "deja_cliente") {
      await envoyer({
        sujet: `App ETV : ${d.prenom} a déjà un compte, rien n'a été changé`,
        texte: `${d.prenom} ${d.nom ?? ""} vient de réserver son premier rendez-vous avec Peggy. Son adresse a déjà un compte de cliente (ou d'admin) dans l'app : le hub n'y a pas touché. À régler à la main dans Admin → Membres (pack, durée, attente de Peggy).\n`,
        html: `<p>${d.prenom} vient de réserver son premier rendez-vous avec Peggy. Son adresse a déjà un compte de cliente (ou d'admin) dans l'app : le hub n'y a pas touché.</p><p>À régler à la main dans Admin → Membres (pack, durée, attente de Peggy).</p>`,
      });
    }
    return { etat: corps.etat, invitation: Boolean(corps.invitation), pret: comptePret(corps.etat), app: app.app };
  } catch (erreur) {
    const quoi = erreur instanceof Error ? erreur.message : "erreur";
    console.error("Compte ETV :", quoi);
    await noter(admin, d.id, "etv_echec", { details: { raison: quoi } });
    await envoyer({
      sujet: `App ETV : le compte de ${d.prenom} n'a pas pu être créé`,
      texte: `Le hub n'a pas pu créer le compte de ${d.prenom} dans l'app après la réservation de son premier rendez-vous (${quoi}). À faire à la main dans Admin → Membres.\n`,
      html: `<p>Le hub n'a pas pu créer le compte de ${d.prenom} dans l'app après la réservation de son premier rendez-vous (${quoi}).</p><p>À faire à la main dans Admin → Membres.</p>`,
    });
    return null;
  }
}
