import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Le témoin de la connexion à Google.
 *
 * Avant d'envoyer la personne chez Google, on tire un nombre au hasard : il
 * part dans l'adresse (`state`) et reste chez elle dans un cookie de dix
 * minutes, avec sa fiche et son client. Au retour, les deux doivent être
 * identiques : c'est ce qui empêche quelqu'un d'autre de brancher son propre
 * agenda sur la fiche d'une closeuse en lui faisant cliquer un lien.
 */

export const COOKIE = "resa_google";
export const DUREE_S = 600;

export type Etat = { etat: string; personneId: string; orgSlug: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9-]{1,80}$/;
const JETON = /^[0-9a-f]{64}$/;

export function nouvelEtat(personneId: string, orgSlug: string): Etat {
  return { etat: randomBytes(32).toString("hex"), personneId, orgSlug };
}

export function emballer(e: Etat): string {
  return `${e.etat}.${e.personneId}.${e.orgSlug}`;
}

export function deballer(valeur: string | undefined | null): Etat | null {
  if (!valeur) return null;
  const [etat, personneId, orgSlug, ...reste] = valeur.split(".");
  if (reste.length > 0 || !JETON.test(etat ?? "") || !UUID.test(personneId ?? "") || !SLUG.test(orgSlug ?? "")) {
    return null;
  }
  return { etat, personneId, orgSlug };
}

/** Comparaison en temps constant : les deux empreintes ont la même longueur. */
export function memeEtat(recu: string | null, attendu: string): boolean {
  if (!recu) return false;
  const a = createHash("sha256").update(recu).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}

/** Où la ramener, et avec quel message. */
export type Issue = "ok" | "refus" | "droits" | "erreur" | "expire";

export const pageAgenda = (orgSlug: string, issue: Issue) => `/app/${orgSlug}/agenda?google=${issue}`;
