"use client";

import { fr } from "date-fns/locale";
import { CalendarCheck2, CalendarClock, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  marquerRecontactee,
  noterNonVente,
} from "@/app/app/[orgSlug]/(tools)/resultats/actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { aujourdhuiAParis, jour, nomComplet } from "./format";
import { libelleMois, moisCourant } from "./mois";
import {
  LIBELLES_MOTIF,
  MOTIFS_REFUS,
  moisProposes,
  type Motif,
  type Raison,
} from "./non-vente";
import type { ARecontacter as ARecontacterDonnees } from "./queries";

/**
 * « Pas de vente » : pourquoi, et quand en reparler.
 *
 * Le formulaire sert à deux endroits, comme celui de la vente : le bloc « À
 * vérifier » du tableau de bord, et la fiche du rendez-vous. La raison se
 * choisit d'un doigt ; le mois n'est demandé que si la personne a dit quand.
 */

/** Le même geste depuis n'importe quel bloc : noter, dire que c'est noté, relire. */
export function useNonVente(orgSlug: string) {
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  const noterRaison = (
    bookingId: string,
    motif: Motif,
    recontacter: string | null,
    apres?: () => void,
  ) =>
    startTransition(async () => {
      const resultat = await noterNonVente(orgSlug, { bookingId, motif, recontacter });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      apres?.();
      router.refresh();
    });

  /** « En attente » : elle n'a pas encore répondu, et on la recontacte le jour dit. */
  const mettreEnAttente = (bookingId: string, recontacterLe: string, apres?: () => void) =>
    startTransition(async () => {
      const resultat = await noterNonVente(orgSlug, {
        bookingId,
        motif: "pas_encore",
        recontacterLe,
      });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      apres?.();
      router.refresh();
    });

  const recontactee = (bookingId: string) =>
    startTransition(async () => {
      const resultat = await marquerRecontactee(orgSlug, { bookingId });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      router.refresh();
    });

  return { enCoursNonVente: enCours, noterRaison, mettreEnAttente, recontactee };
}

const longue = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
/** « 2026-10-06 » → « mardi 6 octobre ». */
const dateLongue = (jourIso: string) => longue.format(new Date(`${jourIso}T00:00:00Z`));

