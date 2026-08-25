/**
 * Contrat de retour des Server Actions (CLAUDE.md §7).
 *
 * Jamais d'exception qui remonte au client : une action réussit avec ses
 * données, ou échoue avec un message en français, prêt à afficher. `field`
 * permet de poser le message sous le bon champ plutôt qu'en bas du formulaire.
 */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

export function ok(): ActionResult<null>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | null> {
  return { ok: true, data: data ?? null };
}

export function fail<T = null>(error: string, field?: string): ActionResult<T> {
  return { ok: false, error, field };
}

/** Premier message d'erreur d'un `safeParse` zod, avec le champ concerné. */
export function failFromZod<T = null>(error: {
  issues: { message: string; path: PropertyKey[] }[];
}): ActionResult<T> {
  const issue = error.issues[0];
  return fail(issue?.message ?? "Formulaire invalide.", String(issue?.path[0] ?? ""));
}
