import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

/** Un vide expliqué, jamais une page blanche. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border-line bg-surface-1 flex flex-col items-center rounded-lg border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className="text-muted-foreground mb-4 size-6"
          strokeWidth={1.5}
        />
      ) : null}
      <p className="font-display font-semibold">{title}</p>
      {description ? (
        <p className="text-muted-foreground mt-1.5 max-w-md text-sm">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
