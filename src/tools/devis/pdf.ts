/**
 * Le PDF du devis signé : le devis entier, le bloc de signature, puis le
 * dossier de preuve (chaque geste, son heure, son adresse IP, son navigateur,
 * et l'empreinte du contenu signé).
 *
 * pdf-lib, polices standard (Helvetica, encodage WinAnsi) : les accents
 * français, « € », « œ » et les guillemets passent ; un caractère hors de cet
 * encodage est remplacé plutôt que de faire échouer la signature.
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import { euros, instantEnMots, nomComplet, type Bloc, type Contenu } from "./regles.ts";

export type Evenement = { genre: string; le: string; ip: string | null; agent: string | null };

export type Signature = {
  signeLe: string;
  ip: string | null;
  agent: string | null;
  demarrageImmediat: boolean;
  empreinte: string;
  evenements: Evenement[];
  identifiantDevis: string;
};

const LARGEUR = 595.28;
const HAUTEUR = 841.89;
const MARGE = 56;
export const ENCRE = rgb(0.13, 0.12, 0.11);
export const GRIS = rgb(0.42, 0.4, 0.38);

const GESTES: Record<string, string> = {
  cree: "Devis créé",
  envoye: "Devis envoyé par mail",
  ouvert: "Devis ouvert par la cliente",
  relance: "Rappel envoyé",
  signe: "Devis signé par la cliente",
  pdf: "PDF signé produit",
  paiement_lien: "Lien de paiement ouvert",
  paye: "Paiement mis en place",
  expire: "Devis expiré",
  annule: "Devis annulé",
};

/** Ce que WinAnsi ne sait pas écrire, remplacé par un proche. */
export function lisible(texte: string): string {
  return texte
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-")
    .replace(/[  ]/g, " ")
    .replace(/✔|✓/g, "-")
    .replace(/[^\x20-\x7e -ÿŒœ€•…‰ŠšŸŽž‹›‚„ˆ˜™]/gu, "?");
}

/** Écrit un PDF page après page : titres, paragraphes, puces, retours à la page seuls. */
export class Ecrivain {
  page!: PDFPage;
  y = 0;
  doc: PDFDocument;
  police: PDFFont;
  gras: PDFFont;
  enTete: string;
  constructor(doc: PDFDocument, police: PDFFont, gras: PDFFont, enTete: string) {
    this.doc = doc;
    this.police = police;
    this.gras = gras;
    this.enTete = enTete;
    this.nouvellePage();
  }

  nouvellePage() {
    this.page = this.doc.addPage([LARGEUR, HAUTEUR]);
    this.page.drawText(lisible(this.enTete), { x: MARGE, y: HAUTEUR - 32, size: 7.5, font: this.police, color: GRIS });
    this.y = HAUTEUR - MARGE - 10;
  }

  place(hauteur: number) {
    if (this.y - hauteur < MARGE) this.nouvellePage();
  }

  lignes(texte: string, police: PDFFont, taille: number, largeur: number): string[] {
    const mots = lisible(texte).split(/\s+/).filter(Boolean);
    const sortie: string[] = [];
    let courante = "";
    for (const mot of mots) {
      const essai = courante ? `${courante} ${mot}` : mot;
      if (police.widthOfTextAtSize(essai, taille) <= largeur) {
        courante = essai;
        continue;
      }
      if (courante) sortie.push(courante);
      // Un mot plus long que la ligne (une adresse) : on le coupe.
      let reste = mot;
      while (police.widthOfTextAtSize(reste, taille) > largeur) {
        let n = reste.length;
        while (n > 1 && police.widthOfTextAtSize(reste.slice(0, n), taille) > largeur) n--;
        sortie.push(reste.slice(0, n));
        reste = reste.slice(n);
      }
      courante = reste;
    }
    if (courante) sortie.push(courante);
    return sortie;
  }

  texte(t: string, o: { taille?: number; gras?: boolean; retrait?: number; couleur?: typeof ENCRE; avant?: number } = {}) {
    const taille = o.taille ?? 9.5;
    const police = o.gras ? this.gras : this.police;
    const retrait = o.retrait ?? 0;
    const interligne = taille * 1.38;
    this.y -= o.avant ?? 0;
    for (const ligne of this.lignes(t, police, taille, LARGEUR - 2 * MARGE - retrait)) {
      this.place(interligne);
      this.page.drawText(ligne, { x: MARGE + retrait, y: this.y, size: taille, font: police, color: o.couleur ?? ENCRE });
      this.y -= interligne;
    }
  }

