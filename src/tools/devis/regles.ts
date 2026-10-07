/**
 * Le devis signé en ligne (P16, Louis, 28/09/2026) : ce qui se calcule sans
 * base. Les montants, la validité, les rappels, le texte montré à la cliente
 * et l'empreinte de ce qu'elle signe.
 *
 * Le texte vient du profil du client (`profils/<client>.ts`) ; ici, on ne fait
 * que le remplir. Il se teste sans base.
 */

import { createHash } from "node:crypto";

import { ajouterJours, instantLocal, jourLocal } from "../agent/temps.ts";

export const PARIS = "Europe/Paris";

/** L'heure du rappel quotidien d'un devis pas encore signé. */
export const HEURE_DU_RAPPEL = 10;

export type Paiement = "une_fois" | "plusieurs";

/** L'entreprise qui vend, imprimée sur le devis. */
export type Vendeur = {
  nom: string;
  identifiant: string;
  adresse: string;
  telephone: string;
  email: string;
  /** Qui accompagne, une ligne par personne (« Peggy Girault, thérapeute… »). */
  intervenants: string[];
  /** Le nom qui signe l'offre (« Peggy GIRAULT »). */
  signataire: string;
};

/** Un bloc du texte : un titre, puis des paragraphes et des puces. */
export type Bloc = {
  titre?: string;
  paragraphes?: string[];
  puces?: string[];
  apres?: string[];
};

export type ProfilDevis = {
  /** Le slug de l'organisation dans le hub. */
  slug: string;
  site: string;
  titre: string;
  sousTitre: string;
  enTete: string;
  vendeur: Vendeur;
  investigationCents: number;
  mensualiteCents: number;
  remiseUneFoisCents: number;
  dureeParDefaut: number;
  validiteJours: number;
  /** Change à chaque modification du texte : le devis garde celle qu'il a signée. */
  versionTexte: string;
  /** Le texte avant l'investissement (l'objet, les phases). */
  avant: Bloc[];
  /** Le même pour une investigation seule (sans les phases qu'elle n'achète pas) ; `avant` à défaut. */
  avantInvestigationSeule?: Bloc[];
  /** Ce que comprend la mensualité, en puces. */
  mensualiteComprend: string[];
  /** Le texte après l'investissement (conditions, rétractation…). */
  apres: Bloc[];
};

export type Montants = {
  investigationCents: number;
  mensualiteCents: number;
  remiseUneFoisCents: number;
  dureeMois: number;
  /** 500 + 150 × durée. */
  totalEchelonneCents: number;
  /** Le même, moins la remise. */
  totalUneFoisCents: number;
  paiement: Paiement;
  /** Ce que la cliente paiera, selon son choix. */
  totalCents: number;
};

/**
 * La durée 0 veut dire « investigation seule » (Louis, 07/10/2026) : la
 * cliente ne prend que l'investigation, en 1 fois, sans accompagnement. Elle
 * se garde en base comme 1 mois à 0 € (la colonne `duree_mois` va de 1 à 24) :
 * c'est la mensualité à 0 qui la reconnaît ensuite (`investigationSeule`).
 */
export const INVESTIGATION_SEULE = 0;

export function montants(p: Pick<ProfilDevis, "investigationCents" | "mensualiteCents" | "remiseUneFoisCents">, dureeMois: number, paiement: Paiement): Montants {
  if (!Number.isInteger(dureeMois) || dureeMois < 0 || dureeMois > 24) {
    throw new Error("La durée va de 1 à 24 mois.");
  }
  if (dureeMois === INVESTIGATION_SEULE) {
    return montants({ investigationCents: p.investigationCents, mensualiteCents: 0, remiseUneFoisCents: 0 }, 1, "une_fois");
  }
  const totalEchelonneCents = p.investigationCents + p.mensualiteCents * dureeMois;
  const totalUneFoisCents = totalEchelonneCents - p.remiseUneFoisCents;
  return {
    investigationCents: p.investigationCents,
    mensualiteCents: p.mensualiteCents,
    remiseUneFoisCents: p.remiseUneFoisCents,
    dureeMois,
    totalEchelonneCents,
    totalUneFoisCents,
    paiement,
    totalCents: paiement === "une_fois" ? totalUneFoisCents : totalEchelonneCents,
  };
}

/** La cliente ne prend que l'investigation : pas de mensualité. */
export function investigationSeule(m: Pick<Montants, "mensualiteCents">): boolean {
  return m.mensualiteCents === 0;
}

