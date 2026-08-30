"use client";

import { Check, FolderPlus, Pencil, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  LIMITE_IDEE,
  LIMITE_NOM_BOITE,
  type Boite,
  type Destination,
  type IdeeProposee,
} from "./types";

/**
 * L'écran où Louis dispose.
 *
 * Une carte par idée, et sur chacune tout ce qu'il faut pour la corriger sans
 * changer d'écran : le texte s'édite en place, la destination se choisit en un
 * geste, la croix retire l'idée. Rien n'est en base ; tout part d'un coup, en
 * bas, ou rien ne part.
 *
 * L'ambre n'est pas décorative : elle marque exactement les cartes où l'IA a
 * dit ne pas savoir, et la question est écrite en toutes lettres plutôt que
 * suggérée par une couleur. Une carte ambre qu'on ne touche pas s'enregistre
 * quand même — le doute de la machine ne bloque pas la main de Louis.
 */

type Props = {
  idees: IdeeProposee[];
  boites: Boite[];
  mode: "ia" | "manuel";
  pending: boolean;
  onChange: (idees: IdeeProposee[]) => void;
  onEnregistrer: () => void;
  onAnnuler: () => void;
};

export function Verification({
  idees,
  boites,
  mode,
  pending,
  onChange,
  onEnregistrer,
  onAnnuler,
}: Props) {
  const modifier = (cle: string, changement: Partial<IdeeProposee>) =>
    onChange(
      idees.map((idee) => (idee.cle === cle ? { ...idee, ...changement } : idee)),
    );

  const retirer = (cle: string) =>
    onChange(idees.filter((idee) => idee.cle !== cle));

  const sansDestination = idees.filter((idee) => idee.destination === null).length;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="font-display text-lg font-semibold">
          {idees.length === 1 ? "Une idée à vérifier" : `${idees.length} idées à vérifier`}
        </h2>
        <p className="text-muted-foreground text-sm">
          {mode === "ia"
            ? "Corrige ce qui est mal rangé, puis enregistre."
            : "Classement à la main : choisis une destination pour chaque idée."}
        </p>
      </div>

      <ul className="space-y-3">
        {idees.map((idee) => (
          <Carte
            key={idee.cle}
            idee={idee}
            boites={boites}
            onModifier={(changement) => modifier(idee.cle, changement)}
            onRetirer={() => retirer(idee.cle)}
          />
        ))}
      </ul>

      {sansDestination > 0 ? (
        <p className="text-muted-foreground text-sm">
          {sansDestination === 1
            ? "Une idée est encore sans destination : elle ira dans « À ranger »."
            : `${sansDestination} idées sont encore sans destination : elles iront dans « À ranger ».`}
        </p>
      ) : null}

      <div className="border-line bg-void/95 supports-[backdrop-filter]:bg-void/75 sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        <Button onClick={onEnregistrer} disabled={pending || idees.length === 0}>
          {pending
            ? "J'enregistre…"
            : idees.length === 1
              ? "Enregistrer 1 idée"
              : `Enregistrer ${idees.length} idées`}
        </Button>
        <Button variant="ghost" onClick={onAnnuler} disabled={pending}>
          Revenir au texte
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------- La carte ---------------------------------

function Carte({
  idee,
  boites,
  onModifier,
  onRetirer,
}: {
  idee: IdeeProposee;
  boites: Boite[];
  onModifier: (changement: Partial<IdeeProposee>) => void;
  onRetirer: () => void;
}) {
  /** Champ de saisie ouvert : création d'une boîte, ou renommage de celle proposée. */
  const [saisie, setSaisie] = useState<string | null>(null);

  const destination = idee.destination;
  const ambre = idee.incertain;

  const poser = (valeur: Destination) => {
    setSaisie(null);
    onModifier({ destination: valeur, incertain: false });
  };

  const valider = () => {
    const nom = (saisie ?? "").trim().slice(0, LIMITE_NOM_BOITE);
    if (nom.length === 0) return;
    poser({ type: "nouvelle", nom });
  };

  return (
    <li
      className={cn(
        "bg-surface-1 rounded-lg border p-4",
        ambre ? "border-warning/50" : "border-line",
      )}
    >
      <div className="flex items-start gap-2">
        <Textarea
          value={idee.texte}
          onChange={(event) =>
            onModifier({ texte: event.target.value.slice(0, LIMITE_IDEE) })
          }
          rows={1}
          aria-label="Texte de l'idée"
          className="min-h-0 resize-none border-0 bg-transparent px-0 py-0 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRetirer}
          aria-label="Retirer cette idée"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      {ambre ? (
        <div className="border-warning/40 bg-warning/5 mt-3 rounded-md border p-3">
          <p className="text-sm">
            {destination?.type === "nouvelle"
              ? `Créer la boîte « ${destination.nom} » ?`
              : "Je ne suis pas sûr de ce rangement : vérifie."}
          </p>

          {saisie === null ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {destination?.type === "nouvelle" ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => poser({ type: "nouvelle", nom: destination.nom })}
                  >
                    <Check aria-hidden="true" />
                    Oui
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSaisie(destination.nom)}
                  >
                    <Pencil aria-hidden="true" />
                    Renommer
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => onModifier({ incertain: false })}>
                  <Check aria-hidden="true" />
                  C&apos;est bon
                </Button>
              )}
            </div>
          ) : (
            <ChampNom
              valeur={saisie}
              onChange={setSaisie}
              onValider={valider}
              onAnnuler={() => setSaisie(null)}
            />
          )}

          <p className="text-muted-foreground mt-2.5 text-sm">
            …ou choisis une destination ci-dessous.
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Puce
          actif={destination?.type === "perso"}
          onClick={() => poser({ type: "perso" })}
        >
          Perso
        </Puce>
        <Puce
          actif={destination?.type === "aranger"}
          onClick={() => poser({ type: "aranger" })}
        >
          À ranger
        </Puce>

        {boites.map((boite) => (
          <Puce
            key={boite.id}
            actif={destination?.type === "boite" && destination.boiteId === boite.id}
            onClick={() => poser({ type: "boite", boiteId: boite.id })}
          >
            {boite.name}
          </Puce>
        ))}

        {destination?.type === "nouvelle" ? (
          <Puce actif onClick={() => setSaisie(destination.nom)}>
            {destination.nom}
            <span className="text-[0.7rem] opacity-70"> · nouvelle</span>
          </Puce>
        ) : null}

        {saisie === null || destination?.type === "nouvelle" ? (
          <Puce actif={false} onClick={() => setSaisie("")}>
            <FolderPlus aria-hidden="true" className="size-3" />
            Nouvelle boîte
          </Puce>
        ) : null}
      </div>

      {saisie !== null && !ambre ? (
        <div className="mt-2.5">
          <ChampNom
            valeur={saisie}
            onChange={setSaisie}
            onValider={valider}
            onAnnuler={() => setSaisie(null)}
          />
        </div>
      ) : null}
    </li>
  );
}

// --------------------------------- Les pièces --------------------------------

function Puce({
  actif,
  onClick,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={cn(
        "focus-visible:ring-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
        actif
          ? "border-primary bg-primary text-primary-foreground"
          : "border-line text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ChampNom({
  valeur,
  onChange,
  onValider,
  onAnnuler,
}: {
  valeur: string;
  onChange: (valeur: string) => void;
  onValider: () => void;
  onAnnuler: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={valeur}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onValider();
          }
          if (event.key === "Escape") onAnnuler();
        }}
        autoFocus
        maxLength={LIMITE_NOM_BOITE}
        placeholder="Nom de la boîte"
        aria-label="Nom de la boîte"
        className="h-8 w-44"
      />
      <Button size="sm" onClick={onValider} disabled={valeur.trim().length === 0}>
        Valider
      </Button>
      <Button size="sm" variant="ghost" onClick={onAnnuler}>
        Annuler
      </Button>
    </div>
  );
}
