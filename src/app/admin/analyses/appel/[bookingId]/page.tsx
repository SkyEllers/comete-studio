import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { libellePoint } from "@/tools/analyse/grille";
import { getVueAppel } from "@/tools/analyse/queries";
import { LIBELLES_FICHE, type Fiche } from "@/tools/analyse/schema";
import { BadgeIssue, DetailAnalyse, ListePassages } from "@/tools/analyse/vue-analyse";

import { BoutonRelancer, FormCorrection, TrancherAlerte } from "../../boutons";

/**
 * Un appel analysé, vu par Louis : l'analyse entière, la fiche de la cliente
 * (Louis seul), les passages qui servent d'exemples, et « Pas d'accord ».
 */

export const metadata = { title: "Analyse d'un appel — Comète Studio" };
export const maxDuration = 300;

const date = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

const lib = (v: string) => LIBELLES_FICHE[v] ?? v;

function LignesFiche({ fiche, titulaire }: { fiche: Fiche; titulaire: string }) {
  const lignes: [string, string][] = [
    ["Âge", fiche.age ? `${fiche.age} ans` : lib(fiche.tranche_age)],
    ["Ménopause", lib(fiche.menopause)],
    ["En couple", lib(fiche.couple)],
    ["Enfants", lib(fiche.enfants)],
    ["Métier", fiche.metier || "pas dit"],
    ["Ce qui l'a fait réserver", `${lib(fiche.declencheur)}${fiche.declencheur_mots ? ` : ${fiche.declencheur_mots}` : ""}`],
    ["Déjà essayé", fiche.essais.map(lib).join(", ") || "pas dit"],
    ["Dépensé", fiche.depense || "pas dit"],
    ["Ce qui la fait souffrir", fiche.souffrances.map(lib).join(", ") || "pas dit"],
    ["Ce qu'elle veut retrouver", fiche.veut_retrouver || "pas dit"],
    ["Ses freins", fiche.freins.map(lib).join(", ") || "aucun dit"],
    ["Qui décide", lib(fiche.decide)],
    [`Comment elle a connu ${titulaire}`, lib(fiche.source)],
  ];
  return (
    <dl className="divide-trait border-trait divide-y rounded-lg border text-sm">
      {lignes.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-3 py-2 sm:grid-cols-3">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="sm:col-span-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AppelPage({ params }: PageProps<"/admin/analyses/appel/[bookingId]">) {
  await requireAdmin();
  const { bookingId } = await params;
  const vue = await getVueAppel(bookingId);
  if (!vue) notFound();
  const { appel } = vue;

  return (
    <>
      <PageHeader
        title={`${appel.prenom}, avec ${vue.menePar.split(" ")[0]}`}
        aCoteDuTitre={<BadgeIssue issue={appel.issue} />}
        description={appel.debut ? date.format(new Date(appel.debut)) : undefined}
        action={<BoutonRelancer bookingId={bookingId} />}
      />
      <p className="mb-6 text-sm">
        <Link href="/admin/analyses" className="text-muted-foreground underline underline-offset-2">
          Toutes les analyses
        </Link>
      </p>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          {appel.analyse ? (
            <DetailAnalyse
              analyse={appel.analyse}
              issue={appel.issue}
              pourLouis
              tranchees={vue.tranchees}
              trancher={(a) => (
                <TrancherAlerte bookingId={bookingId} alerte={{ cle: a.cle, minute: a.minute, extrait: a.extrait }} />
              )}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {appel.etat === "echec" ? `L'analyse a échoué : ${appel.erreur ?? "raison inconnue"}.` : "L'analyse n'est pas encore faite."}
            </p>
          )}
        </div>

        <aside className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Pas d&apos;accord ?</h2>
            <p className="text-muted-foreground text-sm">
              Ta correction entre tout de suite dans le carnet de leçons, et toutes les analyses suivantes la relisent.
            </p>
            <FormCorrection bookingId={bookingId} />
            {vue.corrections.length ? (
              <ul className="space-y-2">
                {vue.corrections.map((c) => (
                  <li key={c.id} className="border-trait bg-papier-clair rounded-md border px-3 py-2 text-sm">
                    <p>{c.texte}</p>
                    <p className="text-muted-foreground text-xs">
                      {libellePoint(c.point)} · {c.statut === "active" ? "dans le carnet" : "retirée"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {vue.fiche ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">La cliente (toi seul)</h2>
              <LignesFiche fiche={vue.fiche} titulaire={vue.titulaire} />
              {vue.fiche.phrases.length ? (
                <ul className="space-y-1.5">
                  {vue.fiche.phrases.map((p, i) => (
                    <li key={i} className="text-sm italic">
                      « {p} »
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-sm font-medium">Les passages montrés aux autres</h2>
            <ListePassages passages={vue.passages} titulaire={vue.titulaire} />
          </section>

          <p className="text-muted-foreground text-xs">
            {vue.modele ?? ""} · {vue.coutDollars.toFixed(2).replace(".", ",")} $
          </p>
        </aside>
      </div>
    </>
  );
}