/** « AAAA-MM-JJ » d'une date du calendrier, lue à l'heure locale de qui clique. */
function jourDuCalendrier(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Quand la recontacter : le jour exact s'il a été choisi, sinon le mois. */
function quandRecontacter(raison: Raison): string | null {
  if (raison.recontacterLe) return `le ${dateLongue(raison.recontacterLe)}`;
  return raison.recontacter ? `en ${libelleMois(raison.recontacter)}` : null;
}

/**
 * « Pas de vente · L'argent · à recontacter en novembre 2026 ».
 *
 * Sauf pour `pas_encore`, qui dirait « Pas de vente · Elle n'a pas encore
 * répondu » : deux affirmations qui se contredisent à l'œil. La séance est
 * bien sans vente pour le relevé, mais ce qu'on lit ici, c'est une attente.
 */
export function texteRaison(raison: Raison, fait = false): string {
  return [
    raison.motif === "pas_encore" ? "En attente de sa réponse" : "Pas de vente",
    raison.motif === "pas_encore" ? null : LIBELLES_MOTIF[raison.motif],
    quandRecontacter(raison) ? `à recontacter ${quandRecontacter(raison)}` : null,
    fait ? "recontactée" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function FormulaireNonVente({
  idBase,
  raison,
  enCours,
  onEnregistrer,
  onSansRaison,
  onAnnuler,
}: {
  idBase: string;
  raison: Raison | null;
  enCours: boolean;
  onEnregistrer: (motif: Motif, recontacter: string | null) => void;
  /** « Pas de vente » sans rien dire de plus : proposé tant qu'aucune raison n'est notée. */
  onSansRaison?: () => void;
  onAnnuler: () => void;
}) {
  const courant = moisCourant();
  // Une attente qu'on requalifie en refus repart sans motif : « En attente » a son bouton.
  const [motif, setMotif] = useState<Motif | null>(
    raison && raison.motif !== "pas_encore" ? raison.motif : null,
  );
  // Un mois déjà passé ne se propose plus : la base le refuserait.
  const [recontacter, setRecontacter] = useState<string>(
    raison?.recontacter && raison.recontacter >= courant ? raison.recontacter : "",
  );

  return (
    <form
      onSubmit={(evenement) => {
        evenement.preventDefault();
        if (motif) onEnregistrer(motif, recontacter || null);
      }}
      className="border-line bg-surface-2 space-y-3 rounded-lg border p-3"
    >
      <fieldset className="space-y-2">
        <legend className="text-muted-foreground text-xs">Pourquoi pas de vente ?</legend>
        <div className="flex flex-wrap gap-2">
          {MOTIFS_REFUS.map((cle) => (
            <Button
              key={cle}
              type="button"
              size="xs"
              variant={motif === cle ? "default" : "outline"}
              aria-pressed={motif === cle}
              disabled={enCours}
              onClick={() => setMotif(cle)}
            >
              {LIBELLES_MOTIF[cle]}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={`recontacter-${idBase}`}>À recontacter</Label>
        <select
          id={`recontacter-${idBase}`}
          value={recontacter}
          disabled={enCours}
          onChange={(evenement) => setRecontacter(evenement.target.value)}
          className="border-line bg-surface-1 focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-3 sm:w-auto"
        >
          <option value="">Pas de date</option>
          {moisProposes(courant).map((valeur) => (
            <option key={valeur} value={valeur}>
              {libelleMois(valeur)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={enCours || motif === null}>
          Enregistrer
        </Button>
        {onSansRaison ? (
          <Button type="button" variant="ghost" size="sm" disabled={enCours} onClick={onSansRaison}>
            Sans raison
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" disabled={enCours} onClick={onAnnuler}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

/**
 * « En attente » : elle n'a dit ni oui ni non, et on choisit au calendrier le
 * jour où la recontacter. Elle revient dans « À recontacter » ce jour-là.
 * La date est obligatoire : une attente sans date de relance, c'est une
 * réponse qu'on ne va plus chercher.
 */
export function FormulaireEnAttente({
  raison,
  enCours,
  onEnregistrer,
  onAnnuler,
}: {
  raison: Raison | null;
  enCours: boolean;
  onEnregistrer: (recontacterLe: string) => void;
  onAnnuler: () => void;
}) {
  const aujourdhui = aujourdhuiAParis();
  const [date, setDate] = useState<string>(
    raison?.motif === "pas_encore" && raison.recontacterLe && raison.recontacterLe >= aujourdhui
      ? raison.recontacterLe
      : "",
  );
  const [ouvert, setOuvert] = useState(false);
  const debut = new Date(`${aujourdhui}T00:00:00`);
  // Un an devant : la base accepte deux ans, un an suffit pour une réponse attendue.
  const fin = new Date(debut.getFullYear() + 1, debut.getMonth(), debut.getDate());

  return (
    <form
      onSubmit={(evenement) => {
        evenement.preventDefault();
        if (date) onEnregistrer(date);
      }}
      className="border-line bg-surface-2 space-y-3 rounded-lg border p-3"
    >
      <div className="space-y-1.5">
        <Label>Elle réfléchit. La recontacter le</Label>
        <Popover open={ouvert} onOpenChange={setOuvert}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start font-normal sm:w-auto"
              disabled={enCours}
            >
              <CalendarCheck2 aria-hidden="true" />
              {date ? dateLongue(date) : "Choisir une date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <Calendar
              mode="single"
              locale={fr}
              selected={date ? new Date(`${date}T00:00:00`) : undefined}
              defaultMonth={date ? new Date(`${date}T00:00:00`) : undefined}
              disabled={[{ before: debut }, { after: fin }]}
              onSelect={(choisi) => {
                setDate(choisi ? jourDuCalendrier(choisi) : "");
                setOuvert(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={enCours || !date}>
          Enregistrer
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={enCours} onClick={onAnnuler}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

/**
 * Le bloc « À recontacter » du tableau de bord.
 *
 * Les personnes venues sans acheter qui ont dit quand en reparler, une fois ce
 * mois arrivé. Le client les recontacte lui-même, à sa façon ; Radar ne fait
 * que s'en souvenir, et le nom complet est là pour qu'il sache de qui il
 * s'agit.
 */
export function ARecontacter({
  orgSlug,
  donnees,
}: {
  orgSlug: string;
  donnees: ARecontacterDonnees;
}) {
  const { enCoursNonVente, recontactee } = useNonVente(orgSlug);

  return (
    <div className="space-y-2">
      <ul className="border-line divide-line divide-y overflow-hidden rounded-lg border">
        {donnees.lignes.map(({ rdv, raison }) => {
          const nom = nomComplet(rdv.invitee_first_name, rdv.invitee_last_name);
          return (
            <li key={rdv.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1">
                <span
                  className={cn("block truncate text-sm font-medium", !nom && "text-muted-foreground")}
                >
                  {nom ?? rdv.invitee_display}
                </span>
                <span className="text-muted-foreground block text-xs">
                  Appel du {jour(rdv.scheduled_start)} ·{" "}
                  {raison.motif === "pas_encore"
                    ? "En attente de sa réponse"
                    : LIBELLES_MOTIF[raison.motif]}
                  {quandRecontacter(raison) ? ` · prévu ${quandRecontacter(raison)}` : ""}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={enCoursNonVente}
                onClick={() => recontactee(rdv.id)}
              >
                <Check aria-hidden="true" />
                C&apos;est fait
              </Button>
            </li>
          );
        })}
      </ul>
      {donnees.plusTard > 0 ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <CalendarClock aria-hidden="true" className="size-3" />
          {donnees.plusTard === 1
            ? "Une autre personne est prévue pour un mois à venir."
            : `${donnees.plusTard} autres personnes sont prévues pour les mois à venir.`}
        </p>
      ) : null}
    </div>
  );
}
