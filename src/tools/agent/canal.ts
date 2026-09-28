import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import type { CleModele, ValeursModele } from "./profil.ts";
import { profil as profilDe } from "./profils/index.ts";
import {
  codeRefus,
  corpsBoutonLien,
  corpsModele,
  corpsTexte,
  raisonRefus,
  refusDefinitif,
  VERSION_API,
} from "./whatsapp-regles.ts";

/**
 * Par où les messages partent.
 *
 * Le reste de l'agent ne sait pas s'il parle par WhatsApp ou à Louis dans la
 * page de simulation : il demande à un canal d'envoyer, et le canal répond si
 * c'est parti.
 */

export type Envoi = {
  organisationId: string;
  telephone: string | null;
  /** Le texte tel qu'elle le lira, tel qu'il est gardé dans `agent_messages`. */
  texte: string;
  /** Un modèle validé par Meta : obligatoire hors de la fenêtre de 24 h. */
  modele?: { cle: CleModele; profil: string; valeurs: ValeursModele };
  /** Un message libre avec un bouton qui ouvre ce lien. */
  lien?: { texte: string; url: string };
};

type Admin = ReturnType<typeof createAdminClient>;

/**
 * `definitif` : retenter dans 5 minutes n'y changerait rien (numéro sans
 * WhatsApp, modèle absent, réglage manquant). Sinon, l'horloge retentera.
 */
export type Resultat =
  | { ok: true; idExterne: string | null }
  | { ok: false; erreur: string; definitif: boolean };

export type Canal = {
  nom: "simule" | "whatsapp";
  envoyer(admin: Admin, envoi: Envoi): Promise<Resultat>;
};

/** La simulation : le message est déjà dans la base, Louis le lit dans le hub. */
export const canalSimule: Canal = {
  nom: "simule",
  async envoyer() {
    return { ok: true, idExterne: null };
  },
};

const DELAI_MS = 15_000;

/**
 * L'API Cloud de WhatsApp, au nom du client : son numéro (`agent_reglages`,
 * 0043) et le jeton de son utilisateur système (Vault, 0033). Un modèle part
 * sous son nom Meta (`diag_<clé>`) avec ses variables ; un message libre part
 * en texte. Ne lève jamais : un refus rend sa raison, gardée dans `erreur`.
 */
export const canalWhatsapp: Canal = {
  nom: "whatsapp",
  async envoyer(admin, envoi) {
    if (!envoi.telephone) return { ok: false, erreur: "Aucun numéro où écrire.", definitif: true };

    const [{ data: reglages }, { data: jeton }] = await Promise.all([
      admin
        .from("agent_reglages")
        .select("whatsapp_numero_id")
        .eq("organization_id", envoi.organisationId)
        .maybeSingle(),
      admin.rpc("agent_get_secret", { org: envoi.organisationId, kind: "whatsapp_token" }),
    ]);
    const numeroId = reglages?.whatsapp_numero_id;
    if (!numeroId) return { ok: false, erreur: "Numéro WhatsApp absent du réglage.", definitif: true };
    if (!jeton) return { ok: false, erreur: "Jeton WhatsApp absent du Vault.", definitif: true };

    let corps;
    if (envoi.modele) {
      const profil = profilDe(envoi.modele.profil);
      if (!profil) return { ok: false, erreur: `Profil inconnu : ${envoi.modele.profil}`, definitif: true };
      const cle = envoi.modele.cle;
      corps = corpsModele(envoi.telephone, cle, profil.modeles[cle], envoi.modele.valeurs);
    } else if (envoi.lien) {
      corps = corpsBoutonLien(envoi.telephone, envoi.texte, envoi.lien);
    } else {
      corps = corpsTexte(envoi.telephone, envoi.texte);
    }

    try {
      const reponse = await fetch(`https://graph.facebook.com/${VERSION_API}/${numeroId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jeton}`,
          "Content-Type": "application/json",
          "User-Agent": "comete-hub-agent/1.0",
        },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(DELAI_MS),
      });
      const lu: unknown = await reponse.json().catch(() => null);
      if (!reponse.ok) {
        const erreur = raisonRefus(lu, reponse.status);
        console.error("Agent : WhatsApp a refusé l'envoi", erreur);
        return { ok: false, erreur, definitif: refusDefinitif(reponse.status, codeRefus(lu)) };
      }
      const id = (lu as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id ?? null;
      return { ok: true, idExterne: id };
    } catch {
      console.error("Agent : WhatsApp n'a pas répondu");
      return { ok: false, erreur: "WhatsApp n'a pas répondu.", definitif: false };
    }
  },
};

export function canalPour(simulation: boolean, reglage: string): Canal {
  if (simulation) return canalSimule;
  return reglage === "whatsapp" ? canalWhatsapp : canalSimule;
}
