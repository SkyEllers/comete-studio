import { createHash, randomBytes } from "node:crypto";

/**
 * L'accord WhatsApp par lien (0046), sans base ni réseau : le jeton, son
 * empreinte, et ce que la page montre du numéro.
 */

/** 32 octets tirés au hasard, en base64url : 43 caractères. */
export const FORMAT_JETON = /^[A-Za-z0-9_-]{43}$/;

export function jetonNeuf(): string {
  return randomBytes(32).toString("base64url");
}

/** La base ne garde que ceci : un accès en lecture ne fabrique aucun lien. */
export function empreinte(jeton: string): string {
  return createHash("sha256").update(jeton, "utf8").digest("hex");
}

/** Les deux derniers chiffres, pour « au numéro qui finit par 78 ». */
export function finNumero(telephone: string | null): string | null {
  const chiffres = (telephone ?? "").replace(/\D/g, "");
  return chiffres.length >= 8 ? chiffres.slice(-2) : null;
}
