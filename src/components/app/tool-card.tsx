import { ArrowUpRight, ExternalLink, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type ToolCardProps = {
  name: string;
  description: string;
  icon: LucideIcon;
  href: string;
  /** Outil externe : ouverture dans un nouvel onglet. */
  external?: boolean;
  className?: string;
};

export function ToolCard({
  name,
  description,
  icon: Icon,
  href,
  external = false,
  className,
}: ToolCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <Icon
          aria-hidden="true"
          className="text-ember size-5 shrink-0"
          strokeWidth={1.75}
        />
        {external ? (
          <ExternalLink
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
        ) : (
          <ArrowUpRight
            aria-hidden="true"
            className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
          />
        )}
      </div>

      <div className="mt-4 space-y-1">
        <p className="font-display font-semibold">
          {name}
          {external ? <span className="sr-only"> (nouvel onglet)</span> : null}
        </p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </>
  );

  const classes = cn(
    "group border-line bg-surface-1 hover:bg-surface-2 focus-visible:ring-ring block rounded-lg border p-5 transition-colors focus-visible:ring-2 focus-visible:outline-none",
    className,
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
      >
        {content}
      </a>
    );
  }

  return (
    <Link href={href} prefetch className={classes}>
      {content}
    </Link>
  );
}
