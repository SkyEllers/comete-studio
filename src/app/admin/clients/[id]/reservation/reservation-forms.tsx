"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { ajouterPersonne, basculerPersonne, preparerReservation } from "./actions";

export function PreparerBouton({ organizationId }: { organizationId: string }) {
  const [enCours, demarrer] = useTransition();
  return (
    <Button
      disabled={enCours}
      onClick={() =>
        demarrer(async () => {
          const r = await preparerReservation(organizationId);
          if (!r.ok) toast.error(r.error);
        })
      }
    >
      Préparer la réservation
    </Button>
  );
}

export function AjouterPersonne({
  organizationId,
  candidates,
}: {
  organizationId: string;
  candidates: { userId: string; libelle: string }[];
}) {
  const [choix, setChoix] = useState(candidates[0]?.userId ?? "");
  const [enCours, demarrer] = useTransition();
  if (candidates.length === 0) {
    return <p className="text-muted-foreground text-sm">Tout l&apos;espace du client est déjà ajouté.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={choix}
        onChange={(e) => setChoix(e.target.value)}
        className="border-line bg-background h-9 rounded-md border px-3 text-sm"
        aria-label="Personne à ajouter"
      >
        {candidates.map((c) => (
          <option key={c.userId} value={c.userId}>
            {c.libelle}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        disabled={enCours || !choix}
        onClick={() =>
          demarrer(async () => {
            const r = await ajouterPersonne({ organizationId, userId: choix });
            if (r.ok) toast.success("Ajoutée.");
            else toast.error(r.error);
          })
        }
      >
        Ajouter
      </Button>
    </div>
  );
}

export function BasculerPersonne({
  organizationId,
  personneId,
  actif,
}: {
  organizationId: string;
  personneId: string;
  actif: boolean;
}) {
  const [enCours, demarrer] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={enCours}
      onClick={() =>
        demarrer(async () => {
          const r = await basculerPersonne({ organizationId, personneId, actif: !actif });
          if (!r.ok) toast.error(r.error);
        })
      }
    >
      {actif ? "Sortir du roulement" : "Remettre dans le roulement"}
    </Button>
  );
}
