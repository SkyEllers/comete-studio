import { Skeleton } from "@/components/ui/skeleton";

/**
 * Squelettes des écrans connectés.
 *
 * Ils vivent toujours **sous** les gardes, dans un `<Suspense>` posé à
 * l'intérieur d'une page — jamais dans un `loading.tsx` au-dessus d'un layout
 * qui appelle `notFound()` ou `redirect()`. Sinon la réponse part en flux avec
 * un 200 avant que la garde ne se prononce, et le statut ne peut plus changer.
 */

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

/** Compteurs du tableau de bord. */
export function CountersSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="border-line bg-surface-1 rounded-lg border p-5"
        >
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-9 w-12" />
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

/** Liste d'outils avec leur interrupteur. */
export function ToolListSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="border-line divide-line divide-y rounded-lg border">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-start justify-between gap-4 p-4"
        >
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      ))}
    </div>
  );
}
