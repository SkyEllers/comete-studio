import "server-only";

import type { CleModele, ValeursModele } from "./profil.ts";

/**
 * Par où les messages partent.
 *
 * Le reste de l'agent ne sait pas s'il parle par WhatsApp ou à Louis dans la
 * page de simulation : il demande à un canal d'envoyer, et le canal répond si
 * c'est parti. Brancher WhatsApp, ce sera écrire un deuxième canal, rien
 * d'autre.
 */

export type Envoi = {
  telephone: string | null;
  /** Le texte tel qu'elle le lira, tel qu'il est gardé dans `agent_messages`. */
  texte: string;
  /** Un modèle validé par Meta : obligatoire hors de la fenêtre de 24 h. */
  modele?: { cle: CleModele; profil: string; valeurs: ValeursModele };
};

export type Resultat = { ok: true; idExterne: string | null } | { ok: false; erreur: string };

export type Canal = {
  nom: "simule" | "whatsapp";
  envoyer(envoi: Envoi): Promise<Resultat>;
};

/** La simulation : le message est déjà dans la base, Louis le lit dans le hub. */
export const canalSimule: Canal = {
  nom: "simule",
  async envoyer() {
    return { ok: true, idExterne: null };
  },
};

/** Branché quand le portefeuille Meta de Peggy sera accessible. */
export const canalWhatsapp: Canal = {
  nom: "whatsapp",
  async envoyer() {
    return { ok: false, erreur: "WhatsApp n'est pas encore branché." };
  },
};

export function canalPour(simulation: boolean, reglage: string): Canal {
  if (simulation) return canalSimule;
  return reglage === "whatsapp" ? canalWhatsapp : canalSimule;
}
