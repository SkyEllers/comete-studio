import type { Paiement } from "./regles.ts";

/**
 * Ce que l'écran de vente de Radar lit de l'offre (`offre-vente.ts`), sans rien
 * importer qui ne tourne que sur le serveur : les choix arrivent tout calculés.
 */

/** Ce que la cliente prend : 6, 9, 12 mois, l'investigation seule (0) ou le bilan microbiote seul (-1). */
export type Prise = number;

export type ChoixVente = {
  /** « 12:une_fois », « 0:une_fois », « -1:plusieurs » : ce que l'écran renvoie. */
  cle: string;
  prise: Prise;
  paiement: Paiement;
  /** « Accompagnement 12 mois », « Investigation seule »… */
  libellePrise: string;
  montantCents: number;
  /** Nombre de paiements : 1 en une fois, sinon un par mois. */
  fois: number;
  /** Le premier paiement quand il diffère des suivants, sinon null. */
  premierCents: number | null;
  /** Ce qui s'écrit en note de la vente : « 12 mois, en 1 fois ». */
  note: string;
};

export const AUTRE_MONTANT = "autre";

export function cleDeChoix(prise: Prise, paiement: Paiement): string {
  return `${prise}:${paiement}`;
}

/** Le choix qui correspond à une clé reçue de l'écran. */
export function choixParCle(offre: ChoixVente[], cle: string): ChoixVente | null {
  return offre.find((c) => c.cle === cle) ?? null;
}

/**
 * Le choix d'une vente déjà notée, pour rouvrir le formulaire dessus : même
 * montant, même nombre de paiements. Sinon null (« Autre montant »).
 */
export function choixDUneVente(
  offre: ChoixVente[],
  vente: { montantCents: number; fois: number | null },
): ChoixVente | null {
  return offre.find((c) => c.montantCents === vente.montantCents && c.fois === (vente.fois ?? 1)) ?? null;
}
