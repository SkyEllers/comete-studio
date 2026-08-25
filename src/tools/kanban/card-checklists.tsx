"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import type { Checklist } from "./card-mutations";

function TitreEditable({
  valeur,
  onValider,
  className,
}: {
  valeur: string;
  onValider: (nouveau: string) => void;
  className?: string;
}) {
  const [edition, setEdition] = useState(false);
  const [texte, setTexte] = useState(valeur);

  // Le champ est semé à l'ouverture : l'affichage suit toujours la prop.
  const ouvrir = () => {
    setTexte(valeur);
    setEdition(true);
  };

  const valider = () => {
    const propre = texte.trim();
    setEdition(false);
    if (propre && propre !== valeur) onValider(propre);
  };

  if (!edition) {
    return (
      <button
        type="button"
        onClick={ouvrir}
        className={cn(
          "hover:bg-surface-2 focus-visible:ring-ring rounded-md px-1.5 py-0.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
          className,
        )}
      >
        {valeur}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      value={texte}
      onChange={(event) => setTexte(event.target.value)}
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
      aria-label="Texte"
      className="h-7"
    />
  );
}

function AjoutItem({ onAdd }: { onAdd: (texte: string) => void }) {
  const [texte, setTexte] = useState("");
  const champ = useRef<HTMLInputElement>(null);

  const ajouter = () => {
    const propre = texte.trim();
    if (!propre) return;
    onAdd(propre);
    setTexte("");
    champ.current?.focus();
  };

  return (
    <div className="flex items-center gap-2 pl-6">
      <Input
        ref={champ}
        value={texte}
        onChange={(event) => setTexte(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            ajouter();
          }
        }}
        placeholder="Ajouter un élément"
        maxLength={500}
        aria-label="Ajouter un élément à la checklist"
        className="h-8"
      />
      <Button size="sm" variant="secondary" onClick={ajouter} disabled={!texte.trim()}>
        Ajouter
      </Button>
    </div>
  );
}

export function CardChecklists({
  checklists,
  onAddChecklist,
  onRenameChecklist,
  onDeleteChecklist,
  onAddItem,
  onToggleItem,
  onRenameItem,
  onDeleteItem,
}: {
  checklists: Checklist[];
  onAddChecklist: (titre: string) => void;
  onRenameChecklist: (checklistId: string, titre: string) => void;
  onDeleteChecklist: (checklistId: string) => void;
  onAddItem: (checklistId: string, texte: string) => void;
  onToggleItem: (itemId: string, fait: boolean) => void;
  onRenameItem: (itemId: string, texte: string) => void;
  onDeleteItem: (itemId: string) => void;
}) {
  const [ajout, setAjout] = useState(false);
  const [titre, setTitre] = useState("");

  const creer = () => {
    onAddChecklist(titre.trim() || "Checklist");
    setTitre("");
    setAjout(false);
  };

  return (
    <section className="space-y-5">
      {checklists.map((checklist) => {
        const faits = checklist.items.filter((i) => i.isDone).length;
        const total = checklist.items.length;
        const pourcentage = total ? Math.round((faits / total) * 100) : 0;

        return (
          <div key={checklist.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <TitreEditable
                valeur={checklist.title}
                onValider={(nouveau) => onRenameChecklist(checklist.id, nouveau)}
                className="text-sm font-medium"
              />
              <span className="text-muted-foreground font-mono text-xs">
                {faits}/{total}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-auto"
                aria-label={`Supprimer la checklist ${checklist.title}`}
                onClick={() => onDeleteChecklist(checklist.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>

            <Progress
              value={pourcentage}
              aria-label={`Progression de ${checklist.title}`}
            />

            <ul className="space-y-1">
              {checklist.items.map((item) => (
                <li key={item.id} className="group flex items-center gap-2">
                  <Checkbox
                    id={`item-${item.id}`}
                    checked={item.isDone}
                    onCheckedChange={(coche) => onToggleItem(item.id, coche === true)}
                    aria-label={item.text}
                  />
                  <div className="min-w-0 flex-1">
                    <TitreEditable
                      valeur={item.text}
                      onValider={(nouveau) => onRenameItem(item.id, nouveau)}
                      className={cn(
                        "block w-full text-sm",
                        item.isDone && "text-muted-foreground line-through",
                      )}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Supprimer « ${item.text} »`}
                    className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => onDeleteItem(item.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>

            <AjoutItem onAdd={(texte) => onAddItem(checklist.id, texte)} />
          </div>
        );
      })}

      {ajout ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={titre}
            onChange={(event) => setTitre(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                creer();
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setAjout(false);
              }
            }}
            placeholder="Titre de la checklist"
            maxLength={80}
            aria-label="Titre de la checklist"
            className="h-8"
          />
          <Button size="sm" onClick={creer}>
            Ajouter
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAjout(false)}>
            Annuler
          </Button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAjout(true)}>
          <Plus aria-hidden="true" />
          Ajouter une checklist
        </Button>
      )}
    </section>
  );
}
