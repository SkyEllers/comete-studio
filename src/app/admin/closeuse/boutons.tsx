"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { preparerLeProfil, remettreLesRendezVousDemo } from "./actions";

export function BoutonPreparer({ libelle }: { libelle: string }) {
  const [enCours, startTransition] = useTransition();
  return (
    <Button
      onClick={() =>
        startTransition(async () => {
          const r = await preparerLeProfil();
          if (!r.ok) toast.error(r.error);
          else toast.success(r.data.invite ? "Profil créé : le mail d'invitation est parti" : "Profil prêt");
        })
      }
      disabled={enCours}
    >
      {libelle}
    </Button>
  );
}

export function BoutonDemos({ libelle }: { libelle: string }) {
  const [enCours, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      onClick={() =>
        startTransition(async () => {
          const r = await remettreLesRendezVousDemo();
          if (!r.ok) toast.error(r.error);
          else toast.success(`${r.data.crees} rendez-vous démo remis à neuf`);
        })
      }
      disabled={enCours}
    >
      {libelle}
    </Button>
  );
}
