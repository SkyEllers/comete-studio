import { z } from "zod";

import { slugSchema } from "./common";

/**
 * Identifiants que personne ne peut prendre comme slug de client.
 *
 * `profil` et `app` entreraient en collision avec des routes existantes
 * (`/app/profil` passe avant `/app/[orgSlug]`, un client nommé ainsi serait
 * inaccessible). Les autres sont réservés pour ne pas se fermer de portes.
 */
export const RESERVED_ORG_SLUGS = [
  "profil",
  "admin",
  "auth",
  "api",
  "kanban",
  "login",
  "app",
] as const;

export const orgSlugSchema = slugSchema.refine(
  (value) => !RESERVED_ORG_SLUGS.includes(value as (typeof RESERVED_ORG_SLUGS)[number]),
  {
    error: (issue) =>
      `« ${String(issue.input)} » est un identifiant réservé. Choisis-en un autre.`,
  },
);

export const createOrganizationSchema = z.object({
  name: z
    .string({ error: "Le nom du client est obligatoire." })
    .trim()
    .min(2, { error: "Le nom doit faire au moins 2 caractères." })
    .max(60, { error: "Le nom ne peut pas dépasser 60 caractères." }),
  slug: orgSlugSchema,
});

export const renameOrganizationSchema = z.object({
  organizationId: z.uuid({ error: "Client introuvable." }),
  name: z
    .string({ error: "Le nom du client est obligatoire." })
    .trim()
    .min(2, { error: "Le nom doit faire au moins 2 caractères." })
    .max(60, { error: "Le nom ne peut pas dépasser 60 caractères." }),
});

export const membershipRoleSchema = z.enum(["owner", "member"], {
  error: "Rôle inconnu.",
});

export const toggleToolSchema = z.object({
  organizationId: z.uuid({ error: "Client introuvable." }),
  toolId: z.uuid({ error: "Outil introuvable." }),
  enabled: z.boolean(),
});

export const updateToolSchema = z.object({
  toolId: z.uuid({ error: "Outil introuvable." }),
  name: z
    .string({ error: "Le nom de l'outil est obligatoire." })
    .trim()
    .min(2, { error: "Le nom doit faire au moins 2 caractères." })
    .max(60, { error: "Le nom ne peut pas dépasser 60 caractères." }),
  description: z
    .string()
    .trim()
    .max(200, { error: "La description ne peut pas dépasser 200 caractères." }),
  sortOrder: z.coerce
    .number({ error: "L'ordre doit être un nombre." })
    .int({ error: "L'ordre doit être un nombre entier." })
    .min(0, { error: "L'ordre ne peut pas être négatif." })
    .max(9999, { error: "L'ordre ne peut pas dépasser 9999." }),
});

/**
 * Un outil externe n'a pas de page chez nous : sans URL, la tuile ne mènerait
 * nulle part. L'adresse est donc obligatoire, et doit être une vraie URL.
 */
export const createExternalToolSchema = z.object({
  name: z
    .string({ error: "Le nom de l'outil est obligatoire." })
    .trim()
    .min(2, { error: "Le nom doit faire au moins 2 caractères." })
    .max(60, { error: "Le nom ne peut pas dépasser 60 caractères." }),
  slug: slugSchema,
  href: z
    .string({ error: "L'adresse de l'outil est obligatoire." })
    .trim()
    .min(1, { error: "L'adresse de l'outil est obligatoire." })
    .pipe(
      z.url({
        protocol: /^https?$/,
        error: "Indique une adresse complète, par exemple https://exemple.fr.",
      }),
    ),
  description: z
    .string()
    .trim()
    .max(200, { error: "La description ne peut pas dépasser 200 caractères." }),
});
