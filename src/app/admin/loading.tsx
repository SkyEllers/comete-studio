import { PageHeaderSkeleton, TableSkeleton } from "@/components/app/skeletons";

/** Vaut pour toute l'administration, sous la coquille déjà rendue. */
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton action />
      <TableSkeleton />
    </>
  );
}
