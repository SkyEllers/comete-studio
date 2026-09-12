"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { Puce } from "./formulaire";
import {
  MODELES,
  PROFILS,
  STATUTS,
  type FicheClient,
  type Modele,
  type Profil,
  type Statut,
} from "./types";

/**
 * La fiche d'un client : ce qu'on a vendu, à qui, et depuis quand.
 *
 * C'est le seul endroit où l'encaissé se déclare. Il n'est jamais saisi au fil
 * de l'eau — pas de « j'ai reçu 550 € en mars » — et c'est ce qui permet de
 * lire n'importe quel mois passé sans l'avoir préparé : les chiffres se
 * déduisent de ces six champs, pour toujours.
 *
 * Les règles du brief sont dites par le formulaire autant que par l'action :
 * le montant se grise quand il ne compte pas, l'aide du modèle explique
 * pourquoi, et les dates obligatoires sont demandées avant l'envoi plutôt que
 * refusées après. Refuser après coup ce qu'on a laissé remplir est une
 * mauvaise façon de dire une règle.
 */

export type ValeursFiche = {
  id?: string;
  name: string;
  profil: Profil | "";
  modele: Modele;
  montantEuros: number;
  dateDebut: string;
  finEngagement: string;
  statut: Statut;
};

export function valeursDeLaFiche(client?: FicheClient): ValeursFiche {
  if (!client) {
    return {
      name: "",
      profil: "",
      modele: "recurrent",
      montantEuros: 0,
      dateDebut: "",
      finEngagement: "",
      statut: "setup",
    };
  }

  return {
    id: client.id,
    name: client.name,
    profil: client.profil ?? "",
    modele: client.modele,
    montantEuros: Math.round(client.montant_cents / 100),
    dateDebut: client.date_debut ?? "",
    finEngagement: client.fin_engagement ?? "",
    statut: client.statut,
  };
}

/** Ce qui part à l'action : les champs vides deviennent des `null`. */
export function envoiDeLaFiche(valeurs: ValeursFiche) {
  return {
    id: valeurs.id,
    name: valeurs.name,
    profil: valeurs.profil === "" ? null : valeurs.profil,
    modele: valeurs.modele,
    montantEuros: valeurs.montantEuros,
    dateDebut: valeurs.dateDebut === "" ? null : valeurs.dateDebut,
    finEngagement: valeurs.finEngagement === "" ? null : valeurs.finEngagement,
    statut: valeurs.statut,
  };
}

const CHAMP =
  "border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3";

export function FormulaireFiche({
  initiales,
  pending,
  libelleAction,
  onValider,
  onAnnuler,
}: {
  initiales: ValeursFiche;
  pending: boolean;
  libelleAction: string;
  onValider: (valeurs: ValeursFiche) => void;
  onAnnuler: () => void;
}) {
  const [valeurs, setValeurs] = useState<ValeursFiche>(initiales);

  const champ = <C extends keyof ValeursFiche>(cle: C, valeur: ValeursFiche[C]) =>
    setValeurs((precedent) => ({ ...precedent, [cle]: valeur }));

  const modele = MODELES.find((m) => m.valeur === valeurs.modele);
  const facture = valeurs.modele === "recurrent" || valeurs.modele === "one_shot";

  return (
    <form
      onSubmit={(evenement) => {
        evenement.preventDefault();
        onValider(valeurs);
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="fiche-nom">Nom</Label>
        <Input
          id="fiche-nom"
          value={valeurs.name}
          maxLength={60}
          required
          autoFocus
          onChange={(evenement) => champ("name", evenement.target.value)}
        />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium">Modèle</legend>
        <div className="flex flex-wrap gap-1.5">
          {MODELES.map((candidat) => (
            <Puce
              key={candidat.valeur}
              label={candidat.label}
              actif={valeurs.modele === candidat.valeur}
              onClick={() => champ("modele", candidat.valeur)}
            />
          ))}
        </div>
        <p className="text-muted-foreground pt-1 text-xs">{modele?.aide}</p>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="fiche-montant">
          Montant {facture ? "en euros" : "— sans effet sur ce modèle"}
        </Label>
        <Input
          id="fiche-montant"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          disabled={!facture}
          value={facture ? valeurs.montantEuros : 0}
          onChange={(evenement) =>
            champ("montantEuros", Math.max(0, Math.round(Number(evenement.target.value))))
          }
          className="w-40"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fiche-debut">Début</Label>
          <Input
            id="fiche-debut"
            type="date"
            value={valeurs.dateDebut}
            onChange={(evenement) => champ("dateDebut", evenement.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fiche-fin">Fin d&apos;engagement</Label>
          <Input
            id="fiche-fin"
            type="date"
            min={valeurs.dateDebut || undefined}
            value={valeurs.finEngagement}
            onChange={(evenement) => champ("finEngagement", evenement.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-medium">Statut</legend>
          <div className="flex flex-wrap gap-1.5">
            {STATUTS.map((candidat) => (
              <Puce
                key={candidat.valeur}
                label={candidat.label}
                actif={valeurs.statut === candidat.valeur}
                onClick={() => champ("statut", candidat.valeur)}
              />
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="fiche-profil">Profil</Label>
          <select
            id="fiche-profil"
            value={valeurs.profil}
            onChange={(evenement) => champ("profil", evenement.target.value as Profil | "")}
            className={CHAMP}
          >
            <option value="">Non renseigné</option>
            {PROFILS.map((candidat) => (
              <option key={candidat.valeur} value={candidat.valeur}>
                {candidat.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {valeurs.statut === "termine" && valeurs.finEngagement === "" ? (
        <p className="text-muted-foreground text-xs">
          Sans date de fin, l&apos;archivage prendra celle d&apos;aujourd&apos;hui :
          c&apos;est elle qui arrête de compter les mois d&apos;un récurrent.
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onAnnuler} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending || valeurs.name.trim().length === 0}>
          {pending ? "Un instant…" : libelleAction}
        </Button>
      </div>
    </form>
  );
}
