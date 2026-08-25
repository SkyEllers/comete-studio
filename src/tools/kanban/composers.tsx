"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Composeur commun aux cartes et aux listes.
 *
 * Entrée valide, Maj+Entrée saute une ligne, Échap referme. Après validation
 * le champ se vide et garde le focus : on enchaîne sans repasser par la souris.
 */
export function Composer({
  label,
  placeholder,
  submitLabel,
  onSubmit,
  className,
  autoOpen = false,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (valeur: string) => Promise<boolean>;
  className?: string;
  autoOpen?: boolean;
}) {
  const [ouvert, setOuvert] = useState(autoOpen);
  const [valeur, setValeur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const champ = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ouvert) champ.current?.focus();
  }, [ouvert]);

  const valider = async () => {
    const texte = valeur.trim();
    if (!texte || envoi) return;

    setEnvoi(true);
    const reussi = await onSubmit(texte);
    setEnvoi(false);

    if (reussi) {
      setValeur("");
      champ.current?.focus();
    }
  };

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className={cn(
          "text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
          className,
        )}
      >
        <Plus aria-hidden="true" className="size-4" />
        {label}
      </button>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <textarea
        ref={champ}
        value={valeur}
        onChange={(event) => setValeur(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void valider();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setValeur("");
            setOuvert(false);
          }
        }}
        rows={2}
        placeholder={placeholder}
        aria-label={label}
        className="border-input bg-surface-2 focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border px-2.5 py-2 text-sm outline-none focus-visible:ring-3"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void valider()} disabled={envoi}>
          {envoi ? "…" : submitLabel}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setValeur("");
            setOuvert(false);
          }}
          aria-label="Fermer le composeur"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
