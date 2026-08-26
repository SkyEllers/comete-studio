"use client";

import { ChevronDown, RotateCcw, Upload, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { couper, tailleLisible } from "./format";
import { enCours, useEnvois, type Envoi } from "./upload-context";

/**
 * La file d'envoi, en bas à droite.
 *
 * Montée par le layout de l'outil : elle traverse les changements de dossier,
 * puisque c'est le même layout qui reste.
 */
export function UploadPanel() {
  const { envois, renommer, annuler, reprendre, retirer, vider } = useEnvois();
  const [replie, setReplie] = useState(false);

  if (envois.length === 0) return null;

  const actifs = envois.filter(enCours);

  // Un fichier annulé ou refusé sort du compte : le laisser au dénominateur
  // empêcherait le total d'atteindre jamais son terme.
  const comptes = envois.filter(
    (e) => e.etat !== "annule" && e.etat !== "refuse",
  );
  const total = comptes.reduce((somme, e) => somme + e.taille, 0);
  const envoye = comptes.reduce(
    (somme, e) => somme + (e.etat === "termine" ? e.taille : e.envoye),
    0,
  );
  const vitesse = actifs.reduce((somme, e) => somme + e.vitesse, 0);
  const termines = envois.filter((e) => e.etat === "termine").length;

  return (
    <section
      aria-label="Envois en cours"
      className="border-line bg-surface-1 fixed right-4 bottom-4 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border shadow-lg"
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <Upload aria-hidden="true" className="text-muted-foreground size-4" />

        <p className="min-w-0 flex-1 truncate text-sm">
          {actifs.length > 0
            ? `Envoi de ${actifs.length} fichier${actifs.length > 1 ? "s" : ""}`
            : `${termines} fichier${termines > 1 ? "s" : ""} envoyé${termines > 1 ? "s" : ""}`}
        </p>

        {actifs.length === 0 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fermer la liste des envois"
            onClick={vider}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={!replie}
          aria-label={replie ? "Déplier les envois" : "Replier les envois"}
          onClick={() => setReplie((valeur) => !valeur)}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("transition-transform", replie && "rotate-180")}
          />
        </Button>
      </header>

      {replie ? null : (
        <ul className="divide-line max-h-80 divide-y overflow-y-auto border-t border-t-[var(--color-line)]">
          {envois.map((envoi) => (
            <LigneEnvoi
              key={envoi.cle}
              envoi={envoi}
              onRenommer={(nom) => renommer(envoi.cle, nom)}
              onAnnuler={() => annuler(envoi.cle)}
              onReprendre={() => reprendre(envoi.cle)}
              onRetirer={() => retirer(envoi.cle)}
            />
          ))}
        </ul>
      )}

      <footer className="border-line text-muted-foreground flex items-center justify-between gap-3 border-t px-3 py-2 font-mono text-xs">
        <span>
          {tailleLisible(envoye)} / {tailleLisible(total)}
        </span>
        {vitesse > 0 ? <span>{tailleLisible(vitesse)}/s</span> : null}
      </footer>
    </section>
  );
}

const LIBELLES: Record<Envoi["etat"], string> = {
  attente: "En attente",
  envoi: "En cours",
  termine: "Terminé",
  echec: "Échec",
  annule: "Annulé",
  refuse: "Refusé",
};

function LigneEnvoi({
  envoi,
  onRenommer,
  onAnnuler,
  onReprendre,
  onRetirer,
}: {
  envoi: Envoi;
  onRenommer: (nom: string) => void;
  onAnnuler: () => void;
  onReprendre: () => void;
  onRetirer: () => void;
}) {
  const part = envoi.taille > 0 ? (envoi.envoye / envoi.taille) * 100 : 0;
  const { base, extension } = couper(envoi.nom);

  const [edition, setEdition] = useState(false);
  const [saisie, setSaisie] = useState(base);

  /*
   * Renommer en plein envoi ne coûte rien : le nom ne voyage pas dans le
   * chemin de l'objet. Un envoi de vingt minutes peut donc être nommé pendant
   * qu'il monte, plutôt qu'après.
   */
  const valider = () => {
    setEdition(false);
    const propre = saisie.trim();
    if (propre && propre !== base) onRenommer(`${propre}${extension}`);
  };

  const modifiable = envoi.etat !== "refuse" && envoi.etat !== "annule";

  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {edition ? (
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <Input
              autoFocus
              value={saisie}
              onChange={(event) => setSaisie(event.target.value)}
              onBlur={valider}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  valider();
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setEdition(false);
                }
              }}
              maxLength={200}
              aria-label={`Nom de ${envoi.nom}`}
              className="h-7 min-w-0 flex-1"
            />
            {extension ? (
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {extension}
              </span>
            ) : null}
          </span>
        ) : modifiable ? (
          <button
            type="button"
            onClick={() => {
              setSaisie(base);
              setEdition(true);
            }}
            title={`Renommer ${envoi.nom}`}
            className="hover:bg-surface-2 focus-visible:ring-ring min-w-0 flex-1 truncate rounded-sm px-1 py-0.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {envoi.nom}
          </button>
        ) : (
          <p className="min-w-0 flex-1 truncate text-sm" title={envoi.nom}>
            {envoi.nom}
          </p>
        )}

        {envoi.etat === "echec" ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Reprendre l'envoi de ${envoi.nom}`}
            onClick={onReprendre}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        ) : null}

        {enCours(envoi) ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Annuler l'envoi de ${envoi.nom}`}
            onClick={onAnnuler}
          >
            <X aria-hidden="true" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Retirer ${envoi.nom} de la liste`}
            onClick={onRetirer}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>

      {envoi.etat === "envoi" ? (
        <Progress value={part} aria-label={`Progression de ${envoi.nom}`} />
      ) : null}

      <p
        className={cn(
          "text-muted-foreground font-mono text-xs",
          (envoi.etat === "echec" || envoi.etat === "refuse") && "text-danger",
          envoi.etat === "termine" && "text-success",
        )}
      >
        {envoi.etat === "envoi"
          ? `${tailleLisible(envoi.envoye)} / ${tailleLisible(envoi.taille)}${
              envoi.vitesse > 0 ? ` · ${tailleLisible(envoi.vitesse)}/s` : ""
            }`
          : `${LIBELLES[envoi.etat]}${envoi.message ? ` · ${envoi.message}` : ` · ${tailleLisible(envoi.taille)}`}`}
      </p>
    </li>
  );
}
