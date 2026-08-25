import type { ActionResult } from "@/lib/actions";

/** Message d'erreur d'une action, posé sous le champ concerné. */
export function FieldError({
  state,
  field,
  id,
}: {
  state: ActionResult<unknown> | null;
  /** Omis : n'affiche que les erreurs qui ne visent aucun champ précis. */
  field?: string;
  id?: string;
}) {
  if (!state || state.ok) return null;
  if ((state.field || undefined) !== field) return null;

  return (
    <p id={id} role="alert" className="text-danger text-sm">
      {state.error}
    </p>
  );
}

/** Vrai si l'erreur courante vise ce champ : sert à poser `aria-invalid`. */
export function hasFieldError(
  state: ActionResult<unknown> | null,
  field: string,
) {
  return Boolean(state && !state.ok && state.field === field);
}
