import type { ContenuReleve, Ligne } from "./contenu.ts";

/**
 * Ce qu'un relevé veut dire, calculé une fois.
 *
 * Le circuit validé avec le client : ce qui entre, moins ce que l'entreprise
 * coûte, donne le résultat du mois ; une part (40 % par défaut) part dans la
 * poche des impôts ; le salaire fixe est versé ; ce qui reste va à la réserve —
 * ou, un mauvais mois, le salaire est pris sur elle.
 *
 * Tout est en centimes entiers. Les impôts sont arrondis au centime, et ne
 * descendent jamais sous zéro : un mois à perte ne met rien de côté, il ne
 * « rembourse » pas la poche.
 */
export type Calculs = {
  entrees: number;
  charges: number;
  resultat: number;
  impots: number;
  apresImpots: number;
  salaire: number;
  versReserve: number;
  vieDepense: number;
  vieBudget: number | null;
};

export function somme(lignes: Ligne[]): number {
  return lignes.reduce((total, ligne) => total + ligne.centimes, 0);
}

export function calculer(contenu: ContenuReleve): Calculs {
  const entrees = somme(contenu.entrees);
  const charges = somme(contenu.charges);
  const resultat = entrees - charges;
  const impots = resultat > 0 ? Math.round((resultat * contenu.tauxImpots) / 100) : 0;
  const apresImpots = resultat - impots;
  const salaire = contenu.salaireCentimes;

  const avecBudget = contenu.vie.filter((ligne) => ligne.budgetCentimes !== null);

  return {
    entrees,
    charges,
    resultat,
    impots,
    apresImpots,
    salaire,
    versReserve: apresImpots - salaire,
    vieDepense: somme(contenu.vie),
    vieBudget:
      avecBudget.length > 0
        ? avecBudget.reduce((total, ligne) => total + (ligne.budgetCentimes ?? 0), 0)
        : null,
  };
}

/** Avancement vers une cible, borné à 0-100. Une cible nulle ne progresse pas. */
export function avancement(valeur: number, cible: number): number {
  if (cible <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((valeur / cible) * 100)));
}
