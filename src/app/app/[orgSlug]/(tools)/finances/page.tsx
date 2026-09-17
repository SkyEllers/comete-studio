import { Sunrise } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { SelecteurMois } from "@/components/app/selecteur-mois";
import { requireToolAccess } from "@/lib/access";
import { getReleves } from "@/tools/horizon/queries";
import { VueReleve } from "@/tools/horizon/releve";

/**
 * L'écran d'Horizon : le relevé du mois choisi, le plus récent par défaut.
 *
 * Le mois voyage par l'URL, comme dans Radar et Pulsar. Un mois demandé qui
 * n'a pas de relevé (ou pas encore publié) ramène au plus récent plutôt qu'à
 * une page vide.
 */
export default async function HorizonPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/finances">) {
  const { orgSlug } = await params;
  const { mois: demande } = await searchParams;
  const { org } = await requireToolAccess(orgSlug, "finances");

  const releves = await getReleves(org.id);

  if (releves.length === 0) {
    return (
      <EmptyState
        icon={Sunrise}
        title="Ta première page arrive bientôt"
        description="Chaque début de mois, tu trouveras ici ce qui est entré, ce que ton entreprise a coûté, et où en sont tes poches."
      />
    );
  }

  const choisi = releves.find((releve) => releve.mois === demande) ?? releves[0]!;

  return (
    <>
      {releves.length > 1 ? (
        <SelecteurMois
          mois={choisi.mois}
          choix={releves.map((releve) => releve.mois)}
          href={(mois) => `/app/${orgSlug}/finances?mois=${mois}`}
        />
      ) : null}
      <VueReleve releve={choisi} />
    </>
  );
}
