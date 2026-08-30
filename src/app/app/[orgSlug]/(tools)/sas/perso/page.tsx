import { requireMembership } from "@/lib/access";
import { EnteteSas } from "@/tools/sas/entete";
import { compteIdees } from "@/tools/sas/format";
import { ListeNotes } from "@/tools/sas/liste-notes";
import { getBoites, getListe } from "@/tools/sas/queries";

/**
 * Perso : ce qui n'a rien à voir avec le travail, et n'a donc pas de boîte.
 *
 * Pas de tri par sujet ici, et c'est délibéré : les courses, le dentiste et
 * l'anniversaire de quelqu'un n'ont pas de classement commun, seulement une
 * date. Une liste chronologique dit la vérité sur ce que c'est.
 */
export default async function PersoPage({
  params,
}: PageProps<"/app/[orgSlug]/sas/perso">) {
  const { orgSlug } = await params;
  const { org } = await requireMembership(orgSlug);

  const [liste, boites] = await Promise.all([
    getListe(org.id, { type: "perso" }),
    getBoites(org.id),
  ]);

  return (
    <>
      <EnteteSas
        orgSlug={orgSlug}
        titre="Perso"
        description={compteIdees(liste.actives)}
        courant="boites"
        retour={{ href: `/app/${orgSlug}/sas/boites`, label: "Boîtes" }}
      />

      <ListeNotes
        orgSlug={orgSlug}
        liste={liste}
        boites={boites}
        place={{ type: "perso" }}
        vide={{
          titre: "Rien de perso pour l'instant.",
          description: "Ce qui ne touche pas au travail atterrit ici.",
        }}
      />
    </>
  );
}
