"use client";

import { BadgeEuro, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  AUTRE_MONTANT,
  choixDUneVente,
  choixParCle,
  cleDeChoix,
  type ChoixVente,
} from "@/tools/devis/offre-vente-choix";

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

/**
 * `choix` : la clé de l'offre choisie (« 12:une_fois »), ou « autre » pour un
 * montant tapé. Absent dans un espace sans modèle de devis : le montant tapé
 * fait foi, comme avant.
 */
export type Vente = { montant: string; date: string; note: string; choix?: string };

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
      {rdv.sale_note ? <span className="text-muted-foreground"> · {rdv.sale_note}</span> : null}
    </p>
  );
}

export function FormulaireVente({
  rdv,
  offre = null,
  enCours,
  onEnregistrer,
  onAnnuler,
}: {
  rdv: RendezVous;
  /**
   * L'offre du devis de l'espace (Louis, 08/10/2026 : « la même offre
   * partout ») : on choisit ce qu'elle prend et comment elle paie, le montant
   * se calcule, et le serveur le recalcule. Null : un espace sans modèle de
   * devis, montant libre comme avant.
   */
  offre?: ChoixVente[] | null;
  enCours: boolean;
  onEnregistrer: (vente: Vente) => void;
  onAnnuler: () => void;
}) {
  // Une vente déjà notée rouvre sur son choix ; un montant que l'offre ne
  // donne pas rouvre sur « Autre montant ».
  const choixDeDepart =
    offre && offre.length > 0
      ? rdv.sale_amount_cents !== null
        ? (choixDUneVente(offre, { montantCents: rdv.sale_amount_cents, fois: rdv.sale_fois })
            ?.cle ?? AUTRE_MONTANT)
        : offre[0].cle
      : undefined;

  const [vente, setVente] = useState<Vente>({
    montant:
      rdv.sale_amount_cents !== null
        ? String(rdv.sale_amount_cents / 100).replace(".", ",")
        : "",
    date: rdv.sale_date ?? aujourdhuiAParis(),
    // La note d'une vente de l'offre s'écrit seule (« 12 mois, en 1 fois ») :
    // on ne la redonne pas à réécrire.
    note: choixDeDepart && choixDeDepart !== AUTRE_MONTANT ? "" : (rdv.sale_note ?? ""),
    choix: choixDeDepart,
  });

  const champ = <C extends keyof Vente>(cle: C, valeur: Vente[C]) =>
    setVente((precedent) => ({ ...precedent, [cle]: valeur }));

  const choisi = offre && vente.choix ? choixParCle(offre, vente.choix) : null;
  const autre = choisi === null;
  // Les prises, dans l'ordre de l'offre, une fois chacune.
  const prises = offre ? [...new Map(offre.map((c) => [c.prise, c])).values()] : [];
  const paiementsDeLaPrise = offre && choisi ? offre.filter((c) => c.prise === choisi.prise) : [];

  return (
    <form
      onSubmit={(evenement) => {
        evenement.preventDefault();
        onEnregistrer(vente);
      }}
      className="border-line bg-surface-2 space-y-3 rounded-lg border p-3"
    >
      {offre ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`prise-${rdv.id}`}>Ce qu&apos;elle prend</Label>
            <select
              id={`prise-${rdv.id}`}
              className="border-input bg-input/30 h-9 w-full rounded-lg border px-2.5 text-sm"
              value={choisi ? String(choisi.prise) : AUTRE_MONTANT}
              onChange={(evenement) => {
                const valeur = evenement.target.value;
                if (valeur === AUTRE_MONTANT) {
                  champ("choix", AUTRE_MONTANT);
                  return;
                }
                const prise = Number(valeur);
                // On garde le paiement déjà choisi quand la prise le permet.
                const garde = choisi ? choixParCle(offre, cleDeChoix(prise, choisi.paiement)) : null;
                champ("choix", (garde ?? offre.find((c) => c.prise === prise))?.cle);
              }}
            >
              {prises.map((c) => (
                <option key={c.prise} value={String(c.prise)}>
                  {c.libellePrise}
                </option>
              ))}
              <option value={AUTRE_MONTANT}>Autre montant</option>
            </select>
          </div>

          {choisi && paiementsDeLaPrise.length > 1 ? (
            <fieldset>
              <legend className="mb-1.5 text-sm">Paiement</legend>
              <div className="flex gap-2">
                {paiementsDeLaPrise.map((c) => (
                  <button
                    key={c.cle}
                    type="button"
                    onClick={() => champ("choix", c.cle)}
                    className={cn(
                      "border-line h-9 flex-1 rounded-md border px-2 text-sm",
                      c.cle === choisi.cle && "border-ember bg-ember/10",
                    )}
                    aria-pressed={c.cle === choisi.cle}
                  >
                    {c.paiement === "une_fois" ? "En 1 fois" : `En ${c.fois} fois`}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {choisi ? (
        <p className="text-sm">
          <span className="font-medium">{montant(choisi.montantCents, rdv.currency)}</span>{" "}
          <span className="text-muted-foreground">
            {choisi.fois > 1 && choisi.premierCents !== null
              ? choisi.premierCents * choisi.fois === choisi.montantCents
                ? `: ${choisi.fois} × ${montant(choisi.premierCents, rdv.currency)}`
                : `: ${montant(choisi.premierCents, rdv.currency)}, puis ${choisi.fois - 1} × ${montant(
                    (choisi.montantCents - choisi.premierCents) / (choisi.fois - 1),
                    rdv.currency,
                  )} par mois`
              : "en 1 fois"}
          </span>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {autre ? (
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
        ) : null}

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
        <Label htmlFor={`note-${rdv.id}`}>
          {autre ? "Note (facultative)" : "Une précision (facultative)"}
        </Label>
        <Input
          id={`note-${rdv.id}`}
          name="note"
          placeholder={autre ? (offre ? "ce qu'elle a pris" : "pack 5 séances") : ""}
          maxLength={autre ? 200 : 120}
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
