import { AlertTriangle, CircleHelp, Lightbulb, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

import { dominant, libelleCompte, type Compte } from "./agregats";
import {
  LIBELLES_ISSUE,
  LIBELLES_REPERE,
  libelleAlerte,
  libelleMoment,
  libellePoint,
  MOMENTS,
  POINTS,
  type ClePoint,
  type Issue,
  type Repere,
} from "./grille";
import type { AnalyseRangee } from "./schema";

/**
 * L'affichage d'une analyse, des chiffres d'équipe et des passages : les
 * mêmes pour la closeuse et pour Louis. Sans état ni appel au serveur, il se
 * rend aussi bien dans un composant client que serveur.
 */

const TEINTE_REPERE: Record<Repere, string> = {
  acquis: "bg-success/10 text-success border-success/30",
  en_progres: "bg-warning/10 text-warning border-warning/30",
  a_travailler: "bg-braise-fonce/10 text-braise-fonce border-braise-fonce/30",
  sans_objet: "bg-papier-fonce text-muted-foreground border-trait",
};

export function BadgeRepere({ repere }: { repere: Repere | null }) {
  if (!repere) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap", TEINTE_REPERE[repere])}>
      {LIBELLES_REPERE[repere]}
    </span>
  );
}

const TEINTE_ISSUE: Record<Issue, string> = {
  vente: "bg-success/10 text-success border-success/30",
  r2: "bg-warning/10 text-warning border-warning/30",
  en_attente: "bg-papier-fonce text-encre border-trait",
  non: "bg-papier-fonce text-muted-foreground border-trait",
  inconnue: "bg-papier-fonce text-muted-foreground border-trait",
};

export function BadgeIssue({ issue }: { issue: Issue }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap", TEINTE_ISSUE[issue])}>
      {LIBELLES_ISSUE[issue]}
    </span>
  );
}

function Minute({ minute }: { minute: string }) {
  return minute ? <span className="text-muted-foreground font-mono text-xs tabular-nums">{minute}</span> : null;
}

