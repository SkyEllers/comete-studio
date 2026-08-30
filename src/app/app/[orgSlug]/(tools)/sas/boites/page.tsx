import { Inbox, PackageOpen, User } from "lucide-react";
import Link from "next/link";

import { requireMembership } from "@/lib/access";
import { MenuBoite } from "@/tools/sas/boite-tuile";
import { EnteteSas } from "@/tools/sas/entete";
import { compteResultats } from "@/tools/sas/format";
import { getEtageres, rechercher, type Resultat } from "@/tools/sas/queries";
import { BarreBoites } from "@/tools/sas/recherche";
import { Tuile } from "@/tools/sas/tuile";

/**
 * Où l'on retrouve ce qu'on a rangé.
 *
 * Les trois sortes de places au même niveau : les boîtes, Perso, et
 * « À ranger » quand elle contient quelque chose. Une hiérarchie serait un
 * mensonge — de l'endroit où l'on se tient, ce sont trois tiroirs.
 *
 * Le champ de recherche remplace la grille par ses résultats plutôt que de
 * s'ouvrir dans un écran à part : on cherche pour retrouver, et retrouver
 * c'est arriver quelque part, pas ouvrir une fenêtre de plus.
 */
export default async function BoitesPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/sas/boites">) {
  const { orgSlug } = await params;
  const { q } = await searchParams;
  const { org } = await requireMembership(orgSlug);

  const recherche = typeof q === "string" ? q : "";
  const racine = `/app/${orgSlug}/sas`;

  const [etageres, resultats] = await Promise.all([
    getEtageres(org.id),
    recherche.trim() ? rechercher(org.id, orgSlug, recherche) : Promise.resolve(null),
  ]);

  return (
    <>
      <EnteteSas
        orgSlug={orgSlug}
        titre="Boîtes"
        description="Tout ce que tu as rangé, et où le retrouver."
        courant="boites"
      />

      <BarreBoites orgSlug={orgSlug} recherche={recherche} />

      {resultats ? (
        <Resultats resultats={resultats} recherche={recherche} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Tuile
            href={`${racine}/perso`}
            nom="Perso"
            compteur={etageres.perso}
            icone={User}
            systeme
          />

          {etageres.aRanger.notes > 0 ? (
            <Tuile
              href={`${racine}/boites/a-ranger`}
              nom="À ranger"
              compteur={etageres.aRanger}
              icone={PackageOpen}
              systeme
            />
          ) : null}

          {etageres.boites.map((boite) => (
            <Tuile
              key={boite.id}
              href={`${racine}/boites/${boite.id}`}
              nom={boite.name}
              compteur={boite}
              icone={Inbox}
              action={
                <MenuBoite
                  orgSlug={orgSlug}
                  boite={{ id: boite.id, name: boite.name }}
                  notes={boite.notes}
                />
              }
            />
          ))}
        </div>
      )}

      {!resultats && etageres.boites.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm">
          Aucune boîte pour l&apos;instant. Elles naissent toutes seules quand tu
          ranges une idée au nom d&apos;un client, ou avec le bouton ci-dessus.
        </p>
      ) : null}
    </>
  );
}

/**
 * Les résultats. Chacun dit où il se trouve et y mène : une recherche qui ne
 * ramènerait que le texte obligerait à chercher deux fois.
 */
function Resultats({
  resultats,
  recherche,
}: {
  resultats: Resultat[];
  recherche: string;
}) {
  if (resultats.length === 0) {
    return (
      <div className="border-line bg-surface-1 rounded-lg border border-dashed px-6 py-12 text-center">
        <p className="font-display font-semibold">
          Rien qui contienne « {recherche.trim()} ».
        </p>
        <p className="text-muted-foreground mt-1.5 text-sm">
          La recherche regarde les deux univers, toutes les boîtes, et les idées
          archivées.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {compteResultats(resultats.length)}
        {resultats.length === 50 ? " ou plus — affine ta recherche." : ""}
      </p>

      <ul className="space-y-2">
        {resultats.map((resultat) => (
          <li key={resultat.id}>
            <Link
              href={resultat.href}
              prefetch
              className="border-line bg-surface-1 hover:bg-surface-2 focus-visible:ring-ring block rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <p className="text-sm break-words whitespace-pre-wrap">
                {resultat.content}
              </p>
              <p className="text-muted-foreground mt-2 font-mono text-xs">
                {resultat.placeLabel}
                {resultat.is_archived ? " · archivée" : ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
