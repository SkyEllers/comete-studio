import { z } from "zod";

/**
 * Briques partagées par toutes les Server Actions. Les messages sont ceux que
 * verra le client : français, tutoiement, sans jargon.
 */

// `.trim()` et `.toLowerCase()` sont des transformations : sans le `.pipe()`,
// elles s'appliqueraient après la validation et une adresse valide entourée
// d'espaces serait refusée.
export const emailSchema = z
  .string({ error: "L'adresse email est obligatoire." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Cette adresse email n'est pas valide." }));

export const passwordSchema = z
  .string({ error: "Choisis un mot de passe." })
  .min(8, { error: "Le mot de passe doit faire au moins 8 caractères." })
  .max(72, { error: "Le mot de passe ne peut pas dépasser 72 caractères." });

export const slugSchema = z
  .string({ error: "L'identifiant est obligatoire." })
  .trim()
  .min(2, { error: "L'identifiant doit faire au moins 2 caractères." })
  .max(60, { error: "L'identifiant ne peut pas dépasser 60 caractères." })
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    error:
      "L'identifiant ne peut contenir que des minuscules, des chiffres et des tirets.",
  });

export const orgNameSchema = z
  .string({ error: "Le nom du client est obligatoire." })
  .trim()
  .min(2, { error: "Le nom doit faire au moins 2 caractères." })
  .max(60, { error: "Le nom ne peut pas dépasser 60 caractères." });

export const fullNameSchema = z
  .string({ error: "Le nom est obligatoire." })
  .trim()
  .min(1, { error: "Le nom est obligatoire." })
  .max(80, { error: "Le nom ne peut pas dépasser 80 caractères." });

/**
 * Une destination de redirection n'est acceptée que si elle reste sur le site :
 * un `?next=https://evil.com` doit être ignoré.
 */
export const nextPathSchema = z
  .string()
  .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
    error: "Destination invalide.",
  });
