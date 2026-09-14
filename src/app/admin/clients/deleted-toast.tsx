"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * La suppression redirige ici avec `?supprime=<slug>` : on affiche la
 * confirmation, puis on nettoie l'adresse pour qu'un rechargement ne la
 * rejoue pas.
 *
 * `&avertissement=calendly` : le client est bien supprimé, mais son abonnement
 * Calendly n'a pas pu l'être. La même phrase que « Déconnecter », qui applique
 * la même règle — et elle reste affichée jusqu'à ce qu'on la ferme, parce
 * qu'elle demande un geste.
 */
export function DeletedToast({
  slug,
  avertissement,
}: {
  slug: string;
  avertissement: "calendly" | null;
}) {
  const router = useRouter();

  useEffect(() => {
    toast.success(`« ${slug} » supprimé`);
    if (avertissement === "calendly") {
      toast.warning(
        "Son abonnement Calendly n'a pas pu être supprimé. Il continuera d'appeler une adresse qui ne répond plus ; supprime-le à la main.",
        { duration: Infinity },
      );
    }
    router.replace("/admin/clients");
  }, [slug, avertissement, router]);

  return null;
}
