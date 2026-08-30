import { requireMembership } from "@/lib/access";
import { EnteteSas } from "@/tools/sas/entete";
import { compteIdees } from "@/tools/sas/format";
import { ListeNotes } from "@/tools/sas/liste-notes";
import { getBoites, getListe } from "@/tools/sas/queries";

/**
 * « À ranger » : les idées pro qui n'ont pas trouvé de boîte.
 *
 * Une route en toutes lettres, à côté de `[boxId]`, plutôt qu'un identifiant
 * réservé qu'il aurait fallu reconnaître partout. Next fait passer le segment
 * fixe avant le dynamique, et l'adresse reste lisible dans la barre du
 * navigateur — c'est une place, pas un cas particulier caché.
 */
export default async function ARangerPage({
  params,
}: PageProps<"/app/[orgSlug]/sas/boites/a-ranger">) {
  const { orgSlug } = await params;
  const { org } = await requireMembership(orgSlug);

  const [liste, boites] = await Promise.all([
    getListe(org.id, { type: "aranger" }),
    getBoites(org.id),
  ]);

  return (
    <>
      <EnteteSas
        orgSlug={orgSlug}
        titre="À ranger"
        description={compteIdees(liste.actives)}
        courant="boites"
        retour={{ href: `/app/${orgSlug}/sas/boites`, label: "Boîtes" }}
      />

      <ListeNotes
        orgSlug={orgSlug}
        liste={liste}
        boites={boites}
        place={{ type: "aranger" }}
        vide={{
          titre: "Rien qui traîne.",
          description:
            "Les idées pro sans boîte atterrissent ici, en attendant que tu leur en donnes une.",
        }}
      />
    </>
  );
}
