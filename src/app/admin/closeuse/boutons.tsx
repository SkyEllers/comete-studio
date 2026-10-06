"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { preparerLeProfil, remettreLesRendezVousDemo, simulerLaCliente } from "./actions";

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

const FAIT = { ouvrir: "Ouvert par la cliente (simulé)", signer: "Signé (simulé) : la vente attend le paiement", payer: "Payé (simulé) : la vente est dans son espace" };

export function BoutonCliente({
  devisId,
  geste,
  libelle,
}: {
  devisId: string;
  geste: "ouvrir" | "signer" | "payer";
  libelle: string;
}) {
  const [enCours, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        startTransition(async () => {
          const r = await simulerLaCliente({ devisId, geste });
          if (!r.ok) toast.error(r.error);
          else toast.success(FAIT[geste]);
        })
      }
      disabled={enCours}
    >
      {libelle}
    </Button>
  );
}
