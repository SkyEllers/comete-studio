import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/app/skeletons";

/** La coquille est déjà là : on n'esquisse que le contenu. */
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardGridSkeleton />
    </>
  );
}
