import { investigationSeule, microbioteSeul } from "./regles.ts";

/**
 * Le compte de la cliente dans l'app de Peggy (Étincelle Ta Vie), créé tout
 * seul quand elle réserve son premier rendez-vous (Louis, 08/10/2026). Pur :
 * testé dans etv-regles.test.ts.
 *
 * - Pack « microbiote » pour un bilan microbiote seul (son test est fixé,
 *   l'app s'ouvre après le tunnel) ; « complet » sinon (elle attend que Peggy
 *   valide ses tests pendant le rendez-vous).
 * - Accès depuis la signature : la durée du devis pour un accompagnement,
 *   3 mois pour une investigation seule ou un bilan microbiote seul (Louis).
 */

export type DevisPourEtv = {
  prenom: string;
  nom: string | null;
  email: string;
  telephone: string | null;
  adresse: string | null;
  duree_mois: number;
  investigation_cents: number;
  mensualite_cents: number;
  signe_le: string | null;
  paye_le: string | null;
};

export const MOIS_FORMULE_COURTE = 3;

export function packEtv(d: Pick<DevisPourEtv, "investigation_cents">): "complet" | "microbiote" {
  return microbioteSeul({ investigationCents: d.investigation_cents }) ? "microbiote" : "complet";
}

/** Le même jour, N mois plus tard (le 31 janvier + 1 mois : fin février). */
export function ajouterMois(iso: string, mois: number): string {
  const d = new Date(iso);
  const jour = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + mois);
  const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(jour, dernier));
  return d.toISOString();
}

export function accesEtv(d: DevisPourEtv): { debut: string; fin: string } {
  const debut = d.signe_le ?? d.paye_le ?? new Date().toISOString();
  const courte =
    microbioteSeul({ investigationCents: d.investigation_cents }) ||
    investigationSeule({ mensualiteCents: d.mensualite_cents });
  return { debut, fin: ajouterMois(debut, courte ? MOIS_FORMULE_COURTE : d.duree_mois) };
}

/** Ce que reçoit la fonction `creer-cliente` de l'app. */
export function demandeEtv(d: DevisPourEtv, premierRdvLe: string | null, maintenant = new Date()) {
  const { debut, fin } = accesEtv(d);
  return {
    email: d.email.trim().toLowerCase(),
    prenom: d.prenom.trim(),
    nom: d.nom?.trim() || null,
    telephone: d.telephone,
    adresse: d.adresse,
    pack: packEtv(d),
    debut,
    fin,
    premier_rdv_le: premierRdvLe,
    note: `Compte créé par le hub après le devis payé, le ${maintenant.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}.`,
  };
}

export type EtatEtv = "cree" | "mis_a_jour" | "converti" | "deja_cliente";

/** Le compte est prêt à l'emploi : la page peut proposer d'entrer dans l'app. */
export const comptePret = (etat: EtatEtv | null): boolean => etat === "cree" || etat === "mis_a_jour" || etat === "converti";
