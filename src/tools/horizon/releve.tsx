import { ArrowDownRight, ArrowUpRight, Lightbulb, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { libelleMois } from "@/lib/mois";
import { cn } from "@/lib/utils";

import { avancement, calculer } from "./calculs.ts";
import type { Ligne } from "./contenu.ts";
import { eur, eurSigne } from "./format.ts";
import type { Releve } from "./queries.ts";

/**
 * Un relevé du mois, tel que le client le lit.
 *
 * L'ordre suit la conversation qu'on a avec lui : d'abord le mois en quatre
 * chiffres, puis le chemin de l'argent (ce qui entre, ce que l'entreprise
 * coûte, les impôts, le salaire, la réserve), puis ses poches, puis le détail.
 * Aucun mot de comptable : « ce qui reste », pas « résultat ».
 */
export function VueReleve({ releve }: { releve: Releve }) {
  const { contenu } = releve;
  const calculs = calculer(contenu);
  const { poches, objectifs } = contenu;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl capitalize">{libelleMois(releve.mois)}</h2>
          {!releve.publie ? <Badge variant="outline">Brouillon, pas encore visible</Badge> : null}
        </div>
        {contenu.resume ? (
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">{contenu.resume}</p>
        ) : null}
      </section>

      <section aria-labelledby="bref" className="space-y-3">
        <h3 id="bref" className="text-base">
          Ton mois en bref
        </h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Chiffre libelle="Ce qui est entré" valeur={eur(calculs.entrees)} />
          <Chiffre libelle="Ce que ton entreprise a coûté" valeur={eur(calculs.charges)} />
          <Chiffre
            libelle={`Mis de côté pour les impôts (${contenu.tauxImpots} %)`}
            valeur={eur(calculs.impots)}
          />
          <Chiffre libelle="Ton salaire" valeur={eur(calculs.salaire)} accent />
        </div>
      </section>

      <section aria-labelledby="circuit">
        <Card>
          <CardHeader>
            <CardTitle id="circuit">Le chemin de ton argent</CardTitle>
            <CardDescription>
              Ce qui entre paie d&apos;abord l&apos;entreprise. Une part va aux impôts, ton salaire part, et le
              reste va dans ta réserve.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-line divide-y text-sm">
              <Etape libelle="Ce qui est entré" valeur={eur(calculs.entrees)} />
              <Etape libelle="Ce que ton entreprise a coûté" valeur={`− ${eur(calculs.charges)}`} />
              <Etape libelle="Ce qui reste" valeur={eur(calculs.resultat)} total />
              <Etape
                libelle={`${contenu.tauxImpots} % mis de côté pour les impôts`}
                valeur={`− ${eur(calculs.impots)}`}
              />
              <Etape libelle="Ton salaire" valeur={`− ${eur(calculs.salaire)}`} />
              <Etape
                libelle={calculs.versReserve >= 0 ? "Pour ta réserve" : "Pris sur ta réserve"}
                valeur={eurSigne(calculs.versReserve)}
                total
                ton={calculs.versReserve >= 0 ? "success" : "warning"}
              />
            </ol>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="poches" className="space-y-3">
        <div className="space-y-1">
          <h3 id="poches" className="text-base">
            Tes poches
          </h3>
          <p className="text-muted-foreground text-sm">
            Sur le compte de ton entreprise, rangées à part. Leur solde à la fin du mois.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Poche
            nom="Impôts"
            valeur={poches.impotsCentimes}
            explication="On n'y touche jamais. Si le fiscaliste dit que c'est trop, le surplus va dans ta réserve."
          />
          <Poche
            nom="Bloqué"
            valeur={poches.bloqueCentimes}
            explication="L'argent déjà là, en attendant que le fiscaliste regarde les années passées."
          />
          <Poche
            nom="Fonds de roulement"
            valeur={poches.fondsRoulementCentimes}
            explication="Il paie le début du mois. L'argent des clientes le remplit ensuite."
          />
          <Poche
            nom="Réserve"
            valeur={poches.reserveCentimes}
            explication="L'argent des coups durs. Jamais pour la pub, jamais pour les vacances."
            palier={objectifs.palierReserveCentimes}
            objectif={objectifs.objectifReserveCentimes}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <TableLignes titre="Ce qui est entré" lignes={contenu.entrees} total={calculs.entrees} />
        <TableLignes
          titre="Ce que ton entreprise a coûté"
          lignes={contenu.charges}
          total={calculs.charges}
        />
      </div>

      {contenu.vie.length > 0 ? (
        <TableVie lignes={contenu.vie} depense={calculs.vieDepense} budget={calculs.vieBudget} />
      ) : null}

      {contenu.aVenir.length > 0 ? (
        <TableLignes
          titre="Ce qui va arriver"
          description="Les mensualités de tes clientes qui restent à payer, mois par mois. Tes nouvelles ventes viendront en plus."
          lignes={contenu.aVenir}
          total={contenu.aVenir.reduce((total, ligne) => total + ligne.centimes, 0)}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {contenu.ecarts.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert aria-hidden="true" className="text-warning size-4" />
                L&apos;écart du mois
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {contenu.ecarts.map((ecart) => (
                  <li key={ecart} className="leading-relaxed">
                    {ecart}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {contenu.notion.titre ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb aria-hidden="true" className="text-ember size-4" />
                {contenu.notion.titre}
              </CardTitle>
              <CardDescription>La notion du mois</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed whitespace-pre-line">{contenu.notion.texte}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Chiffre({ libelle, valeur, accent = false }: { libelle: string; valeur: string; accent?: boolean }) {
  return (
    <div className="border-line bg-surface-1 rounded-lg border p-4">
      <p className="text-muted-foreground text-xs leading-snug">{libelle}</p>
      <p className={cn("font-display mt-2 text-xl font-semibold tabular-nums", accent && "text-ember")}>
        {valeur}
      </p>
    </div>
  );
}

function Etape({
  libelle,
  valeur,
  total = false,
  ton,
}: {
  libelle: string;
  valeur: string;
  total?: boolean;
  ton?: "success" | "warning";
}) {
  return (
    <li className={cn("flex items-baseline justify-between gap-4 py-2.5", total && "font-medium")}>
      <span className={cn(!total && "text-muted-foreground")}>{libelle}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          ton === "success" && "text-success",
          ton === "warning" && "text-warning",
        )}
      >
        {valeur}
      </span>
    </li>
  );
}

function Poche({
  nom,
  valeur,
  explication,
  palier,
  objectif,
}: {
  nom: string;
  valeur: number;
  explication: string;
  palier?: number;
  objectif?: number;
}) {
  const avecObjectif = Boolean(objectif && objectif > 0);

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardDescription>{nom}</CardDescription>
        <CardTitle className="font-display text-2xl tabular-nums">{eur(valeur)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm leading-relaxed">{explication}</p>
        {avecObjectif ? (
          <div className="space-y-2">
            {palier && palier > 0 ? (
              <Avancement libelle={`Première étape : ${eur(palier)}`} pourcentage={avancement(valeur, palier)} />
            ) : null}
            <Avancement libelle={`Objectif : ${eur(objectif ?? 0)}`} pourcentage={avancement(valeur, objectif ?? 0)} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Avancement({ libelle, pourcentage }: { libelle: string; pourcentage: number }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground flex justify-between text-xs">
        <span>{libelle}</span>
        <span className="font-mono">{pourcentage} %</span>
      </div>
      <Progress value={pourcentage} aria-label={libelle} />
    </div>
  );
}

function TableLignes({
  titre,
  description,
  lignes,
  total,
}: {
  titre: string;
  description?: string;
  lignes: Ligne[];
  total: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titre}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quoi</TableHead>
              <TableHead className="text-right">Montant</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lignes.map((ligne, index) => (
              <TableRow key={`${ligne.libelle}-${index}`}>
                <TableCell className="whitespace-normal">{ligne.libelle}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{eur(ligne.centimes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{eur(total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

function TableVie({ lignes, depense, budget }: { lignes: Ligne[]; depense: number; budget: number | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ta vie ce mois-ci</CardTitle>
        <CardDescription>Ce que tu as dépensé, poste par poste, face à ton budget.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Poste</TableHead>
              <TableHead className="text-right">Dépensé</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Écart</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lignes.map((ligne, index) => {
              const ecart = ligne.budgetCentimes !== null ? ligne.budgetCentimes - ligne.centimes : null;
              return (
                <TableRow key={`${ligne.libelle}-${index}`}>
                  <TableCell className="whitespace-normal">{ligne.libelle}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{eur(ligne.centimes)}</TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono tabular-nums">
                    {ligne.budgetCentimes !== null ? eur(ligne.budgetCentimes) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Ecart ecart={ecart} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{eur(depense)}</TableCell>
              <TableCell className="text-muted-foreground text-right font-mono tabular-nums">
                {budget !== null ? eur(budget) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Ecart ecart={budget !== null ? budget - depense : null} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

function Ecart({ ecart }: { ecart: number | null }) {
  if (ecart === null) return <span className="text-muted-foreground">—</span>;
  if (ecart === 0) return <span className="text-muted-foreground font-mono">pile</span>;

  const dessous = ecart > 0;
  const Icone = dessous ? ArrowDownRight : ArrowUpRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono tabular-nums",
        dessous ? "text-success" : "text-warning",
      )}
    >
      <Icone aria-hidden="true" className="size-3.5" />
      {eur(Math.abs(ecart))}
    </span>
  );
}
