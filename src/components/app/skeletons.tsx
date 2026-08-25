import { Skeleton } from "@/components/ui/skeleton";

/**
 * Squelettes des écrans connectés.
 *
 * Ils ne servent pas qu'à occuper l'écran : sur une route dynamique, Next ne
 * préchargue que jusqu'à la frontière `loading` la plus proche. Sans eux, le
 * `prefetch` des liens ne ramène rien.
 */

/** Barre haute : logo, nom du client, menu. */
export function ShellHeaderSkeleton() {
  return (
    <header className="border-line border-b">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Skeleton className="h-5 w-28" />
        <span aria-hidden="true" className="bg-line hidden h-5 w-px sm:block" />
        <Skeleton className="hidden h-4 w-36 sm:block" />
        <Skeleton className="ml-auto h-8 w-28" />
      </div>
    </header>
  );
}

/** Titre de page et sa phrase d'explication. */
export function PageHeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      {action ? <Skeleton className="h-9 w-36" /> : null}
    </div>
  );
}

/** Grille de tuiles (outils, espaces). */
export function CardGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="border-line bg-surface-1 rounded-lg border p-5"
        >
          <Skeleton className="size-5" />
          <Skeleton className="mt-4 h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Tableau : une ligne d'en-tête, des lignes de contenu. */
export function TableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="border-line divide-line divide-y rounded-lg border">
      <div className="flex items-center gap-4 px-4 py-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="ml-auto h-4 w-24" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
