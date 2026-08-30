import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/access";
import { EnteteSas } from "@/tools/sas/entete";
import { compteIdees } from "@/tools/sas/format";
import { ListeNotes } from "@/tools/sas/liste-notes";
import { getBoite, getBoites, getListe } from "@/tools/sas/queries";

/**
 * Le contenu d'une boîte, du plus récent au plus ancien.
 *
 * `notFound()` si la boîte n'existe pas — ou si la RLS ne la montre pas, ce
 * qui du point de vue d'ici est la même chose et doit le rester : on ne dit
 * jamais à quelqu'un qu'un identifiant existe ailleurs.
 */
export default async function BoitePage({
  params,
}: PageProps<"/app/[orgSlug]/sas/boites/[boxId]">) {
  const { orgSlug, boxId } = await params;
  const { org } = await requireMembership(orgSlug);

  const boite = await getBoite(org.id, boxId);
  if (!boite) notFound();

  const [liste, boites] = await Promise.all([
    getListe(org.id, { type: "boite", boxId }),
    getBoites(org.id),
  ]);

  return (
    <>
      <EnteteSas
        orgSlug={orgSlug}
        titre={boite.name}
        description={compteIdees(liste.actives)}
        courant="boites"
        retour={{ href: `/app/${orgSlug}/sas/boites`, label: "Boîtes" }}
      />

      <ListeNotes
        orgSlug={orgSlug}
        liste={liste}
        boites={boites}
        place={{ type: "boite", boxId }}
        vide={{
          titre: "Cette boîte est vide.",
          description:
            "Range-y une idée depuis la capture, ou déplace-en une depuis une autre boîte.",
        }}
      />
    </>
  );
}
