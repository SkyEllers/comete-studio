"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { formatDuree } from "./duree";
import {
  DEFAUT_MANUEL,
  LIMITE_NOTE,
  MAXIMUM_MANUEL,
  MINIMUM_MINUTES,
  PAS_MINUTES,
  TACHES,
  type ClientPulsar,
  type Tache,
} from "./types";

/**
 * Le formulaire d'une entrée, partagé par la saisie manuelle et la correction.
 *
 * Les deux posent exactement les mêmes questions — client, type, durée, note —
 * à un champ près : la date, que la saisie demande et que la correction ne
 * touche pas. Les séparer aurait fait deux formulaires à maintenir et deux
 * façons de compter un quart d'heure.
 *
 * La durée se règle au pas de quinze minutes, par deux boutons plutôt qu'un
 * champ : c'est la contrainte de la base, et un pouce vise mieux un bouton
 * qu'un clavier numérique.
 */

export type Valeurs = {
  clientId: string;
  task: Tache;
  minutes: number;
  jour: string;
  note: string;
};

export function valeursParDefaut(clientId: string, jour: string): Valeurs {
  return { clientId, task: "site", minutes: DEFAUT_MANUEL, jour, note: "" };
}

export function FormulaireEntree({
  clients,
  initiales,
  avecDate,
  maxJour,
  pending,
  libelleAction,
  onValider,
  onAnnuler,
}: {
  clients: ClientPulsar[];
  initiales: Valeurs;
  /** La saisie manuelle choisit sa date ; la correction garde la sienne. */
  avecDate: boolean;
  /** Aujourd'hui, à Paris : on ne compte pas des heures à l'avance. */
  maxJour: string;
  pending: boolean;
  libelleAction: string;
  onValider: (valeurs: Valeurs) => void;
  onAnnuler: () => void;
}) {
  const [valeurs, setValeurs] = useState<Valeurs>(initiales);

  const champ = <C extends keyof Valeurs>(cle: C, valeur: Valeurs[C]) =>
    setValeurs((precedent) => ({ ...precedent, [cle]: valeur }));

  const bouger = (pas: number) =>
    champ(
      "minutes",
      Math.min(MAXIMUM_MANUEL, Math.max(MINIMUM_MINUTES, valeurs.minutes + pas)),
    );

  return (
    <form
      onSubmit={(evenement) => {
        evenement.preventDefault();
        onValider(valeurs);
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="pulsar-client">Client</Label>
        <select
          id="pulsar-client"
          value={valeurs.clientId}
          onChange={(evenement) => champ("clientId", evenement.target.value)}
          className="border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3"
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium">Type de tâche</legend>
        <div className="flex flex-wrap gap-1.5">
          {TACHES.map((tache) => (
            <Puce
              key={tache.valeur}
              label={tache.label}
              actif={valeurs.task === tache.valeur}
              onClick={() => champ("task", tache.valeur)}
            />
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="pulsar-duree">Durée</Label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Un quart d'heure de moins"
            disabled={valeurs.minutes <= MINIMUM_MINUTES}
            onClick={() => bouger(-PAS_MINUTES)}
          >
            <Minus aria-hidden="true" />
          </Button>

          <output
            id="pulsar-duree"
            aria-live="polite"
            className="border-line bg-surface-2 flex h-8 min-w-24 items-center justify-center rounded-lg border font-mono text-sm tabular-nums"
          >
            {formatDuree(valeurs.minutes)}
          </output>

          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Un quart d'heure de plus"
            disabled={valeurs.minutes >= MAXIMUM_MANUEL}
            onClick={() => bouger(PAS_MINUTES)}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>

      {avecDate ? (
        <div className="space-y-1.5">
          <Label htmlFor="pulsar-jour">Jour</Label>
          <Input
            id="pulsar-jour"
            type="date"
            value={valeurs.jour}
            max={maxJour}
            onChange={(evenement) => champ("jour", evenement.target.value)}
            className="w-auto"
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="pulsar-note">Note</Label>
        <Input
          id="pulsar-note"
          value={valeurs.note}
          maxLength={LIMITE_NOTE}
          placeholder="Facultatif"
          onChange={(evenement) => champ("note", evenement.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onAnnuler} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Un instant…" : libelleAction}
        </Button>
      </div>
    </form>
  );
}

/**
 * Une puce sélectionnable.
 *
 * L'ember ne sert qu'à l'état actif, comme partout dans le hub — ici il dit
 * « c'est ça que tu vas compter », et rien d'autre ne le porte.
 */
export function Puce({
  label,
  actif,
  onClick,
  disabled,
  className,
}: {
  label: string;
  actif: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={actif}
      className={cn(
        "focus-visible:ring-ring rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
        actif
          ? "border-ember bg-ember text-void font-medium"
          : "border-line bg-surface-1 hover:bg-surface-2",
        className,
      )}
    >
      {label}
    </button>
  );
}