  bloc(b: Bloc) {
    if (b.titre) {
      this.place(40);
      this.texte(b.titre, { taille: 11, gras: true, avant: 10 });
      this.y -= 2;
    }
    for (const p of b.paragraphes ?? []) this.texte(p, { avant: 3 });
    for (const p of b.puces ?? []) {
      this.place(14);
      this.page.drawText("•", { x: MARGE + 6, y: this.y - 3, size: 9.5, font: this.police, color: ENCRE });
      this.texte(p, { retrait: 18, avant: 3 });
    }
    for (const p of b.apres ?? []) this.texte(p, { avant: 3 });
  }
}

export async function pdfDuDevis(c: Contenu, s: Signature): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(lisible(`${c.titre} - ${nomComplet(c.cliente)}`));
  doc.setAuthor(lisible(c.vendeur.signataire));
  doc.setCreator("Comète Studio");
  doc.setProducer("Comète Studio");
  doc.setCreationDate(new Date(s.signeLe));

  const e = new Ecrivain(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    c.enTete,
  );

  e.texte(c.titre.toUpperCase(), { taille: 18, gras: true });
  e.texte(c.sousTitre, { taille: 11, couleur: GRIS, avant: 2 });

  e.texte("Accompagnée :", { gras: true, avant: 14 });
  e.texte(`Nom / Prénom : ${nomComplet(c.cliente)}`);
  e.texte(`Mail : ${c.cliente.email}`);
  if (c.cliente.telephone) e.texte(`Tél. : ${c.cliente.telephone}`);
  e.texte(`Adresse postale : ${c.cliente.adresse ?? ""}`);

  e.texte("Prestataire thérapeute et coach :", { gras: true, avant: 10 });
  for (const i of c.vendeur.intervenants) e.texte(i);
  e.texte(`Entreprise ${c.vendeur.nom} - ${c.vendeur.identifiant}`);
  e.texte(`${c.vendeur.telephone}, ${c.vendeur.email}`);
  e.texte(c.vendeur.adresse);

  for (const b of c.blocs) e.bloc(b);

  // ------------------------------ La signature ------------------------------
  e.place(150);
  e.texte("Signature des 2 parties", { taille: 11, gras: true, avant: 16 });
  e.texte(`Pour le prestataire : ${c.vendeur.signataire}, offre émise par ${c.vendeur.nom}.`, { avant: 3 });
  e.texte(
    `Pour l'accompagnée : signé électroniquement par ${nomComplet(c.cliente)} (${c.cliente.email}) le ${instantEnMots(s.signeLe)}, heure de Paris.`,
    { avant: 3 },
  );
  e.texte(
    s.demarrageImmediat
      ? "Elle a demandé que l'accompagnement commence avant la fin du délai de rétractation de 14 jours (Code de la consommation, L221-25)."
      : "Elle n'a pas demandé que l'accompagnement commence avant la fin du délai de rétractation de 14 jours.",
    { avant: 3 },
  );
  e.texte(`Montant accepté : ${euros(c.montants.totalCents)} (${c.montants.paiement === "une_fois" ? "paiement en 1 fois" : "paiement en plusieurs fois"}).`, { avant: 3 });
  e.texte(`Empreinte SHA-256 du contenu signé : ${s.empreinte}`, { taille: 7.5, couleur: GRIS, avant: 6 });
  e.texte(`Référence du devis : ${s.identifiantDevis} · version du texte : ${c.version}`, { taille: 7.5, couleur: GRIS });

  // ------------------------------ La preuve ---------------------------------
  e.nouvellePage();
  e.texte("Dossier de preuve", { taille: 14, gras: true });
  e.texte(
    "Signature électronique simple (règlement eIDAS, art. 25 ; Code civil, art. 1366 et 1367). La cliente a ouvert le devis par un lien personnel envoyé à son adresse mail, puis l'a signé en cochant son accord et en cliquant sur « Signer ». Chaque geste est enregistré ci-dessous, heure de Paris.",
    { couleur: GRIS, avant: 4 },
  );
  for (const ev of s.evenements) {
    e.texte(`${instantEnMots(ev.le)} · ${GESTES[ev.genre] ?? ev.genre}`, { gras: true, avant: 8 });
    if (ev.ip) e.texte(`Adresse IP : ${ev.ip}`, { taille: 8.5, retrait: 12 });
    if (ev.agent) e.texte(`Navigateur : ${ev.agent}`, { taille: 8.5, retrait: 12 });
  }
  e.texte(`Empreinte SHA-256 du contenu signé : ${s.empreinte}`, { taille: 8.5, avant: 12 });
  e.texte(
    "Le contenu signé (texte, montants, identité, validité) est gardé tel quel par Comète Studio pour le compte du prestataire. Un seul mot changé changerait cette empreinte.",
    { taille: 8.5, couleur: GRIS, avant: 3 },
  );

  return doc.save();
}