/** Une analyse complète : pourquoi, à retenir, les douze repères, les alertes, ce qu'elle ne savait pas. */
export function DetailAnalyse({ analyse, issue, pourLouis = false }: { analyse: AnalyseRangee; issue: Issue; pourLouis?: boolean }) {
  const p = analyse.pourquoi;
  return (
    <div className="space-y-6">
      {analyse.resume ? <p className="text-sm">{analyse.resume}</p> : null}

      <section className="border-trait bg-papier-clair rounded-lg border p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Sparkles aria-hidden="true" className="text-braise size-4" />
          {issue === "vente" ? "Pourquoi elle a dit oui" : "Pourquoi ce n'était pas oui"}
          <Minute minute={p.minute_bascule} />
        </h3>
        <p className="text-sm">{p.bascule}</p>
        {p.raison_donnee || p.vraie_raison ? (
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {p.raison_donnee ? (
              <div>
                <dt className="text-muted-foreground text-xs">Ce qu&apos;elle a dit</dt>
                <dd>{p.raison_donnee}</dd>
              </div>
            ) : null}
            {p.vraie_raison ? (
              <div>
                <dt className="text-muted-foreground text-xs">Ce qui se lit dans l&apos;appel</dt>
                <dd>{p.vraie_raison}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {p.aurait_pu_changer ? (
          <div className="mt-3 text-sm">
            <p className="text-muted-foreground text-xs">{issue === "vente" ? "Ce qui a fait la vente" : "Ce qui aurait pu changer"}</p>
            <p>{p.aurait_pu_changer}</p>
          </div>
        ) : null}
      </section>

      {analyse.a_retenir.length ? (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Lightbulb aria-hidden="true" className="size-4" />À retenir pour le prochain appel
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {analyse.a_retenir.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {analyse.alertes.length ? (
        <section className="border-danger/30 bg-danger/5 rounded-lg border p-4">
          <h3 className="text-danger mb-2 flex items-center gap-2 text-sm font-medium">
            <AlertTriangle aria-hidden="true" className="size-4" />
            {analyse.alertes.length === 1 ? "Une règle à revoir" : `${analyse.alertes.length} règles à revoir`}
          </h3>
          <ul className="space-y-3 text-sm">
            {analyse.alertes.map((a, i) => (
              <li key={i}>
                <p className="font-medium">
                  {libelleAlerte(a.cle)} <Minute minute={a.minute} />
                </p>
                {a.extrait ? <p className="italic">« {a.extrait} »</p> : null}
                <p className="text-muted-foreground">{a.explication}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-sm font-medium">Les douze repères</h3>
        <ol className="divide-trait border-trait divide-y rounded-lg border">
          {analyse.points.map((pt) => (
            <li key={pt.cle} className="space-y-1.5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{libellePoint(pt.cle)}</span>
                <BadgeRepere repere={pt.repere} />
              </div>
              {pt.constat ? <p className="text-sm">{pt.constat}</p> : null}
              {pt.moments.map((m, i) => (
                <p key={i} className="text-muted-foreground text-xs">
                  <Minute minute={m.minute} /> « {m.extrait} »
                </p>
              ))}
            </li>
          ))}
        </ol>
      </section>

      {analyse.pas_su.length ? (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <CircleHelp aria-hidden="true" className="size-4" />
            {pourLouis ? "Ce qu'elle ne savait pas (à mettre dans le kit)" : "Les questions à préparer"}
          </h3>
          <ul className="space-y-3 text-sm">
            {analyse.pas_su.map((q, i) => (
              <li key={i}>
                <p className="font-medium">
                  {q.question} <Minute minute={q.minute} />
                </p>
                {q.reponse_donnee ? <p className="text-muted-foreground">Réponse donnée : {q.reponse_donnee}</p> : null}
                {q.bonne_reponse ? <p>La bonne réponse : {q.bonne_reponse}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Elle face à l'équipe, point par point : le repère le plus fréquent de chaque côté. */
export function TableComparaison({
  lignes,
  nbAppels,
  nbAppelsEquipe,
  libelleMoi = "Toi",
}: {
  lignes: { cle: ClePoint; moi: Compte; equipe: Compte }[];
  nbAppels: number;
  nbAppelsEquipe: number;
  libelleMoi?: string;
}) {
  return (
    <div className="border-trait overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-papier-fonce text-left text-xs">
          <tr>
            <th className="px-3 py-2 font-medium">Repère</th>
            <th className="px-3 py-2 font-medium">
              {libelleMoi} <span className="text-muted-foreground font-normal">({nbAppels} appels)</span>
            </th>
            <th className="px-3 py-2 font-medium">
              L&apos;équipe <span className="text-muted-foreground font-normal">({nbAppelsEquipe} appels)</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-trait divide-y">
          {lignes.map((l) => (
            <tr key={l.cle}>
              <td className="px-3 py-2">{POINTS.find((p) => p.cle === l.cle)?.libelle}</td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <BadgeRepere repere={dominant(l.moi)} />
                  <span className="text-muted-foreground text-xs">{libelleCompte(l.moi)}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <BadgeRepere repere={dominant(l.equipe)} />
                  <span className="text-muted-foreground text-xs">{libelleCompte(l.equipe)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type PassageAffiche = { id: string; moment: string; texte: string; pourquoi: string | null; parTitulaire: boolean; vente: boolean };

/** « Comment les autres s'y prennent » : les passages, rangés par moment de l'appel. */
export function ListePassages({ passages, titulaire }: { passages: PassageAffiche[]; titulaire: string }) {
  if (passages.length === 0) {
    return <p className="text-muted-foreground text-sm">Pas encore de passage à montrer : ils arrivent avec les appels analysés.</p>;
  }
  const groupes = MOMENTS.map((m) => ({ ...m, liste: passages.filter((p) => p.moment === m.cle) })).filter((g) => g.liste.length);
  return (
    <div className="space-y-6">
      {groupes.map((g) => (
        <section key={g.cle}>
          <h3 className="mb-2 text-sm font-medium">{libelleMoment(g.cle)}</h3>
          <ul className="space-y-3">
            {g.liste.map((p) => (
              <li key={p.id} className="border-trait bg-papier-clair rounded-lg border p-3 text-sm">
                <p className="whitespace-pre-line">{p.texte}</p>
                {p.pourquoi ? <p className="text-muted-foreground mt-2 text-xs">Pourquoi ça marche : {p.pourquoi}</p> : null}
                <p className="text-muted-foreground mt-1 text-xs">
                  {p.parTitulaire ? titulaire : "Une collègue"}
                  {p.vente ? " · appel qui a vendu" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
