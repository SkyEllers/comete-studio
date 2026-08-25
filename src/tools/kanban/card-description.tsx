"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { MarkdownText } from "./markdown";

export function CardDescription({
  value,
  onSave,
}: {
  value: string;
  onSave: (description: string) => Promise<boolean>;
}) {
  const [edition, setEdition] = useState(false);
  const [brouillon, setBrouillon] = useState(value);
  const [apercu, setApercu] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  // Semé à l'ouverture : l'affichage suit la prop, y compris si elle change
  // pendant qu'on ne l'édite pas.
  const ouvrir = () => {
    setBrouillon(value);
    setApercu(false);
    setEdition(true);
  };

  const enregistrer = async () => {
    if (envoi) return;
    setEnvoi(true);
    const enregistre = await onSave(brouillon);
    setEnvoi(false);
    if (enregistre) setEdition(false);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-sm font-semibold">Description</h3>
        {edition ? (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            aria-pressed={apercu}
            onClick={() => setApercu((v) => !v)}
          >
            {apercu ? "Modifier" : "Aperçu"}
          </Button>
        ) : null}
      </div>

      {edition ? (
        <div className="space-y-2">
          {apercu ? (
            <div className="border-line bg-surface-1 min-h-32 rounded-md border p-3">
              {brouillon.trim() ? (
                <MarkdownText>{brouillon}</MarkdownText>
              ) : (
                <p className="text-muted-foreground text-sm">Rien à afficher.</p>
              )}
            </div>
          ) : (
            <Textarea
              autoFocus
              value={brouillon}
              onChange={(event) => setBrouillon(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void enregistrer();
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setEdition(false);
                }
              }}
              maxLength={20000}
              aria-label="Description de la carte"
              placeholder="Markdown accepté : **gras**, listes, liens…"
              className="min-h-32"
            />
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void enregistrer()} disabled={envoi}>
              {envoi ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdition(false)}>
              Annuler
            </Button>
            <span className="text-muted-foreground ml-auto font-mono text-xs">
              Ctrl + Entrée
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={ouvrir}
          className="hover:bg-surface-2 focus-visible:ring-ring block w-full rounded-md p-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {value.trim() ? (
            <MarkdownText>{value}</MarkdownText>
          ) : (
            <span className="text-muted-foreground text-sm">
              Ajouter une description…
            </span>
          )}
        </button>
      )}
    </section>
  );
}
