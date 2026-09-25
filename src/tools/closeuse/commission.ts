/**
 * La commission d'une closeuse, calculée dans l'app (0036, décision 4).
 *
 * La grille validée par Peggy le 23/09/2026 :
 * - un taux sur ce qui est encaissé, hors TVA, sur chaque vente qu'elle conclut ;
 * - un taux plus haut sur les ventes au-delà de la n-ième du mois, celles-là
 *   seulement : le rang d'une vente dans son mois fixe son taux, une fois pour
 *   toutes, pour toutes ses mensualités ;
 * - la commission suit chaque paiement encaissé : rien sur un impayé ; un
 *   remboursement retire sa commission du mois suivant.
 *
 * Radar ne voit pas les paiements. Un paiement échu compte comme encaissé,
 * sauf incident noté par Louis ; un paiement à venir est « prévu ».
 *
 * Tout est en centimes et en dates « AAAA-MM-JJ » : pas de fuseau, pas de
 * flottant dans un montant de facture.
 */

export type Grille = { taux: number; tauxPalier: number; palierApres: number };

export type Vente = {
  bookingId: string;
  prenom: string;
  /** Le rendez-vous : départage deux ventes du même jour. */
  rendezVous: string;
  dateVente: string;
  montantCents: number;
  fois: number;
  premierCents: number | null;
};

export type Incident = { bookingId: string; numero: number; type: "impaye" | "rembourse" };

export type EtatPaiement = "encaisse" | "prevu" | "impaye" | "rembourse";

export type Paiement = {
  bookingId: string;
  prenom: string;
  rang: number;
  taux: number;
  numero: number;
  fois: number;
  date: string;
  montantCents: number;
  etat: EtatPaiement;
  /** Ce qu'il rapporte à la closeuse, au mois de sa date. 0 si impayé. */
  commissionCents: number;
};

/** Une ligne négative : la commission d'un paiement remboursé, reprise. */
export type Reprise = {
  bookingId: string;
  prenom: string;
  numero: number;
  mois: string;
  commissionCents: number;
};

export function mois(date: string): string {
  return date.slice(0, 7);
}

/** Même jour, n mois plus tard ; le 31 janvier + 1 mois donne le 28 ou 29 février. */
export function plusMois(date: string, n: number): string {
  const [a, m, j] = date.split("-").map(Number);
  const cible = new Date(Date.UTC(a, m - 1 + n, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernier));
  return cible.toISOString().slice(0, 10);
}

export function moisSuivant(m: string): string {
  return mois(plusMois(`${m}-01`, 1));
}

/**
 * Les montants de chaque paiement. Le premier peut être différent (500 € puis
 * 170 € par mois chez Peggy) ; le reste se répartit à parts égales, et le
 * dernier absorbe l'arrondi pour que la somme tombe juste.
 */
export function echeancier(montantCents: number, fois: number, premierCents: number | null): number[] {
  if (fois <= 1) return [montantCents];
  const premier = premierCents ?? Math.floor(montantCents / fois);
  const reste = montantCents - premier;
  const part = Math.floor(reste / (fois - 1));
  const parts = Array.from({ length: fois - 1 }, (_, i) =>
    i === fois - 2 ? reste - part * (fois - 2) : part,
  );
  return [premier, ...parts];
}

export function arrondi(cents: number): number {
  return Math.round(cents);
}

export function calculer(
  ventes: Vente[],
  incidents: Incident[],
  grille: Grille,
  aujourdhui: string,
): { paiements: Paiement[]; reprises: Reprise[] } {
  const parIncident = new Map(incidents.map((i) => [`${i.bookingId}#${i.numero}`, i.type]));
  const triees = [...ventes].sort(
    (a, b) => a.dateVente.localeCompare(b.dateVente) || a.rendezVous.localeCompare(b.rendezVous),
  );

  const rangs = new Map<string, number>();
  const paiements: Paiement[] = [];
  const reprises: Reprise[] = [];

  for (const v of triees) {
    const m = mois(v.dateVente);
    const rang = (rangs.get(m) ?? 0) + 1;
    rangs.set(m, rang);
    const taux = rang > grille.palierApres ? grille.tauxPalier : grille.taux;

    echeancier(v.montantCents, v.fois, v.premierCents).forEach((montant, i) => {
      const numero = i + 1;
      const date = plusMois(v.dateVente, i);
      const incident = parIncident.get(`${v.bookingId}#${numero}`);
      const etat: EtatPaiement = incident ?? (date <= aujourdhui ? "encaisse" : "prevu");
      const commission = etat === "impaye" ? 0 : arrondi((montant * taux) / 100);

      paiements.push({
        bookingId: v.bookingId,
        prenom: v.prenom,
        rang,
        taux,
        numero,
        fois: v.fois,
        date,
        montantCents: montant,
        etat,
        commissionCents: commission,
      });

      if (etat === "rembourse") {
        reprises.push({
          bookingId: v.bookingId,
          prenom: v.prenom,
          numero,
          mois: moisSuivant(mois(date)),
          commissionCents: -commission,
        });
      }
    });
  }

  paiements.sort((a, b) => a.date.localeCompare(b.date) || a.rang - b.rang || a.numero - b.numero);
  return { paiements, reprises };
}

/** Le relevé d'un mois : les paiements du mois, les reprises, le total. */
export function releveDuMois(
  resultat: { paiements: Paiement[]; reprises: Reprise[] },
  m: string,
) {
  const paiements = resultat.paiements.filter((p) => mois(p.date) === m);
  const reprises = resultat.reprises.filter((r) => r.mois === m);
  const totalCents =
    paiements.reduce((s, p) => s + p.commissionCents, 0) +
    reprises.reduce((s, r) => s + r.commissionCents, 0);
  const aVenirCents = paiements
    .filter((p) => p.etat === "prevu")
    .reduce((s, p) => s + p.commissionCents, 0);
  return { paiements, reprises, totalCents, aVenirCents };
}
