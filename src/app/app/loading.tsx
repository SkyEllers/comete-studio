import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShellHeaderSkeleton,
} from "@/components/app/skeletons";

/**
 * Frontière de chargement de tout l'espace connecté. La coquille n'est pas
 * encore rendue à ce stade (elle vit dans le layout de l'organisation), donc
 * on esquisse aussi la barre haute pour éviter que la page ne saute.
 */
export default function Loading() {
  return (
    <div className="flex min-h-svh flex-col">
      <ShellHeaderSkeleton />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <PageHeaderSkeleton />
        <CardGridSkeleton />
      </main>
    </div>
  );
}
