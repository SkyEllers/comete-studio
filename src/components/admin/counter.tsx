import type { LucideIcon } from "lucide-react";

/**
 * Un chiffre d'administration, dans sa carte.
 *
 * La valeur est déjà mise en forme par l'appelant : un compte et un poids ne
 * se formatent pas pareil, et ce composant n'a pas à le savoir.
 */
export function Counter({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="border-line bg-surface-1 rounded-lg border p-5">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {label}
      </div>
      <p className="font-display mt-3 text-3xl font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}
