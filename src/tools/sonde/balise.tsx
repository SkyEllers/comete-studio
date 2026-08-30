"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * La balise à coller sur la landing, et le bouton qui la copie.
 *
 * `navigator.clipboard` peut être refusé — page non sécurisée, permission
 * retirée. Dans ce cas on ne prétend pas avoir copié : le texte reste
 * sélectionnable, et c'est tout ce qu'il faut.
 */
export function Balise({
  jeton,
  origine,
  className,
}: {
  jeton: string;
  /** L'origine du hub, pour que la balise copiée marche telle quelle. */
  origine: string;
  className?: string;
}) {
  const [copie, setCopie] = useState(false);

  const texte = `<script src="${origine}/sonde.js" data-site="${jeton}" defer></script>`;

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      toast.success("Balise copiée");
      setTimeout(() => setCopie(false), 2000);
    } catch {
      toast.error("La copie a été refusée. Sélectionne la balise à la main.");
    }
  };

  return (
    <div className={cn("border-line bg-surface-2 flex items-start gap-2 rounded-md border p-2.5", className)}>
      <code className="min-w-0 flex-1 font-mono text-xs break-all">{texte}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={copier}
        aria-label="Copier la balise"
        className="shrink-0"
      >
        {copie ? (
          <Check aria-hidden="true" className="text-success" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
