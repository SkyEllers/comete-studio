import { z } from "zod";

import { LIMITE_IDEE, LIMITE_NOM_BOITE } from "./types";

/**
 * Les schémas des mutations de Sas, à part des actions.
 *
 * Un fichier `"use server"` n'exporte que des fonctions asynchrones : y poser
 * un schéma zod le ferait refuser à la compilation. Ils vivent donc ici, où
 * ils restent lisibles d'un coup d'œil — et où l'on voit que les mêmes
 * limites que la base sont réaffirmées avant de la toucher.
 */

export const identifiant = z.uuid({ error: "Introuvable." });

export const nomBoiteSchema = z
  .string({ error: "Donne un nom à cette boîte." })
  .trim()
  .min(1, { error: "Donne un nom à cette boîte." })
  .max(LIMITE_NOM_BOITE, {
    error: `Le nom d'une boîte ne peut pas dépasser ${LIMITE_NOM_BOITE} caractères.`,
  });

export const texteIdeeSchema = z
  .string({ error: "Une idée vide ne s'enregistre pas." })
  .trim()
  .min(1, { error: "Une idée vide ne s'enregistre pas." })
  .max(LIMITE_IDEE, {
    error: `Une idée ne peut pas dépasser ${LIMITE_IDEE.toLocaleString("fr-FR")} caractères.`,
  });

/**
 * Où l'on déplace une idée. Trois places, et trois seulement : une boîte,
 * « À ranger », ou Perso. Un déplacement vers Perso lui retire sa boîte dans
 * le même geste — la base refuserait l'autre moitié.
 */
export const placeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boite"), boiteId: identifiant }),
  z.object({ type: z.literal("aranger") }),
  z.object({ type: z.literal("perso") }),
]);

export type Place = z.infer<typeof placeSchema>;
