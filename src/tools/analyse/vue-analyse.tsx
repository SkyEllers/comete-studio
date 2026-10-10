import { AlertTriangle, CircleHelp, Lightbulb, MessagesSquare, Radio, SearchCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

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
import { MINUTES_APPEL_COMPLET, partDe } from "./parole";
import { alertesSures, estTranchee, type Alerte, type AnalyseRangee, type Tranche } from "./schema";

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

/**
 * Une analyse complète : pourquoi, à retenir, les moments clés, les repères, les alertes,
 * ce qu'elle ne savait pas. La closeuse ne voit que les alertes sûres ; Louis
 * voit aussi celles à vérifier, avec de quoi les trancher (`trancher`).
 */
export function DetailAnalyse({
  analyse,
  issue,
  pourLouis = false,
  tranchees = [],
  trancher,
}: {
  analyse: AnalyseRangee;
  issue: Issue;
  pourLouis?: boolean;
  /** Les décisions de Louis sur les alertes de cet appel. */
  tranchees?: Tranche[];
  trancher?: (alerte: Alerte) => ReactNode;
}) {
  const p = analyse.pourquoi;
  const sures = alertesSures(analyse.alertes);
  const aVerifier = pourLouis ? analyse.alertes.filter((a) => a.certitude === "a_verifier") : [];
  return (
    <div className="space-y-6">
      {analyse.parole?.incomplet ? (
        <p className="border-warning/40 bg-warning/10 text-warning rounded-md border px-3 py-2 text-sm">
          Enregistrement coupé : {analyse.parole.minutes} minutes enregistrées, pour un diagnostic de 45. L&apos;analyse ne
          porte que sur ce qui a été enregistré. Dépose le fichier complet : elle se refera toute seule.
        </p>
      ) : null}

      {analyse.resume ? <p className="text-sm">{analyse.resume}</p> : null}

      <TempsDeParole analyse={analyse} />

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
        {p.freins_exprimes.length || p.freins_supposes.length ? (
          <div className="mt-3 text-sm">
            <p className="text-muted-foreground text-xs">Les autres freins</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {p.freins_exprimes.map((f, i) => (
                <li key={`e${i}`}>{f}</li>
              ))}
              {p.freins_supposes.map((f, i) => (
                <li key={`s${i}`}>
                  {f} <span className="text-muted-foreground">(hypothèse, elle ne l&apos;a pas dit)</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {p.signaux_encourageants.length ? (
          <div className="mt-3 text-sm">
            <p className="text-muted-foreground text-xs">Les signaux encourageants</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {p.signaux_encourageants.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {p.aurait_pu_changer ? (
          <div className="mt-3 text-sm">
            <p className="text-muted-foreground text-xs">{issue === "vente" ? "Ce qui a fait la vente" : "Ce qui aurait pu changer"}</p>
            <p>{p.aurait_pu_changer}</p>
          </div>
        ) : null}
        {analyse.suite ? (
          <div className="mt-3 text-sm">
            <p className="text-muted-foreground text-xs">La suite conseillée</p>
            <p>{analyse.suite}</p>
          </div>
        ) : null}
        {p.verdict && p.verdict !== "vente" && p.verdict_explication ? (
          <p className={cn("mt-3 text-sm font-medium", p.verdict === "contrainte_reelle" ? "text-success" : "")}>
            {p.verdict_explication}
          </p>
        ) : null}
      </section>

      {analyse.moments_cles.length ? (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Radio aria-hidden="true" className="size-4" />
            Les moments qui comptaient
          </h3>
          <ol className="divide-trait border-trait divide-y rounded-lg border">
            {analyse.moments_cles.map((m, i) => (
              <li key={i} className="space-y-1 p-3 text-sm">
                <p>
                  <Minute minute={m.minute} /> <span className="italic">« {m.signal} »</span>
                </p>
                <p>{m.lecture}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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

      {sures.length ? (
        <section className="border-danger/30 bg-danger/5 rounded-lg border p-4">
          <h3 className="text-danger mb-2 flex items-center gap-2 text-sm font-medium">
            <AlertTriangle aria-hidden="true" className="size-4" />
            {sures.length === 1 ? "Une règle à revoir" : `${sures.length} règles à revoir`}
          </h3>
          <ul className="space-y-3 text-sm">
            {sures.map((a, i) => (
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

      {aVerifier.length ? (
        <section className="border-warning/30 bg-warning/5 rounded-lg border p-4">
          <h3 className="text-warning mb-1 flex items-center gap-2 text-sm font-medium">
            <SearchCheck aria-hidden="true" className="size-4" />À vérifier par toi ({aVerifier.length})
          </h3>
          <p className="text-muted-foreground mb-3 text-xs">La closeuse ne les voit pas. Ce que tu tranches entre dans le carnet.</p>
          <ul className="space-y-4 text-sm">
            {aVerifier.map((a, i) => {
              const fait = estTranchee(a, tranchees);
              return (
                <li key={i} className="space-y-1">
                  <p className="font-medium">
                    {libelleAlerte(a.cle)} <Minute minute={a.minute} />
                    {fait ? <span className="text-success ml-2 text-xs font-normal">tranchée</span> : null}
                  </p>
                  {a.extrait ? <p className="italic">« {a.extrait} »</p> : null}
                  <p className="text-muted-foreground">{a.explication}</p>
                  {!fait && trancher ? trancher(a) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-sm font-medium">Les repères</h3>
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

/**
 * Le temps de parole de la vendeuse, compté par le hub : sur tout l'appel et
 * par tranche de 15 minutes. Le script de Peggy vise 20 % de parole.
 */
function TempsDeParole({ analyse }: { analyse: AnalyseRangee }) {
  if (!analyse.parole) return null;
  const { total, tranches } = partDe(analyse.parole, analyse.voix_closeuse);
  if (total === null) return null;
  const teinte = (part: number) => (part <= 35 ? "bg-success" : part <= 55 ? "bg-warning" : "bg-braise-fonce");
  return (
    <section className="border-trait rounded-lg border p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
        <MessagesSquare aria-hidden="true" className="size-4" />
        Temps de parole de la vendeuse : {total} %
      </h3>
      <p className="text-muted-foreground mb-3 text-xs">
        Compté sur la transcription, {analyse.parole.minutes} minutes. Le script de Peggy vise 80 % d&apos;écoute, soit 20 % de
        parole.
      </p>
      <ul className="space-y-1.5">
        {tranches
          .filter((t) => t.part !== null)
          .map((t) => (
            <li key={t.debut} className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground w-20 shrink-0 font-mono tabular-nums">
                {t.debut}-{t.fin} min
              </span>
              <span className="bg-papier-fonce h-2 flex-1 overflow-hidden rounded-full">
                <span className={cn("block h-full", teinte(t.part as number))} style={{ width: `${t.part}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right font-mono tabular-nums">{t.part} %</span>
            </li>
          ))}
      </ul>
    </section>
  );
}

/** « coupé » dans une liste d'appels, quand l'enregistrement est trop court. */
export function MarqueCoupe({ analyse }: { analyse: AnalyseRangee | null }) {
  if (!analyse?.parole?.incomplet) return null;
  return (
    <span className="text-warning text-xs" title={`Moins de ${MINUTES_APPEL_COMPLET} minutes enregistrées`}>
      coupé ({analyse.parole.minutes} min)
    </span>
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
