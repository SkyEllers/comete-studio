"use client";

import { ListFilter, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  bascule,
  FILTRES_VIDES,
  LIBELLES_ECHEANCE,
  LIBELLES_ETAT,
  nombreFiltres,
  type FiltreEcheance,
  type FiltreEtat,
  type Filtres,
} from "./filters";
import { initiales } from "./initials";
import { colorHex } from "./palette";
import type { BoardLabel, BoardMember } from "./types";

const ECHEANCES: FiltreEcheance[] = ["depassee", "semaine", "sans"];
const ETATS: FiltreEtat[] = ["en-cours", "terminee"];

/** Bouton d'un critère exclusif : un second clic le désélectionne. */
function Choix({
  actif,
  onClick,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={actif ? "default" : "outline"}
      size="sm"
      aria-pressed={actif}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Section({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground px-1 text-xs">{titre}</p>
      {children}
    </div>
  );
}

export function BoardFilters({
  filtres,
  labels,
  members,
  onChange,
}: {
  filtres: Filtres;
  labels: BoardLabel[];
  members: BoardMember[];
  onChange: (filtres: Filtres) => void;
}) {
  const nombre = nombreFiltres(filtres);

  // Le badge compte la recherche avec les critères : « Effacer » remet donc
  // tout à zéro, champ de recherche compris, sinon le compte ne retomberait
  // pas à zéro.
  const effacer = () => onChange(FILTRES_VIDES);

  const exclusif = <T,>(actuel: T | null, valeur: T) =>
    actuel === valeur ? null : valeur;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="max-sm:h-9"
          aria-label="Filtrer les cartes"
        >
          <ListFilter aria-hidden="true" />
          <span className="max-sm:sr-only">Filtres</span>
          {nombre > 0 ? (
            <span className="bg-primary text-primary-foreground ml-0.5 inline-flex size-4 items-center justify-center rounded-full font-mono text-[0.6rem]">
              {nombre}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 space-y-4 p-3">
        {labels.length > 0 ? (
          <Section titre="Étiquettes">
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {labels.map((label) => (
                <li key={label.id}>
                  <div className="hover:bg-surface-2 flex items-center gap-2 rounded-md p-1 transition-colors">
                    <Checkbox
                      id={`filtre-etiquette-${label.id}`}
                      checked={filtres.labelIds.includes(label.id)}
                      onCheckedChange={() =>
                        onChange({
                          ...filtres,
                          labelIds: bascule(filtres.labelIds, label.id),
                        })
                      }
                    />
                    <label
                      htmlFor={`filtre-etiquette-${label.id}`}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm"
                    >
                      <span
                        aria-hidden="true"
                        className="size-4 shrink-0 rounded"
                        style={{ backgroundColor: colorHex(label.color) }}
                      />
                      <span className="truncate">
                        {label.name || (
                          <span className="text-muted-foreground">Sans nom</span>
                        )}
                      </span>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {members.length > 0 ? (
          <Section titre="Membres">
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {members.map((membre) => (
                <li key={membre.id}>
                  <div className="hover:bg-surface-2 flex items-center gap-2 rounded-md p-1 transition-colors">
                    <Checkbox
                      id={`filtre-membre-${membre.id}`}
                      checked={filtres.memberIds.includes(membre.id)}
                      onCheckedChange={() =>
                        onChange({
                          ...filtres,
                          memberIds: bascule(filtres.memberIds, membre.id),
                        })
                      }
                    />
                    <label
                      htmlFor={`filtre-membre-${membre.id}`}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm"
                    >
                      <span
                        aria-hidden="true"
                        className="bg-surface-2 border-line flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.6rem] font-medium"
                      >
                        {initiales(membre.name)}
                      </span>
                      <span className="truncate">{membre.name}</span>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section titre="Échéance">
          <div className="flex flex-wrap gap-1.5">
            {ECHEANCES.map((valeur) => (
              <Choix
                key={valeur}
                actif={filtres.echeance === valeur}
                onClick={() =>
                  onChange({
                    ...filtres,
                    echeance: exclusif(filtres.echeance, valeur),
                  })
                }
              >
                {LIBELLES_ECHEANCE[valeur]}
              </Choix>
            ))}
          </div>
        </Section>

        <Section titre="État">
          <div className="flex flex-wrap gap-1.5">
            {ETATS.map((valeur) => (
              <Choix
                key={valeur}
                actif={filtres.etat === valeur}
                onClick={() =>
                  onChange({ ...filtres, etat: exclusif(filtres.etat, valeur) })
                }
              >
                {LIBELLES_ETAT[valeur]}
              </Choix>
            ))}
          </div>
        </Section>

        <Button
          variant="ghost"
          size="sm"
          className={cn("w-full justify-start", nombre === 0 && "invisible")}
          onClick={effacer}
        >
          <X aria-hidden="true" />
          Effacer les filtres
        </Button>
      </PopoverContent>
    </Popover>
  );
}
