import { z } from "zod";

/**
 * Le contenu d'un relevé Horizon : ce que Louis renseigne pour un mois.
 *
 * La base ne garde qu'un document par mois (`horizon_releves.contenu`) ; sa
 * forme est tenue ici, et toute écriture passe par ce schéma. Les montants sont
 * en centimes, entiers, comme partout dans le hub : un relevé d'argent qui
 * arrondirait différemment d'un écran à l'autre ne servirait à rien.
 *
 * Les lignes (entrées, charges, vie, à venir) se saisissent en texte, une par
 * ligne, « Libellé ; montant » — et « Libellé ; dépensé ; budget » pour la vie.
 * C'est le format le plus rapide à remplir à partir du tri des relevés
 * bancaires, et il se relit d'un coup d'œil.
 */

const centimes = z.number().int().min(0).max(100_000_000);

export const ligneSchema = z.object({
  libelle: z.string().trim().min(1).max(80),
  centimes,
  budgetCentimes: centimes.nullable().default(null),
});

export type Ligne = z.infer<typeof ligneSchema>;

export const contenuSchema = z.object({
  resume: z.string().trim().max(400).default(""),
  entrees: z.array(ligneSchema).max(30).default([]),
  charges: z.array(ligneSchema).max(40).default([]),
  vie: z.array(ligneSchema).max(30).default([]),
  tauxImpots: z.number().int().min(0).max(100).default(40),
  salaireCentimes: centimes.default(0),
  poches: z
    .object({
      impotsCentimes: centimes.default(0),
      bloqueCentimes: centimes.default(0),
      fondsRoulementCentimes: centimes.default(0),
      reserveCentimes: centimes.default(0),
    })
    .default({
      impotsCentimes: 0,
      bloqueCentimes: 0,
      fondsRoulementCentimes: 0,
      reserveCentimes: 0,
    }),
  objectifs: z
    .object({
      palierReserveCentimes: centimes.default(0),
      objectifReserveCentimes: centimes.default(0),
    })
    .default({ palierReserveCentimes: 0, objectifReserveCentimes: 0 }),
  aVenir: z.array(ligneSchema).max(24).default([]),
  ecarts: z.array(z.string().trim().min(1).max(240)).max(3).default([]),
  notion: z
    .object({
      titre: z.string().trim().max(100).default(""),
      texte: z.string().trim().max(800).default(""),
    })
    .default({ titre: "", texte: "" }),
});

export type ContenuReleve = z.infer<typeof contenuSchema>;

/** Un document illisible (ancien format, écriture manuelle) ne casse pas la page. */
export function lireContenu(brut: unknown): ContenuReleve | null {
  const resultat = contenuSchema.safeParse(brut);
  return resultat.success ? resultat.data : null;
}

/**
 * « 1 650 », « 1650,50 », « 1 650 € » → centimes. `null` si ce n'est pas un
 * montant. Les espaces insécables que colle un tableur sont acceptés.
 */
export function lireMontant(brut: string): number | null {
  const nettoye = brut
    .replace(/[\s  €]/g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(nettoye)) return null;
  return Math.round(Number(nettoye) * 100);
}

/**
 * Le texte d'une zone de lignes → des lignes. Une ligne vide est ignorée ; une
 * ligne mal formée arrête tout avec son numéro, pour que Louis la retrouve.
 */
export function lireLignes(
  texte: string,
  { avecBudget = false }: { avecBudget?: boolean } = {},
): { ok: true; lignes: Ligne[] } | { ok: false; erreur: string } {
  const lignes: Ligne[] = [];
  const brutes = texte.split(/\r?\n/);

  for (let index = 0; index < brutes.length; index++) {
    const brute = brutes[index]!.trim();
    if (!brute) continue;

    const morceaux = brute.split(";").map((morceau) => morceau.trim());
    const [libelle, montant, budget] = morceaux;

    if (!libelle || montant === undefined) {
      return { ok: false, erreur: `Ligne ${index + 1} : écris « Libellé ; montant ».` };
    }
    if (libelle.length > 80) {
      return { ok: false, erreur: `Ligne ${index + 1} : le libellé dépasse 80 caractères.` };
    }

    const centimesLus = lireMontant(montant);
    if (centimesLus === null) {
      return { ok: false, erreur: `Ligne ${index + 1} : « ${montant} » n'est pas un montant.` };
    }

    let budgetCentimes: number | null = null;
    if (avecBudget && budget) {
      budgetCentimes = lireMontant(budget);
      if (budgetCentimes === null) {
        return { ok: false, erreur: `Ligne ${index + 1} : « ${budget} » n'est pas un budget.` };
      }
    }

    lignes.push({ libelle, centimes: centimesLus, budgetCentimes });
  }

  return { ok: true, lignes };
}

/** L'inverse, pour préremplir le formulaire : « Laetitia ; 1650 ». */
export function ecrireLignes(lignes: Ligne[]): string {
  return lignes
    .map((ligne) =>
      [ligne.libelle, euros(ligne.centimes), ligne.budgetCentimes !== null ? euros(ligne.budgetCentimes) : null]
        .filter((morceau) => morceau !== null)
        .join(" ; "),
    )
    .join("\n");
}

/** Centimes → « 1650 » ou « 1650,50 », sans séparateur : c'est une saisie. */
export function euros(centimesAEcrire: number): string {
  const entier = Math.trunc(centimesAEcrire / 100);
  const reste = Math.abs(centimesAEcrire % 100);
  return reste === 0 ? String(entier) : `${entier},${String(reste).padStart(2, "0")}`;
}
