"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * La suppression redirige ici avec `?supprime=<slug>` : on affiche la
 * confirmation, puis on nettoie l'adresse pour qu'un rechargement ne la
 * rejoue pas.
 */
export function DeletedToast({ slug }: { slug: string }) {
  const router = useRouter();

  useEffect(() => {
    toast.success(`« ${slug} » supprimé`);
    router.replace("/admin/clients");
  }, [slug, router]);

  return null;
}
