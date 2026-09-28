/**
 * Les factures des closeuses en autofacturation (P16, 0051) : ce qui se
 * calcule sans base. Le numéro, le mandat, le contenu de la facture, son PDF.
 *
 * Sources (lues le 28/09/2026, [[signature-et-factures-recherche]] du vault) :
 * - BOFiP BOI-TVA-DECLA-30-20-10, § 360 à 480 : mandat préalable, acceptation
 *   de chaque facture, mention « Autofacturation », la closeuse reste
 *   responsable de ses déclarations ;
 * - service-public F31808 : mentions d'une facture de micro-entrepreneur
 *   (« EI », SIREN, numéro unique, date, désignation, HT, pénalités de retard,
 *   indemnité de 40 €, « TVA non applicable, art. 293 B du CGI »).
 */

import { PDFDocument, StandardFonts } from "pdf-lib";

import { Ecrivain, GRIS, lisible } from "../devis/pdf.ts";
import type { Bloc } from "../devis/regles.ts";

import type { Paiement, Reprise } from "./commission.ts";

export const VERSION_MANDAT = "mandat-2026-09-28";

/** L'entreprise du client, qui achète et établit les factures. */
export type Acheteur = {
  nom: string;
  forme: string;
  siren: string | null;
  adresse: string;
  /** Délai de paiement, en jours après l'acceptation. */
  delaiJours: number;
};

export type Vendeuse = { nomLegal: string; siren: string; adresse: string; mentionTva: string; email: string | null };

/**
 * L'acheteur de chaque client, quand il est connu. Peggy : son EURL, dont la
 * dénomination exacte et le SIREN attendent les statuts et l'immatriculation
 * (vault, `eurl-2026-10/pieces-et-formalites`) ; tant qu'ils manquent,
 * aucune facture ne se crée (`acheteurComplet`).
 */
export const ACHETEURS: Record<string, Acheteur> = {
  peggy: {
    nom: "",
    forme: "EURL",
    siren: null,
    adresse: "4 rue Léon Fabre, 69100 Villeurbanne",
    delaiJours: 15,
  },
};

export function acheteurComplet(a: Acheteur | undefined | null): a is Acheteur & { siren: string } {
  return Boolean(a && a.nom.trim() && a.siren && /^[0-9]{9}$/.test(a.siren) && a.adresse.trim());
}

export function sirenValide(siren: string): boolean {
  const s = siren.replace(/\s+/g, "");
  if (!/^[0-9]{9}$/.test(s)) return false;
  // Clé de Luhn, comme tout SIREN.
  let somme = 0;
  for (let i = 0; i < 9; i++) {
    let c = Number(s[8 - i]);
    if (i % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    somme += c;
  }
  return somme % 10 === 0;
}

/** « AF-202610-MD-001 » : série propre à chaque closeuse, continue. */
export function numeroFacture(nomLegal: string, mois: string, rang: number): string {
  const initiales = nomLegal
    .replace(/\bEI\b/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((m) => m[0]!.toUpperCase())
    .join("")
    .slice(0, 3);
  return `AF-${mois.slice(0, 4)}${mois.slice(5, 7)}-${initiales || "X"}-${String(rang).padStart(3, "0")}`;
}

/** Le mois écoulé, « AAAA-MM-01 », pour une facture faite le 1er. */
export function moisEcoule(aujourdhui: string): string {
  const [a, m] = aujourdhui.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 2, 1));
  return d.toISOString().slice(0, 10);
}

export function moisEnMots(mois: string): string {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mois}T12:00:00Z`));
}

const euros = (cents: number) =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100).replace(/ | /g, " ")} €`;

/** Faut-il un rappel pour une facture pas encore acceptée ? Tous les deux jours, à partir du surlendemain. */
export function rappelFactureDu(
  f: { statut: string; creee_le: string; relance_le: string | null },
  maintenant: number,
): boolean {
  if (f.statut !== "a_accepter") return false;
  const depuis = Date.parse(f.relance_le ?? f.creee_le);
  return maintenant - depuis >= 2 * 86_400_000;
}

// ------------------------------ Le mandat -----------------------------------

