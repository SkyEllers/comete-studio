"use client";

import { BadgeEuro, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { aujourdhuiAParis, dateDeVente, jourCalendaire, montant } from "./format";
import type { RendezVous } from "./queries";

/**
 * Déclarer une vente, la corriger, la retirer.
 *
 * Le formulaire vit ici plutôt que dans la fiche parce qu'il sert à deux
 * endroits : la fiche du rendez-vous, et le bloc « À vérifier » du tableau de
 * bord, où l'on répond à la question « et celle-là, elle a vendu ? » sans
 * changer de page.
 *
 * Les bornes de la date sont posées en attributs `min` et `max` : le
 * navigateur les fait respecter au doigt, sur le sélecteur natif, avant tout
 * aller-retour. Ce n'est pas une garantie — `radar_set_sale` les revérifie,
 * et c'est elle qui décide — c'est une politesse : refuser après coup une date
 * qu'on a laissé choisir est une mauvaise façon de dire une règle.
 */

export type Vente = { montant: string; date: string; note: string };

/** « Vente : 1 200 € le 3 septembre — pack 5 séances ». */
export function ResumeVente({
  rdv,
  className,
}: {
  rdv: RendezVous;
  className?: string;
}) {
  if (rdv.sale_amount_cents === null || rdv.sale_date === null) return null;

  return (
    <p className={className}>
      <BadgeEuro aria-hidden="true" className="mr-1.5 inline size-4 align-text-bottom" />
      <span className="font-medium">
        Vente : {montant(rdv.sale_amount_cents, rdv.currency)}
      </span>{" "}
      le {dateDeVente(rdv.sale_date)}
      {rdv.sale_note ? <span className="text-muted-foreground"> — {rdv.sale_note}</span> : null}
    </p>
  );
}

export function FormulaireVente({
  rdv,
  enCours,
  onEnregistrer,
  onAnnuler,
}: {
  rdv: RendezVous;
  enCours: boolean;
  onEnregistrer: (vente: Vente) => void;
  onAnnuler: () => void;
}) {
  const [vente, setVente] = useState<Vente>({
    montant:
      rdv.sale_amount_cents !== null
        ? String(rdv.sale_amount_cents / 100).replace(".", ",")
        : "",
    date: rdv.sale_date ?? aujourdhuiAParis(),
    note: rdv.sale_note ?? "",
  });

  const champ = <C extends keyof Vente>(cle: C, valeur: Vente[C]) =>
    setVente((precedent) => ({ ...precedent, [cle]: valeur }));

  return (
    <form
      onSubmit={(evenement) => {
        evenement.preventDefault();
        onEnregistrer(vente);
      }}
      className="border-line bg-surface-2 space-y-3 rounded-lg border p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`montant-${rdv.id}`}>Montant en euros</Label>
          <Input
            id={`montant-${rdv.id}`}
            name="montant"
            /* `inputMode` et non `type="number"` : un champ numérique refuse la
               virgule dans plusieurs navigateurs, et c'est ainsi qu'on écrit un
               montant en français. */
            inputMode="decimal"
            autoComplete="off"
            placeholder="1 200"
            required
            maxLength={20}
            value={vente.montant}
            onChange={(evenement) => champ("montant", evenement.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`date-${rdv.id}`}>Date de la vente</Label>
          <Input
            id={`date-${rdv.id}`}
            name="date"
            type="date"
            required
            min={jourCalendaire(rdv.scheduled_start)}
            max={aujourdhuiAParis()}
            value={vente.date}
            onChange={(evenement) => champ("date", evenement.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`note-${rdv.id}`}>Note (facultative)</Label>
        <Input
          id={`note-${rdv.id}`}
          name="note"
          placeholder="pack 5 séances"
          maxLength={200}
          value={vente.note}
          onChange={(evenement) => champ("note", evenement.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={enCours}>
          {rdv.has_sale ? "Enregistrer" : "Vente conclue"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={enCours} onClick={onAnnuler}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

/** Le bouton de retrait, séparé : il efface de l'argent, il ne se noie pas. */
export function RetirerVente({
  enCours,
  onRetirer,
}: {
  enCours: boolean;
  onRetirer: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" disabled={enCours} onClick={onRetirer}>
      <Trash2 aria-hidden="true" />
      Retirer la vente
    </Button>
  );
}
