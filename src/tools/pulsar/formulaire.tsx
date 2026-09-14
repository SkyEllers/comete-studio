"use client";

import { Minus, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { formatDuree } from "./duree";
import {
  avecDebut,
  avecDuree,
  avecFin,
  avecFinTapee,
  cran,
  ecrireHeure,
  horaireDe,
  lireHeure,
  plafondDeCourse,
  resoudreCorrection,
  type Correction,
  type Plage,
} from "./horaire";
import {
  DEFAUT_MANUEL,
  LIMITE_NOTE,
  MAXIMUM_MANUEL,
  MINIMUM_MINUTES,
  PAS_MINUTES,
  TACHES,
  type ClientPulsar,
  type Entree,
  type Tache,
} from "./types";

/**
 * Le formulaire d'une entrée, pour les trois gestes qui en écrivent une.
 *
 * - **La saisie** d'une heure oubliée : client, type, durée, jour, note. Pas
 *   d'horaire — elle se pose à midi et s'affiche « Saisie ».
 * - **La correction** d'une entrée terminée : tout, y compris le début, la fin
 *   et la durée, et le jour — c'est celle qu'on reprend depuis Par client.
 * - **La correction** d'un chronomètre en marche : son début, et au besoin son
 *   arrêt à la durée qu'il aurait dû compter.
 *
 * Début, fin et durée sont liés, comme dans un agenda : le début bouge et la
 * fin reste, la fin bouge et le début reste, la durée bouge et la fin suit.
 * La durée est toujours un quart d'heure plein. Les règles sont celles de
 * `horaire.ts`, que l'action applique aussi : ce qui cloche se dit sous le
 * formulaire avant l'envoi, pas en toast après.
 *
 * Chaque valeur se règle par pas de quinze minutes, par deux boutons plutôt
 * qu'un champ : c'est la contrainte de la base, et un pouce vise mieux un
 * bouton qu'un clavier numérique. Les heures se tapent aussi — reculer de cinq
 * heures en vingt appuis n'est pas une correction, c'est une punition.
 */

export type Valeurs = {
  clientId: string;
  task: Tache;
  jour: string;
  note: string;
  /** Minutes depuis le minuit de `jour`, à Paris. La fin dépasse 1 440 le lendemain. */
  debut: number;
  fin: number;
  /** La durée comptée : un quart d'heure plein, au moins. */
  minutes: number;
  /** Chronomètre en marche seulement : vrai quand la correction l'arrête. */
  arrete: boolean;
};

/** Un chronomètre qu'on laisse tourner n'envoie ni fin ni durée. */
export function versCorrection(valeurs: Valeurs, enCours: boolean): Correction {
  const tourne = enCours && !valeurs.arrete;

  return {
    jour: valeurs.jour,
    debut: valeurs.debut,
    fin: tourne ? null : valeurs.fin,
    minutes: tourne ? null : valeurs.minutes,
  };
}

function valeursInitiales(
  clients: ClientPulsar[],
  entree: Entree | undefined,
  jour: string,
): Valeurs {
  if (!entree) {
    return {
      clientId: clients[0]?.id ?? "",
      task: "site",
      jour,
      note: "",
      debut: 12 * 60,
      fin: 12 * 60 + DEFAUT_MANUEL,
      minutes: DEFAUT_MANUEL,
      arrete: false,
    };
  }

  const horaire = horaireDe(entree);
  const minutes = entree.duration_minutes ?? MINIMUM_MINUTES;

  return {
    clientId: entree.client_id,
    task: entree.task,
    jour: horaire.jour,
    note: entree.note ?? "",
    debut: horaire.debut,
    fin: horaire.fin ?? horaire.debut + minutes,
    minutes,
    arrete: false,
  };
}

export function FormulaireEntree({
  clients,
  entree,
  maxJour,
  pending,
  onValider,
  onAnnuler,
}: {
  clients: ClientPulsar[];
  /** Absente pour une saisie ; terminée ou en marche pour une correction. */
  entree?: Entree;
  /** Aujourd'hui, à Paris : on ne compte pas des heures à l'avance. */
  maxJour: string;
  pending: boolean;
  onValider: (valeurs: Valeurs) => void;
  onAnnuler: () => void;
}) {
  /*
   * Les archivés ne sont pas proposés — sauf le client de l'entrée elle-même :
   * une heure de juin se corrige en septembre même si le dossier est fermé, et
   * un menu qui ne contiendrait pas sa propre valeur la changerait en silence.
   */
  const proposes = clients.filter(
    (client) => client.statut !== "termine" || client.id === entree?.client_id,
  );

  const [valeurs, setValeurs] = useState(() =>
    valeursInitiales(proposes, entree, maxJour),
  );

  /*
   * L'heure qu'il est, relue à chaque geste plutôt qu'à chaque rendu : un
   * chronomètre en marche peut compter un peu plus à chaque minute qui passe,
   * et « ce début tombe dans le futur » cesse d'être vrai tout seul.
   */
  const [maintenant, setMaintenant] = useState(() => Date.now());

  const mode = !entree ? "saisie" : entree.ended_at === null ? "course" : "correction";
  const avecFinEtDuree = mode === "correction" || (mode === "course" && valeurs.arrete);

  const changer = (partiel: Partial<Valeurs>) => {
    setMaintenant(Date.now());
    setValeurs((precedent) => ({ ...precedent, ...partiel }));
  };

  const plage: Plage = { debut: valeurs.debut, fin: valeurs.fin, minutes: valeurs.minutes };

  const limite =
    mode === "course" && entree
      ? plafondDeCourse(entree, valeurs.jour, valeurs.debut, maintenant)
      : MAXIMUM_MANUEL;

  const basculerArret = (arrete: boolean) => {
    if (!arrete || !entree) return changer({ arrete: false });

    // Par défaut, ce qu'un arrêt maintenant compterait : on part de là, et on
    // descend jusqu'à ce qu'il aurait dû compter.
    const instant = Date.now();
    const tourne = plafondDeCourse(entree, valeurs.jour, valeurs.debut, instant);
    setMaintenant(instant);
    setValeurs((precedent) => ({ ...precedent, arrete: true, ...avecDuree(plage, tourne) }));
  };

  const resolution = entree
    ? resoudreCorrection(entree, versCorrection(valeurs, mode === "course"), maintenant)
    : null;
  const defaut = resolution && !resolution.ok ? resolution.error : null;

  const saisieSansHeure =
    entree?.is_manual === true && valeurs.debut === horaireDe(entree).debut;

  const libelleAction =
    mode === "saisie"
      ? "Ajouter"
      : mode === "course" && valeurs.arrete
        ? `Arrêter · ${formatDuree(valeurs.minutes)}`
        : "Enregistrer";

  const champJour = (
    <Rangee id="pulsar-jour" label="Jour">
      <Input
        id="pulsar-jour"
        type="date"
        value={valeurs.jour}
        max={maxJour}
        onChange={(evenement) => changer({ jour: evenement.target.value })}
        className="w-auto"
      />
    </Rangee>
  );

  const champDuree = (
    <Rangee id="pulsar-duree" label="Durée">
      <Pas
        sens={-1}
        libelle="Un quart d'heure de moins"
        disabled={valeurs.minutes - PAS_MINUTES < MINIMUM_MINUTES}
        onClick={() => changer(avecDuree(plage, valeurs.minutes - PAS_MINUTES))}
      />
      <output
        id="pulsar-duree"
        aria-live="polite"
        className="border-line bg-surface-2 flex h-8 w-28 items-center justify-center rounded-lg border font-mono text-sm tabular-nums"
      >
        {formatDuree(valeurs.minutes)}
      </output>
      <Pas
        sens={1}
        libelle="Un quart d'heure de plus"
        disabled={valeurs.minutes + PAS_MINUTES > limite}
        onClick={() => changer(avecDuree(plage, valeurs.minutes + PAS_MINUTES))}
      />
    </Rangee>
  );

  return (
    <form
      noValidate
      onSubmit={(evenement) => {
        evenement.preventDefault();
        if (!defaut) onValider(valeurs);
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="pulsar-client">Client</Label>
        <select
          id="pulsar-client"
          value={valeurs.clientId}
          onChange={(evenement) => changer({ clientId: evenement.target.value })}
          className="border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3"
        >
          {proposes.map((client) => (
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
              onClick={() => changer({ task: tache.valeur })}
            />
          ))}
        </div>
      </fieldset>

      {mode === "saisie" ? (
        <div className="space-y-3">
          {champDuree}
          {champJour}
        </div>
      ) : (
        <div className="space-y-3">
          {champJour}

          <Rangee id="pulsar-debut" label="Début">
            <Pas
              sens={-1}
              libelle="Commencer un quart d'heure plus tôt"
              disabled={cran(valeurs.debut, -1) < 0}
              onClick={() => changer(avecDebut(plage, cran(valeurs.debut, -1)))}
            />
            <ChampHeure
              id="pulsar-debut"
              valeur={valeurs.debut}
              onChange={(heure) => changer(avecDebut(plage, heure))}
            />
            <Pas
              sens={1}
              libelle="Commencer un quart d'heure plus tard"
              disabled={cran(valeurs.debut, 1) > 24 * 60 - 1}
              onClick={() => changer(avecDebut(plage, cran(valeurs.debut, 1)))}
            />
          </Rangee>

          {saisieSansHeure ? (
            <p className="text-muted-foreground text-xs">
              Saisie sans heure, posée à midi : donne-lui son vrai début si tu le
              connais.
            </p>
          ) : null}

          {mode === "course" ? (
            <fieldset className="grid grid-cols-[4rem_1fr] items-center gap-x-3">
              <legend className="sr-only">Arrêt</legend>
              <span aria-hidden="true" className="text-sm font-medium">
                Arrêt
              </span>
              <div className="flex flex-wrap gap-1.5">
                <Puce
                  label="Il tourne encore"
                  actif={!valeurs.arrete}
                  onClick={() => basculerArret(false)}
                />
                <Puce
                  label="Arrêter à une durée"
                  actif={valeurs.arrete}
                  onClick={() => basculerArret(true)}
                />
              </div>
            </fieldset>
          ) : null}

          {avecFinEtDuree ? (
            <>
              <Rangee id="pulsar-fin" label="Fin">
                <Pas
                  sens={-1}
                  libelle="Finir un quart d'heure plus tôt"
                  disabled={cran(valeurs.fin, -1) <= valeurs.debut}
                  onClick={() => changer(avecFin(plage, cran(valeurs.fin, -1)))}
                />
                <ChampHeure
                  id="pulsar-fin"
                  valeur={valeurs.fin}
                  onChange={(heure) => changer(avecFinTapee(plage, heure))}
                />
                <Pas
                  sens={1}
                  libelle="Finir un quart d'heure plus tard"
                  disabled={avecFin(plage, cran(valeurs.fin, 1)).minutes > limite}
                  onClick={() => changer(avecFin(plage, cran(valeurs.fin, 1)))}
                />
                {valeurs.fin >= 24 * 60 ? (
                  <span className="text-muted-foreground text-xs">le lendemain</span>
                ) : null}
              </Rangee>

              {champDuree}
            </>
          ) : null}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="pulsar-note">Note</Label>
        <Input
          id="pulsar-note"
          value={valeurs.note}
          maxLength={LIMITE_NOTE}
          placeholder="Facultatif"
          onChange={(evenement) => changer({ note: evenement.target.value })}
        />
      </div>

      {defaut ? (
        <p role="alert" className="text-destructive text-sm">
          {defaut}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onAnnuler} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending || defaut !== null}>
          {pending ? "Un instant…" : libelleAction}
        </Button>
      </div>
    </form>
  );
}

/** Une ligne réglable : son libellé à gauche, ses boutons et sa valeur à droite. */
function Rangee({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4rem_1fr] items-center gap-x-3">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Pas({
  sens,
  libelle,
  disabled,
  onClick,
}: {
  sens: 1 | -1;
  libelle: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={libelle}
      disabled={disabled}
      onClick={onClick}
    >
      {sens === 1 ? <Plus aria-hidden="true" /> : <Minus aria-hidden="true" />}
    </Button>
  );
}

/**
 * Une heure qui se tape.
 *
 * Un champ vidé ne vaut rien et n'efface rien : l'heure d'avant reste, et le
 * champ se remplit à nouveau. Une entrée sans début n'existe pas.
 */
function ChampHeure({
  id,
  valeur,
  onChange,
}: {
  id: string;
  valeur: number;
  onChange: (heure: number) => void;
}) {
  return (
    <Input
      id={id}
      type="time"
      step={PAS_MINUTES * 60}
      value={ecrireHeure(valeur)}
      onChange={(evenement) => {
        const heure = lireHeure(evenement.target.value);
        if (heure !== null) onChange(heure);
      }}
      className="w-28 text-center font-mono tabular-nums"
    />
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
