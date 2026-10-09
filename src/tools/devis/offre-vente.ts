import { cleDeChoix, type ChoixVente, type Prise } from "./offre-vente-choix.ts";
import { PROFILS_DEVIS } from "./profils/peggy.ts";
import {
  DUREES_CLOSEUSE,
  INVESTIGATION_SEULE,
  MICROBIOTE_SEUL,
  montants,
  type Paiement,
  type ProfilDevis,
} from "./regles.ts";

/**
 * La vente notée à la main dans Radar, sur l'offre du devis (Louis,
 * 08/10/2026 : « la même offre partout »).
 *
 * Peggy choisit ce que la cliente prend et comment elle paie, comme une
 * closeuse dans son devis ; le montant se calcule ici, depuis `montants()`,
 * jamais de mémoire ni de la saisie. « Autre montant » reste la seule porte
 * de sortie, et il faut la choisir (Louis, 09/10/2026, B) : le « 2 310 » du
 * 08/10 était un montant tapé, qu'aucune offre ne donne.
 *
 * Le nombre de paiements et le premier suivent `devis_vers_radar` (0052) : en
 * plusieurs fois, un paiement par mois, le premier portant l'investigation et
 * la première mensualité. Une vente notée ici et une vente venue d'un devis
 * payé se lisent donc de la même façon dans Radar.
 *
 * Ce module ne fait que calculer : il se teste sans base.
 */

function libelleDePrise(prise: Prise): string {
  if (prise === INVESTIGATION_SEULE) return "Investigation seule";
  if (prise === MICROBIOTE_SEUL) return "Bilan microbiote seul";
  return `Accompagnement ${prise} mois`;
}

function noteDe(prise: Prise, paiement: Paiement, fois: number): string {
  if (prise === INVESTIGATION_SEULE) return "Investigation seule";
  const tete = prise === MICROBIOTE_SEUL ? "Bilan microbiote" : `${prise} mois`;
  return `${tete}, ${paiement === "une_fois" ? "en 1 fois" : `en ${fois} fois`}`;
}

function choix(p: ProfilDevis, prise: Prise, paiement: Paiement): ChoixVente {
  const m = montants(p, prise, paiement);
  const fois = paiement === "plusieurs" ? m.dureeMois : 1;
  return {
    cle: cleDeChoix(prise, paiement),
    prise,
    paiement,
    libellePrise: libelleDePrise(prise),
    montantCents: m.totalCents,
    fois,
    premierCents: fois > 1 ? m.investigationCents + m.mensualiteCents : null,
    note: noteDe(prise, paiement, fois),
  };
}

/**
 * Tous les choix de l'offre, dans l'ordre du menu : les accompagnements, puis
 * l'investigation seule (en 1 fois seulement), puis le bilan microbiote seul
 * s'il est proposé.
 */
export function choixDeVente(p: ProfilDevis): ChoixVente[] {
  const paiements: Paiement[] = ["une_fois", "plusieurs"];
  return [
    ...DUREES_CLOSEUSE.flatMap((duree) => paiements.map((paiement) => choix(p, duree, paiement))),
    choix(p, INVESTIGATION_SEULE, "une_fois"),
    ...(p.microbiote ? paiements.map((paiement) => choix(p, MICROBIOTE_SEUL, paiement)) : []),
  ];
}

/** L'offre d'un espace, par son slug, ou null quand il n'a pas de modèle de devis (Radar garde alors son montant libre). */
export function offreDeVente(slug: string): ChoixVente[] | null {
  const p = PROFILS_DEVIS[slug];
  return p ? choixDeVente(p) : null;
}