/** « 1 250 € », « 1 250,50 € ». */
export function euros(cents: number): string {
  const entier = cents % 100 === 0;
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: entier ? 0 : 2,
    maximumFractionDigits: 2,
  })
    .format(cents / 100)
    .replace(/ | /g, " ")} €`;
}

/** Le dernier jour où le devis se signe, compté depuis le jour d'envoi. */
export function valideJusquAu(envoyeLe: number, validiteJours: number): string {
  return ajouterJours(jourLocal(envoyeLe, PARIS), validiteJours);
}

/** « 5 octobre 2026 ». */
export function dateEnMots(jour: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${jour}T12:00:00Z`),
  );
}

/** « 5 octobre 2026 à 14h07 », heure de Paris. */
export function instantEnMots(instant: string | number | Date): string {
  const d = new Date(instant);
  const jour = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: PARIS }).format(d);
  const heure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: PARIS })
    .format(d)
    .replace(":", "h");
  return `${jour} à ${heure}`;
}

/**
 * Faut-il envoyer le rappel du jour ? Un par jour, à partir du lendemain de
 * l'envoi, à 10h, jusqu'au dernier jour de validité compris (Peggy : « un
 * rappel chaque jour »). Rien pour un devis signé, expiré ou annulé.
 */
export function rappelDu(
  d: { statut: string; envoye_le: string; relance_le: string | null; valide_jusqu_au: string },
  maintenant: number,
): boolean {
  if (d.statut !== "envoye") return false;
  const aujourdhui = jourLocal(maintenant, PARIS);
  if (aujourdhui > d.valide_jusqu_au) return false;
  if (aujourdhui <= jourLocal(d.envoye_le, PARIS)) return false;
  if (maintenant < instantLocal(aujourdhui, HEURE_DU_RAPPEL, 0, PARIS)) return false;
  if (d.relance_le && jourLocal(d.relance_le, PARIS) >= aujourdhui) return false;
  return true;
}

/** Le devis n'est plus signable : le jour qui suit sa validité. */
export function expire(d: { statut: string; valide_jusqu_au: string }, maintenant: number): boolean {
  return d.statut === "envoye" && jourLocal(maintenant, PARIS) > d.valide_jusqu_au;
}

// ------------------------------ Le texte ------------------------------------

export type Cliente = {
  prenom: string;
  nom: string | null;
  email: string;
  telephone: string | null;
  adresse: string | null;
};

/** Le devis complet, prêt à montrer (page du site) ou à imprimer (PDF). */
export type Contenu = {
  version: string;
  titre: string;
  sousTitre: string;
  enTete: string;
  cliente: Cliente;
  vendeur: Vendeur;
  montants: Montants;
  valideJusquAu: string;
  blocs: Bloc[];
};

export function nomComplet(c: Pick<Cliente, "prenom" | "nom">): string {
  return [c.nom?.trim(), c.prenom.trim()].filter(Boolean).join(" ");
}