export function texteMandat(nomAcheteur: string): Bloc[] {
  return [
    {
      titre: "Mandat de facturation (autofacturation)",
      paragraphes: [
        `Je donne mandat à ${nomAcheteur || "l'entreprise de Peggy Girault"} d'établir en mon nom et pour mon compte les factures de mes commissions, chaque mois, à partir des ventes que j'ai conclues et des paiements encaissés.`,
        "Chaque facture porte la mention « Autofacturation », mon identité, mon numéro SIREN et un numéro pris dans une série continue qui m'est propre.",
        "Je reçois chaque facture dans mon espace. Je l'accepte en cliquant sur « J'accepte ». Tant que je ne l'ai pas acceptée, elle ne m'est pas payée. Si elle est fausse, je le signale au lieu de l'accepter, et elle est refaite.",
        "Je reste responsable de mes obligations : déclarer mon chiffre d'affaires, et garder mes factures. Je ne fais pas moi-même une autre facture pour les mêmes commissions.",
        "Ce mandat vaut jusqu'à ce que l'une des deux parties y mette fin par écrit. Les factures déjà acceptées restent valables.",
      ],
    },
  ];
}

// ------------------------------ La facture ----------------------------------

export type LignesFacture = { paiements: Paiement[]; reprises: Reprise[] };

export type ContenuFacture = {
  numero: string;
  date: string;
  mois: string;
  vendeuse: Vendeuse;
  acheteur: Acheteur;
  lignes: LignesFacture;
  totalCents: number;
};

export async function pdfFacture(f: ContenuFacture, acceptation: { le: string; ip: string | null } | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(lisible(`Facture ${f.numero}`));
  doc.setAuthor(lisible(f.vendeuse.nomLegal));
  doc.setCreator("Comète Studio");
  const e = new Ecrivain(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    `Facture ${f.numero} · Autofacturation`,
  );

  e.texte(`FACTURE N° ${f.numero}`, { taille: 16, gras: true });
  e.texte("Autofacturation : facture établie par l'acheteur au nom et pour le compte du prestataire.", { couleur: GRIS, avant: 2 });
  e.texte(`Date : ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${f.date}T12:00:00Z`))}`, { avant: 6 });

  e.texte("Prestataire", { gras: true, avant: 12 });
  e.texte(f.vendeuse.nomLegal);
  e.texte(`SIREN : ${f.vendeuse.siren}`);
  e.texte(f.vendeuse.adresse);

  e.texte("Client", { gras: true, avant: 10 });
  e.texte(`${f.acheteur.nom} (${f.acheteur.forme})`);
  if (f.acheteur.siren) e.texte(`SIREN : ${f.acheteur.siren}`);
  e.texte(f.acheteur.adresse);

  e.texte(`Commissions sur ventes, ${moisEnMots(f.mois)} (prestation de services)`, { gras: true, avant: 14 });
  for (const p of f.lignes.paiements) {
    const etat = p.etat === "impaye" ? " (impayé, pas de commission)" : p.etat === "prevu" ? " (prévu)" : "";
    e.texte(
      `${p.date} · ${p.prenom} · paiement ${p.numero}/${p.fois} de ${euros(p.montantCents)} · ${p.taux} % · ${euros(p.commissionCents)}${etat}`,
      { avant: 3 },
    );
  }
  for (const r of f.lignes.reprises) {
    e.texte(`Reprise : ${r.prenom}, paiement ${r.numero} remboursé · ${euros(r.commissionCents)}`, { avant: 3 });
  }

  e.texte(`Total HT : ${euros(f.totalCents)}`, { taille: 12, gras: true, avant: 12 });
  e.texte(f.vendeuse.mentionTva, { avant: 2 });
  e.texte(`Total à payer : ${euros(f.totalCents)}`, { gras: true, avant: 2 });

  e.texte(
    `Paiement par virement sous ${f.acheteur.delaiJours} jours après acceptation de la facture. En cas de retard : pénalités au taux de trois fois le taux d'intérêt légal, et indemnité forfaitaire pour frais de recouvrement de 40 €. Pas d'escompte pour paiement anticipé.`,
    { taille: 8.5, couleur: GRIS, avant: 12 },
  );
  e.texte(
    acceptation
      ? `Facture acceptée par le prestataire le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(acceptation.le))} (heure de Paris), dans son espace, en application du mandat d'autofacturation (${VERSION_MANDAT}).`
      : "Facture en attente d'acceptation par le prestataire, en application du mandat d'autofacturation.",
    { taille: 8.5, couleur: GRIS, avant: 4 },
  );
  return doc.save();
}

export const totalFacture = (l: LignesFacture) =>
  l.paiements.reduce((s, p) => s + p.commissionCents, 0) + l.reprises.reduce((s, r) => s + r.commissionCents, 0);
