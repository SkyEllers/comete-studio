"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions";

/**
 * Deux flèches, pour ranger une liste sans saisir de nombre.
 *
 * L'ordre se réglait en tapant un entier — 10, 20, 30 — ce qui demandait de
 * connaître les valeurs des voisins pour en choisir une qui tombe entre les
 * deux, et laissait s'installer des trous et des doublons. Ce que Louis veut
 * dire est pourtant toujours « celui-ci passe avant celui-là ». Les flèches le
 * disent directement ; `sort_order` reste la vérité en base, il ne se saisit
 * simplement plus.
 *
 * La flèche manquante plutôt que grisée aux extrémités : une flèche haute sur
 * la première ligne n'a aucun sens à proposer, et un bouton désactivé se clique
 * quand même trois fois avant qu'on comprenne pourquoi.
 *
 * L'action arrive déjà liée à sa ligne (`action.bind(null, id)`), ce qui permet
 * à ce composant de servir deux écrans qui ne rangent pas les mêmes tables.
 */
export function Reordonner({
  deplacer,
  premier,
  dernier,
  quoi,
}: {
  deplacer: (sens: "haut" | "bas") => Promise<ActionResult>;
  premier: boolean;
  dernier: boolean;
  /** Ce qu'on déplace, pour les lecteurs d'écran : « Google Ads ». */
  quoi: string;
}) {
  const [enCours, startTransition] = useTransition();

  const bouger = (sens: "haut" | "bas") =>
    startTransition(async () => {
      const resultat = await deplacer(sens);
      if (!resultat.ok) toast.error(resultat.error);
    });

  // Une seule ligne : rien à réordonner, et deux flèches inertes feraient
  // croire le contraire.
  if (premier && dernier) return null;

  return (
    <span className="flex items-center gap-0.5">
      {premier ? (
        <span className="size-8" aria-hidden="true" />
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={enCours}
          onClick={() => bouger("haut")}
          aria-label={`Monter ${quoi}`}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      )}

      {dernier ? (
        <span className="size-8" aria-hidden="true" />
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={enCours}
          onClick={() => bouger("bas")}
          aria-label={`Descendre ${quoi}`}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      )}
    </span>
  );
}
