import { z } from "zod";

/**
 * Ce que chacune règle elle-même dans « Mon agenda » (décidé par Louis le
 * 27/09/2026 : trois réglages sur un écran, « super simple ») : ses horaires
 * habituels, ses absences, son maximum par jour. Plus sa visio.
 *
 * Validé ici, sans base ni réseau, pour que les tests couvrent chaque refus
 * et que l'écran dise exactement pourquoi.
 */

export const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PlageSaisie = { jour: number; debut: string; fin: string };

export const plagesSchema = z
  .array(
    z.object({
      jour: z.number().int().min(1).max(7),
      debut: z.string().regex(HEURE, { error: "Une heure est mal écrite." }),
      fin: z.string().regex(HEURE, { error: "Une heure est mal écrite." }),
    }),
  )
  .max(35, { error: "Trop de plages : cinq par jour au plus." });

/** Le premier problème des plages saisies, ou null. */
export function problemePlages(plages: PlageSaisie[]): string | null {
  for (const p of plages) {
    if (p.fin <= p.debut) return "Une plage finit avant de commencer.";
  }
  for (let jour = 1; jour <= 7; jour++) {
    const du = plages.filter((p) => p.jour === jour).sort((a, b) => a.debut.localeCompare(b.debut));
    if (du.length > 5) return "Trop de plages : cinq par jour au plus.";
    for (let i = 1; i < du.length; i++) {
      if (du[i].debut < du[i - 1].fin) return `Deux plages se chevauchent le ${JOURS[jour - 1]}.`;
    }
  }
  return null;
}

export const absenceSchema = z.object({
  du: z.string().regex(DATE, { error: "Choisis une date." }),
  au: z.string().regex(DATE, { error: "Choisis une date." }),
});

/** `aujourdhui` : « 2026-10-05 », dans son fuseau. */
export function problemeAbsence(a: { du: string; au: string }, aujourdhui: string): string | null {
  if (a.au < a.du) return "La fin tombe avant le début.";
  if (a.au < aujourdhui) return "Cette date est déjà passée.";
  return null;
}

export const maximumSchema = z.coerce
  .number({ error: "Écris un nombre." })
  .int({ error: "Écris un nombre entier." })
  .min(1, { error: "Au moins 1." })
  .max(20, { error: "20 au plus." });

export const visioSchema = z.discriminatedUnion("visio", [
  z.object({ visio: z.literal("meet") }),
  z.object({
    visio: z.literal("lien"),
    lien: z
      .string()
      .trim()
      .max(500)
      .regex(/^https:\/\/\S+$/, { error: "Colle un lien qui commence par https://" }),
  }),
]);

/** « du lundi 5 au mercredi 7 octobre », ou « le lundi 5 octobre ». */
export function absenceEnMots(du: string, au: string): string {
  const f = (d: string, avecMois: boolean) =>
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      ...(avecMois ? { month: "long" } : {}),
    }).format(new Date(`${d}T12:00:00Z`));
  if (du === au) return `le ${f(du, true)}`;
  const memeMois = du.slice(0, 7) === au.slice(0, 7);
  return `du ${f(du, !memeMois)} au ${f(au, true)}`;
}
