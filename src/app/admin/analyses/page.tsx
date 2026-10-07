import { ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { libellePoint, SEUIL_LECON, SEUIL_OUVERTURE } from "@/tools/analyse/grille";
import { getTableauAdmin, type LeconVue, type TableauClient } from "@/tools/analyse/queries";

import { BoutonSynthese, BoutonsLecon } from "./boutons";

/**
 * Analyses — ce que les appels des closeuses et de la titulaire apprennent
 * (0055, Louis, 07/10/2026). Louis seul : le détail de chaque personne, le
 * carnet de leçons, le portrait de la cliente, et ce qu'il faudra regarder au
 * prochain recrutement.
 */

export const metadata = { title: "Analyses — Comète Studio" };
export const maxDuration = 300;

const jour = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });
const SENS = { vend: "Fait vendre", perd: "Fait perdre", conseil: "Consigne" } as const;

export default async function AnalysesPage() {
  await requireAdmin();
  const clients = await getTableauAdmin();

  return (
    <>
      <PageHeader
        title="Analyses"
        description={`Chaque diagnostic enregistré est relu par Claude dès que le résultat est noté. Les closeuses voient leurs analyses à partir de ${SEUIL_OUVERTURE} rendez-vous tenus ; le carnet et le portrait sont pour toi seul.`}
      />
      {clients.length ? (
        clients.map((c) => <Client key={c.organizationId} client={c} />)
      ) : (
        <EmptyState icon={Sparkles} title="Aucun client analysé." description="L'analyse tourne chez les clients qui ont un profil d'analyse." />
      )}
    </>
  );
}

