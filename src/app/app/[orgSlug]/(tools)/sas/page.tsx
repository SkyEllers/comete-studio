import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/access";
import { Capture } from "@/tools/sas/capture";
import { getBoites } from "@/tools/sas/queries";

/**
 * La racine de Sas est la zone de texte. Pas de tableau de bord, pas de
 * compteur, pas d'écran d'accueil : on arrive là pour vider sa tête, et le
 * curseur est déjà dans le champ.
 *
 * Les boîtes sont chargées ici, côté serveur, parce que l'écran de
 * vérification en a besoin dès la première seconde — et parce qu'aller les
 * chercher après le classement ajouterait une attente là où il n'en faut pas.
 */
export default async function SasPage({ params }: PageProps<"/app/[orgSlug]/sas">) {
  const { orgSlug } = await params;
  const { org } = await requireMembership(orgSlug);

  const boites = await getBoites(org.id);

  return (
    <div className="mx-auto flex min-h-[70svh] w-full max-w-2xl flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl">Sas</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/${orgSlug}`} prefetch>
            <ArrowLeft aria-hidden="true" />
            Tes outils
          </Link>
        </Button>
      </div>

      <Capture orgSlug={orgSlug} boites={boites} />
    </div>
  );
}
