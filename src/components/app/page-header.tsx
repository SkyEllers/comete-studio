import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  /** Ce qui se place juste à côté du titre (les flèches entre closeuses, par exemple). */
  aCoteDuTitre?: React.ReactNode;
  description?: string;
  /** Bouton principal de la page, aligné à droite sur grand écran. */
  action?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  aCoteDuTitre,
  description,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1.5">
        {aCoteDuTitre ? (
          <div className="flex items-center gap-3">
            <h1 className="text-2xl">{title}</h1>
            {aCoteDuTitre}
          </div>
        ) : (
          <h1 className="text-2xl">{title}</h1>
        )}
        {description ? (
          <p className="text-muted-foreground max-w-2xl text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
