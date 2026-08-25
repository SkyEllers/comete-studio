"use client";

import { fr } from "date-fns/locale";
import { Check, Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { initiales } from "./initials";
import { BOARD_COLORS, PALETTE, colorHex, type BoardColor } from "./palette";
import type { BoardLabel, BoardMember } from "./types";

/** `YYYY-MM-DD` en heure locale : `toISOString()` décalerait d'un jour. */
export function jourISO(date: Date) {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

// -------------------------------- Étiquettes --------------------------------

export function LabelPicker({
  labels,
  selectedIds,
  onToggle,
  onCreate,
  onRename,
  children,
}: {
  labels: BoardLabel[];
  selectedIds: string[];
  onToggle: (labelId: string, actif: boolean) => void;
  onCreate: (name: string, color: BoardColor) => void;
  onRename: (labelId: string, name: string) => void;
  children: React.ReactNode;
}) {
  const [creation, setCreation] = useState(false);
  const [nouveauNom, setNouveauNom] = useState("");
  const [nouvelleCouleur, setNouvelleCouleur] = useState<BoardColor>("ember");
  const [renommage, setRenommage] = useState<string | null>(null);
  const [nomEdite, setNomEdite] = useState("");

  const creer = () => {
    onCreate(nouveauNom, nouvelleCouleur);
    setNouveauNom("");
    setNouvelleCouleur("ember");
    setCreation(false);
  };

  const validerRenommage = (labelId: string, actuel: string) => {
    const propre = nomEdite.trim();
    setRenommage(null);
    if (propre !== actuel) onRename(labelId, propre);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <p className="text-muted-foreground px-1 pb-2 text-xs">Étiquettes</p>

        <ul className="max-h-64 space-y-0.5 overflow-y-auto">
          {labels.map((label) => (
            <li key={label.id}>
              {renommage === label.id ? (
                <div className="flex items-center gap-1 p-1">
                  <span
                    aria-hidden="true"
                    className="size-4 shrink-0 rounded"
                    style={{ backgroundColor: colorHex(label.color) }}
                  />
                  <Input
                    autoFocus
                    value={nomEdite}
                    onChange={(event) => setNomEdite(event.target.value)}
                    onBlur={() => validerRenommage(label.id, label.name)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        validerRenommage(label.id, label.name);
                      }
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setRenommage(null);
                      }
                    }}
                    maxLength={40}
                    aria-label="Nom de l'étiquette"
                    className="h-7"
                  />
                </div>
              ) : (
                <div className="hover:bg-surface-2 flex items-center gap-2 rounded-md p-1 transition-colors">
                  <Checkbox
                    id={`etiquette-${label.id}`}
                    checked={selectedIds.includes(label.id)}
                    onCheckedChange={(coche) =>
                      onToggle(label.id, coche === true)
                    }
                  />
                  <label
                    htmlFor={`etiquette-${label.id}`}
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
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setNomEdite(label.name);
                      setRenommage(label.id);
                    }}
                  >
                    Renommer
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {creation ? (
          <div className="border-line mt-2 space-y-2 border-t pt-2">
            <Input
              autoFocus
              value={nouveauNom}
              onChange={(event) => setNouveauNom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  creer();
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setCreation(false);
                }
              }}
              placeholder="Nom (facultatif)"
              maxLength={40}
              aria-label="Nom de la nouvelle étiquette"
              className="h-8"
            />
            <div className="flex flex-wrap gap-1.5">
              {BOARD_COLORS.map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  onClick={() => setNouvelleCouleur(valeur)}
                  aria-label={PALETTE[valeur].label}
                  title={PALETTE[valeur].label}
                  className={cn(
                    "focus-visible:ring-ring size-5 rounded focus-visible:ring-2 focus-visible:outline-none",
                    valeur === nouvelleCouleur && "ring-foreground ring-2",
                  )}
                  style={{ backgroundColor: PALETTE[valeur].hex }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={creer}>
                Créer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCreation(false)}
              >
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start"
            onClick={() => setCreation(true)}
          >
            <Plus aria-hidden="true" />
            Créer une étiquette
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// --------------------------------- Échéance ---------------------------------

export function DuePicker({
  value,
  onChange,
  children,
}: {
  value: string | null;
  onChange: (jour: string | null) => void;
  children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  const selection = value ? new Date(`${value}T00:00:00`) : undefined;

  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          locale={fr}
          selected={selection}
          defaultMonth={selection}
          onSelect={(jour) => {
            onChange(jour ? jourISO(jour) : null);
            setOuvert(false);
          }}
        />
        {value ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start"
            onClick={() => {
              onChange(null);
              setOuvert(false);
            }}
          >
            <X aria-hidden="true" />
            Retirer l&apos;échéance
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------- Membres ---------------------------------

export function MemberPicker({
  members,
  selectedIds,
  onToggle,
  children,
}: {
  members: BoardMember[];
  selectedIds: string[];
  onToggle: (memberId: string, actif: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <p className="text-muted-foreground px-1 pb-2 text-xs">
          Membres de l&apos;espace
        </p>
        <ul className="max-h-64 space-y-0.5 overflow-y-auto">
          {members.map((membre) => {
            const actif = selectedIds.includes(membre.id);
            return (
              <li key={membre.id}>
                <button
                  type="button"
                  onClick={() => onToggle(membre.id, !actif)}
                  className="hover:bg-surface-2 focus-visible:ring-ring flex w-full items-center gap-2 rounded-md p-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="bg-surface-2 border-line flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.6rem] font-medium">
                    {initiales(membre.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {membre.name}
                  </span>
                  {actif ? (
                    <Check aria-hidden="true" className="text-primary size-4" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// -------------------------------- Couverture --------------------------------

export function CoverPicker({
  value,
  onChange,
  children,
}: {
  value: string | null;
  onChange: (couleur: BoardColor | null) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <p className="text-muted-foreground px-1 pb-2 text-xs">Couverture</p>
        <div className="flex flex-wrap gap-1.5 px-1">
          {BOARD_COLORS.map((couleur) => (
            <button
              key={couleur}
              type="button"
              onClick={() => onChange(couleur)}
              aria-label={PALETTE[couleur].label}
              title={PALETTE[couleur].label}
              className={cn(
                "focus-visible:ring-ring h-6 w-8 rounded focus-visible:ring-2 focus-visible:outline-none",
                couleur === value && "ring-foreground ring-2",
              )}
              style={{ backgroundColor: PALETTE[couleur].hex }}
            />
          ))}
        </div>
        {value ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start"
            onClick={() => onChange(null)}
          >
            <X aria-hidden="true" />
            Retirer la couverture
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
