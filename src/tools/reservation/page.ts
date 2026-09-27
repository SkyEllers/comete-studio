import { z } from "zod";

import type { Disponibilites } from "./moteur.ts";

/**
 * Ce que les routes `api/reservation/page/*` lisent et rendent, sans base ni
 * réseau : testé dans page.test.ts.
 *
 * L'appelant est le serveur du site du client (peggygirault.fr), jamais un
 * navigateur : la page de réservation parle à son site, qui parle au hub avec
 * un jeton porteur (0045). Ce qui sort ne dit jamais qui tient le créneau :
 * la cliente voit une heure, pas une closeuse.
 */

/** 32 octets en hexadécimal : la forme que l'administration donne aux jetons. */
export const JETON = /^[0-9a-f]{64}$/;

/** `Authorization: Bearer <jeton>`, et rien d'autre. */
export function jetonPresente(entetes: Headers): string | null {
  const brut = entetes.get("authorization");
  if (!brut) return null;
  const [schema, valeur, ...reste] = brut.trim().split(/\s+/);
  if (reste.length > 0 || !schema || schema.toLowerCase() !== "bearer" || !valeur) return null;
  return JETON.test(valeur) ? valeur : null;
}

export type CreneauxPublics =
  | { etat: "ferme" }
  | { etat: "complet" }
  | { etat: "ouvert"; fuseau: string; creneaux: { debut: string; fin: string }[] };

/** Les créneaux tels que la page les voit : l'heure, sans les personnes. */
export function creneauxPublics(d: Disponibilites, fuseau: string): CreneauxPublics {
  if (d.etat === "ferme") return { etat: "ferme" };
  if (d.etat === "complet" || d.creneaux.length === 0) return { etat: "complet" };
  return { etat: "ouvert", fuseau, creneaux: d.creneaux.map((c) => ({ debut: c.debut, fin: c.fin })) };
}

const texte = (max: number) => z.string().trim().min(1).max(max);

/**
 * La demande de réservation. Le site a déjà lu et nettoyé le formulaire ; on
 * revérifie quand même tout, champ par champ, et on refuse ce qu'on ne
 * connaît pas : l'appelant est notre code, une différence est un défaut à voir.
 */
export const demandeSchema = z
  .object({
    debut: z.iso.datetime({ offset: false }),
    prenom: texte(100),
    nom: texte(100),
    email: z.email().max(320),
    telephone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    fuseau: z.string().regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/).max(64),
    reponses: z
      .array(z.strictObject({ question: texte(500), reponse: texte(2000) }))
      .min(1)
      .max(12),
    utm: z.record(z.string().regex(/^[a-z_]{2,20}$/), z.string().max(500)).default({}),
  })
  .strict()
  .refine((d) => Object.keys(d.utm).length <= 12, { message: "trop de paramètres de provenance" });

export type Demande = z.infer<typeof demandeSchema>;
