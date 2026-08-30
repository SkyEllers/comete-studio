import { requireMembership } from "@/lib/access";
import { Capture } from "@/tools/sas/capture";
import { EnteteSas } from "@/tools/sas/entete";
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
    <div className="flex min-h-[65svh] flex-col">
      <EnteteSas orgSlug={orgSlug} titre="Sas" courant="capture" />
      <Capture orgSlug={orgSlug} boites={boites} />
    </div>
  );
}