function Client({ client: c }: { client: TableauClient }) {
  const proposees = c.carnet.filter((l) => l.statut === "proposee");
  const actives = c.carnet.filter((l) => l.statut === "active");
  const ecartees = c.carnet.filter((l) => l.statut === "refusee" || l.statut === "retiree");
  const total = c.personnes.reduce((s, p) => s + p.analyses, 0);

  return (
    <section className="mb-12 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl">{c.nom}</h2>
          <p className="text-muted-foreground text-sm">
            {total} appels analysés · {c.enAttente} en attente
            {c.echecs ? ` · ${c.echecs} en échec` : ""} · {c.coutDuMoisDollars.toFixed(2).replace(".", ",")} $ ce mois-ci
          </p>
        </div>
        <BoutonSynthese organizationId={c.organizationId} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium">Par personne</h3>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {c.personnes.map((p) => (
            <li key={p.cle}>
              <Link
                href={`/admin/analyses/${c.organizationId}/${p.cle}`}
                prefetch={false}
                className="border-trait bg-card hover:border-ember group flex h-full flex-col gap-1 rounded-lg border p-4 transition-colors"
              >
                <span className="flex items-center justify-between gap-2">
                  <span>{p.nom}</span>
                  <ChevronRight aria-hidden="true" className="text-muted-foreground group-hover:text-ember size-4" />
                </span>
                <span className="text-muted-foreground text-xs">
                  {p.analyses} appels analysés · {p.ventes} ventes
                  {p.alertes ? ` · ${p.alertes} alertes` : ""}
                </span>
                {p.tenus !== null ? (
                  <span className="text-muted-foreground text-xs">
                    {p.ouverte ? "Voit ses analyses" : `Onglet fermé : ${p.tenus} / ${SEUIL_OUVERTURE} rendez-vous tenus`}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">Ses propres appels, en référence</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium">Le carnet de leçons</h3>
        <p className="text-muted-foreground text-sm">
          Une leçon soutenue par {SEUIL_LECON} appels ou plus entre seule dans le carnet. En dessous, elle attend ton oui. Toutes les
          leçons du carnet sont relues à chaque nouvelle analyse.
        </p>
        {proposees.length ? <Lecons titre={`À valider (${proposees.length})`} lecons={proposees} /> : null}
        {actives.length ? (
          <Lecons titre={`Dans le carnet (${actives.length})`} lecons={actives} />
        ) : (
          <p className="text-muted-foreground text-sm">Le carnet est vide : il se remplit à la première synthèse.</p>
        )}
        {ecartees.length ? (
          <details>
            <summary className="text-muted-foreground cursor-pointer text-sm">Refusées ou retirées ({ecartees.length})</summary>
            <div className="mt-3">
              <Lecons titre="" lecons={ecartees} />
            </div>
          </details>
        ) : null}
      </div>

      {c.synthese ? (
        <div className="space-y-6">
          <h3 className="text-sm font-medium">
            La dernière synthèse : le {jour.format(new Date(c.synthese.faiteLe))}, sur {c.synthese.nbAppels} appels
          </h3>
          <Bloc titre="L'équipe">{c.synthese.equipe}</Bloc>
          <div className="grid gap-4 lg:grid-cols-2">
            <Bloc titre="Qui achète">{c.synthese.portrait.qui_achete}</Bloc>
            <Bloc titre="Qui n'achète pas">{c.synthese.portrait.qui_n_achete_pas}</Bloc>
          </div>
          {c.synthese.portrait.mots.length ? (
            <div>
              <h4 className="mb-2 text-sm font-medium">Leurs mots</h4>
              <ul className="grid gap-2 sm:grid-cols-2">
                {c.synthese.portrait.mots.map((m, i) => (
                  <li key={i} className="border-trait bg-papier-clair rounded-md border px-3 py-2 text-sm italic">
                    « {m} »
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <Bloc titre="Ce que dit le questionnaire de réservation">{c.synthese.portrait.questionnaire}</Bloc>
            <Bloc titre="Ce qu'on ne sait pas encore">{c.synthese.portrait.a_creuser}</Bloc>
          </div>
          {c.synthese.recrutement.length ? (
            <div>
              <h4 className="mb-2 text-sm font-medium">Au prochain recrutement, regarder</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {c.synthese.recrutement.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Pas encore de synthèse : elle tourne chaque lundi matin, ou tout de suite avec « Lancer la synthèse ».
        </p>
      )}

      {c.portrait.total ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">
            Le portrait en chiffres : {c.portrait.total} rendez-vous au résultat connu, {c.portrait.ventes} ventes
          </h3>
          <p className="text-muted-foreground text-sm">Pour chaque case, combien de rendez-vous, et combien de ventes parmi eux.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.portrait.dimensions
              .filter((d) => d.lignes.length)
              .map((d) => (
                <div key={d.cle} className="border-trait rounded-lg border">
                  <p className="bg-papier-fonce px-3 py-2 text-xs font-medium">{d.libelle}</p>
                  <table className="w-full text-sm">
                    <tbody className="divide-trait divide-y">
                      {d.lignes.map((l) => (
                        <tr key={l.valeur}>
                          <td className="px-3 py-1.5">{l.libelle}</td>
                          <td className="text-muted-foreground px-3 py-1.5 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                            {l.ventes} / {l.total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="border-trait bg-papier-clair rounded-lg border p-4">
      <h4 className="mb-1.5 text-sm font-medium">{titre}</h4>
      <p className="text-sm whitespace-pre-line">{children}</p>
    </div>
  );
}

function Lecons({ titre, lecons }: { titre: string; lecons: LeconVue[] }) {
  return (
    <div>
      {titre ? <h4 className="mb-2 text-sm">{titre}</h4> : null}
      <ul className="border-trait divide-trait divide-y rounded-lg border">
        {lecons.map((l) => (
          <li key={l.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm">{l.texte}</p>
              <p className="text-muted-foreground text-xs">
                {SENS[l.sens]} · {libellePoint(l.point)} ·{" "}
                {l.origine === "correction" ? "ta correction" : `${l.nbAppuis} appel${l.nbAppuis > 1 ? "s" : ""}`}
                {l.note ? ` · ${l.note}` : ""}
              </p>
            </div>
            <BoutonsLecon id={l.id} statut={l.statut} />
          </li>
        ))}
      </ul>
    </div>
  );
}
