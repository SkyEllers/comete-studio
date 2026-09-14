"use client";

import { CalendarClock, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  marquerRecontactee,
  noterNonVente,
} from "@/app/app/[orgSlug]/(tools)/resultats/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { jour, nomComplet } from "./format";
import { libelleMois, moisCourant } from "./mois";
import {
  LIBELLES_MOTIF,
  MOTIFS,
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

  return { enCoursNonVente: enCours, noterRaison, recontactee };
}

/** « Pas de vente · L'argent · à recontacter en novembre 2026 ». */
export function texteRaison(raison: Raison, fait = false): string {
  return [
    "Pas de vente",
    LIBELLES_MOTIF[raison.motif],
    raison.recontacter ? `à recontacter en ${libelleMois(raison.recontacter)}` : null,
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
  const [motif, setMotif] = useState<Motif | null>(raison?.motif ?? null);
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
          {MOTIFS.map((cle) => (
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
                  Appel du {jour(rdv.scheduled_start)} · {LIBELLES_MOTIF[raison.motif]}
                  {raison.recontacter ? ` · prévu en ${libelleMois(raison.recontacter)}` : ""}
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