export function contenu(p: ProfilDevis, cliente: Cliente, m: Montants, valide: string): Contenu {
  const seule = investigationSeule(m);
  const investissement: Bloc = seule
    ? {
        titre: "Investissement",
        paragraphes: [
          `${euros(m.investigationCents)} : investigation initiale seule. Analyses, tests et investigations nécessaires pour comprendre votre fonctionnement.`,
        ],
        apres: [
          "L'accompagnement mensuel n'est pas compris dans ce devis.",
          `Votre choix : paiement en 1 fois, ${euros(m.totalCents)}.`,
        ],
      }
    : {
    titre: "Investissement",
    paragraphes: [
      `${euros(m.investigationCents)} : investigation initiale. Analyses, tests et investigations nécessaires pour comprendre votre fonctionnement et construire votre stratégie personnalisée.`,
      `Puis ${euros(m.mensualiteCents)} par mois : accompagnement, durée ${m.dureeMois} mois.`,
    ],
    puces: p.mensualiteComprend,
    apres: [
      `Si paiement en 1 fois, -${euros(m.remiseUneFoisCents)} de frais d'échelonnement.`,
      "Le tarif comprend l'accompagnement global, les outils sélectionnés par la thérapeute, le suivi, les séances, les ressources et les ajustements nécessaires dans le cadre du parcours.",
      `Total en échelonnement : ${euros(m.totalEchelonneCents)} (${euros(m.investigationCents)}, puis ${m.dureeMois} mensualités de ${euros(m.mensualiteCents)}).`,
      `Total en paiement 1 fois : ${euros(m.totalUneFoisCents)} (remise de ${euros(m.remiseUneFoisCents)} de frais d'échelonnement).`,
      m.paiement === "une_fois"
        ? `Votre choix : paiement en 1 fois, ${euros(m.totalCents)}.`
        : `Votre choix : paiement en plusieurs fois, ${euros(m.totalCents)} au total.`,
    ],
  };
  const modalites: Bloc = {
    titre: "Modalités de paiement",
    paragraphes: [
      "Juste après la signature, vous recevez un lien de paiement sécurisé (Stripe). Vous payez par carte bancaire, ou par prélèvement SEPA si vous le préférez.",
      m.paiement === "une_fois"
        ? `Paiement en 1 fois : ${euros(m.totalCents)}.`
        : m.dureeMois === 1
          ? `Paiement à la mise en place : ${euros(m.totalCents)}.`
          : `Paiement en plusieurs fois : ${euros(m.investigationCents + m.mensualiteCents)} à la mise en place (l'investigation et la première mensualité), puis ${euros(m.mensualiteCents)} par mois pendant les ${m.dureeMois - 1} mois suivants, prélevés automatiquement.`,
      "Le paiement est mis en place AVANT le 1er RDV.",
    ],
  };
  const conditions: Bloc = {
    titre: "Conditions",
    paragraphes: [
      `Ce devis est valable jusqu'au ${dateEnMots(valide)} inclus.`,
      `La signature du devis vaut acceptation des conditions générales de vente disponibles sur le site : ${p.site.replace(/^https?:\/\//, "")}/cgv`,
    ],
  };
  return {
    version: p.versionTexte,
    titre: p.titre,
    sousTitre: p.sousTitre,
    enTete: p.enTete,
    cliente,
    vendeur: p.vendeur,
    montants: m,
    valideJusquAu: valide,
    blocs: [
      ...(seule ? (p.avantInvestigationSeule ?? p.avant) : p.avant),
      investissement,
      modalites,
      conditions,
      ...p.apres,
      formulaireRetractation(p.vendeur),
    ],
  };
}

/**
 * Le formulaire type de rétractation (Code de la consommation, annexe à
 * l'article R221-1), joint à tout contrat conclu à distance (L221-5, L221-13).
 */
export function formulaireRetractation(v: Vendeur): Bloc {
  return {
    titre: "Formulaire de rétractation",
    paragraphes: [
      "(Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.)",
      `À l'attention de ${v.nom}, ${v.adresse}, ${v.email} :`,
      "Je vous notifie par la présente ma rétractation du contrat portant sur la prestation de services ci-dessous :",
      "Commandé le : ………………",
      "Nom du consommateur : ………………",
      "Adresse du consommateur : ………………",
      "Signature du consommateur (uniquement en cas de notification du présent formulaire sur papier) : ………………",
      "Date : ………………",
    ],
  };
}

/**
 * L'empreinte de ce qui est signé : le contenu entier (texte, montants,
 * identité, validité), sérialisé toujours de la même façon. Elle s'imprime
 * sur le PDF et se garde en base : un seul mot changé la change.
 */
export function empreinte(c: Contenu): string {
  return createHash("sha256").update(serialiser(c)).digest("hex");
}

function serialiser(valeur: unknown): string {
  if (Array.isArray(valeur)) return `[${valeur.map(serialiser).join(",")}]`;
  if (valeur && typeof valeur === "object") {
    const cles = Object.keys(valeur as Record<string, unknown>)
      .filter((k) => (valeur as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${cles.map((k) => `${JSON.stringify(k)}:${serialiser((valeur as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(valeur ?? null);
}

// ------------------------------ Le lien -------------------------------------

/** Le lien personnel : 64 caractères hexadécimaux, jamais gardé en clair. */
export function lienValide(lien: unknown): lien is string {
  return typeof lien === "string" && /^[0-9a-f]{64}$/.test(lien);
}

export function empreinteLien(lien: string): string {
  return createHash("sha256").update(lien).digest("hex");
}

export function adresseDuDevis(site: string, lien: string): string {
  return `${site.replace(/\/+$/, "")}/devis/#${lien}`;
}

/** Nettoie une saisie : espaces en trop, longueur bornée. */
export function propre(texte: unknown, max: number): string | null {
  if (typeof texte !== "string") return null;
  const t = texte.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}
