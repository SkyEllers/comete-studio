import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { getVuePersonne } from "@/tools/analyse/queries";
import { alertesSures } from "@/tools/analyse/schema";
import { BadgeIssue, MarqueCoupe, TableComparaison } from "@/tools/analyse/vue-analyse";

/** Une closeuse, ou la titulaire, vue par Louis : son ensemble face à l'équipe, et chacun de ses appels. */

export const metadata = { title: "Analyses — Comète Studio" };

const date = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });

export default async function PersonnePage({ params }: PageProps<"/admin/analyses/[orgId]/[personne]">) {
  await requireAdmin();
  const { orgId, personne } = await params;
  const vue = await getVuePersonne(orgId, personne);
  if (!vue) notFound();

  const faites = vue.appels.filter((a) => a.analyse);
  const ventes = faites.filter((a) => a.issue === "vente").length;
  const alertes = faites.reduce((s, a) => s + alertesSures(a.analyse?.alertes ?? []).length, 0);

  return (
    <>
      <PageHeader
        title={vue.nom}
        description={`${vue.client} · ${faites.length} appels analysés, ${ventes} ventes${alertes ? `, ${alertes} alertes` : ""}.`}
      />
      <p className="mb-6 text-sm">
        <Link href="/admin/analyses" className="text-muted-foreground underline underline-offset-2">
          Toutes les analyses
        </Link>
      </p>

      {faites.length ? (
        <div className="mb-10 space-y-3">
          <h2 className="text-sm font-medium">Son ensemble</h2>
          <p className="text-muted-foreground text-sm">
            {vue.parTitulaire
              ? "Ses appels face à ceux des closeuses."
              : "Ses appels face à ceux des autres closeuses (ce qu'elle voit aussi, sans les noms)."}
          </p>
          <TableComparaison
            lignes={vue.comparaison}
            nbAppels={faites.length}
            nbAppelsEquipe={vue.nbAppelsEquipe}
            libelleMoi={vue.nom.split(" ")[0]}
          />
        </div>
      ) : null}

      <h2 className="mb-3 text-sm font-medium">Ses appels</h2>
      {vue.appels.length ? (
        <ul className="border-trait divide-trait divide-y rounded-lg border">
          {vue.appels.map((a) => (
            <li key={a.bookingId}>
              <Link
                href={`/admin/analyses/appel/${a.bookingId}`}
                prefetch={false}
                className="hover:bg-papier-fonce flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <span className="min-w-0 truncate text-sm">
                  {a.debut ? date.format(new Date(a.debut)) : ""} · {a.prenom}
                  {(() => {
                    const n = alertesSures(a.analyse?.alertes ?? []).length;
                    const v = (a.analyse?.alertes.length ?? 0) - n;
                    return n || v ? (
                      <span className="ml-2 text-xs">
                        {n ? <span className="text-danger">{n} alerte{n > 1 ? "s" : ""}</span> : null}
                        {v ? <span className="text-warning ml-2">{v} à vérifier</span> : null}
                      </span>
                    ) : null;
                  })()}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <MarqueCoupe analyse={a.analyse} />
                  {a.analyse ? null : (
                    <span className="text-muted-foreground text-xs">
                      {a.etat === "echec" ? `Échec : ${a.erreur ?? "inconnu"}` : "Analyse en attente"}
                    </span>
                  )}
                  <BadgeIssue issue={a.issue} />
                  <ChevronRight aria-hidden="true" className="text-muted-foreground size-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">Aucun appel enregistré et transcrit pour l&apos;instant.</p>
      )}
    </>
  );
}
