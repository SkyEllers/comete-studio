"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  enregistrerReglages,
  exporterEntrees,
} from "@/app/app/[orgSlug]/(tools)/temps/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Les deux réglages de l'outil, et sa porte de sortie.
 *
 * Sobres à dessein : ce sont deux nombres et un bouton, en bas d'un écran
 * qu'on vient lire pour tout autre chose. Chacun porte son explication d'une
 * ligne — un seuil dont on a oublié ce qu'il déclenche finit par être ignoré,
 * et une alerte qu'on ignore vaut mieux être éteinte.
 */

export function Reglages({
  orgSlug,
  tauxAlerteEuros,
  heuresPilotageAlerte,
}: {
  orgSlug: string;
  tauxAlerteEuros: number;
  heuresPilotageAlerte: number;
}) {
  const [taux, setTaux] = useState(tauxAlerteEuros);
  const [heures, setHeures] = useState(heuresPilotageAlerte);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const inchange = taux === tauxAlerteEuros && heures === heuresPilotageAlerte;

  const enregistrer = (evenement: React.FormEvent) => {
    evenement.preventDefault();

    startTransition(async () => {
      const resultat = await enregistrerReglages(orgSlug, {
        tauxAlerteEuros: taux,
        heuresPilotageAlerte: heures,
      });

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      toast.success("Seuils enregistrés");
      router.refresh();
    });
  };

  return (
    <form onSubmit={enregistrer} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="seuil-taux">Seuil de taux horaire</Label>
          <div className="flex items-center gap-2">
            <Input
              id="seuil-taux"
              type="number"
              min={0}
              max={1000}
              step={1}
              inputMode="numeric"
              value={taux}
              onChange={(evenement) =>
                setTaux(Math.max(0, Math.round(Number(evenement.target.value))))
              }
              className="w-28"
            />
            <span className="text-muted-foreground font-mono text-sm">€/h</span>
          </div>
          <p className="text-muted-foreground text-xs">
            En dessous, la ligne du client passe en orange sur l&apos;écran Par
            client.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="seuil-heures">Plafond d&apos;heures en pilotage</Label>
          <div className="flex items-center gap-2">
            <Input
              id="seuil-heures"
              type="number"
              min={1}
              max={500}
              step={1}
              inputMode="numeric"
              value={heures}
              onChange={(evenement) =>
                setHeures(Math.max(1, Math.round(Number(evenement.target.value))))
              }
              className="w-28"
            />
            <span className="text-muted-foreground font-mono text-sm">h / mois</span>
          </div>
          <p className="text-muted-foreground text-xs">
            Au-delà, un client en pilotage passe en orange : il te prend plus que
            prévu.
          </p>
        </div>
      </div>

      <Button type="submit" size="sm" disabled={pending || inchange}>
        {pending ? "Un instant…" : "Enregistrer les seuils"}
      </Button>
    </form>
  );
}

/**
 * L'export : deux dates, un fichier.
 *
 * Le CSV est fabriqué par le serveur — la période demandée n'est pas à
 * l'écran — et le navigateur ne fait que poser le BOM et déclencher le
 * téléchargement. Sans ce BOM, un Excel en français affiche « SÃ©ance » à la
 * place de « Séance ».
 */
export function ExportPulsar({
  orgSlug,
  depuisParDefaut,
  jusquaParDefaut,
}: {
  orgSlug: string;
  depuisParDefaut: string;
  jusquaParDefaut: string;
}) {
  const [depuis, setDepuis] = useState(depuisParDefaut);
  const [jusqua, setJusqua] = useState(jusquaParDefaut);
  const [pending, startTransition] = useTransition();

  const telecharger = (evenement: React.FormEvent) => {
    evenement.preventDefault();

    startTransition(async () => {
      const resultat = await exporterEntrees(orgSlug, { depuis, jusqua });

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      const { csv, nom, lignes } = resultat.data;

      if (lignes === 0) {
        toast.warning("Aucune heure comptée sur cette période.");
        return;
      }

      const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const lien = document.createElement("a");
      lien.href = url;
      lien.download = `${nom}.csv`;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();

      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(
        lignes === 1 ? "1 entrée exportée" : `${lignes} entrées exportées`,
      );
    });
  };

  return (
    <form onSubmit={telecharger} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="export-depuis">Du</Label>
          <Input
            id="export-depuis"
            type="date"
            value={depuis}
            max={jusqua}
            onChange={(evenement) => setDepuis(evenement.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="export-jusqua">Au</Label>
          <Input
            id="export-jusqua"
            type="date"
            value={jusqua}
            min={depuis}
            onChange={(evenement) => setJusqua(evenement.target.value)}
          />
        </div>
      </div>

      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Download aria-hidden="true" />
        {pending ? "Je rassemble…" : "Exporter en CSV"}
      </Button>

      <p className="text-muted-foreground text-xs">
        Date, client, type, phase, durée en heures, note. De quoi reprendre tes
        heures ailleurs le jour où Pulsar ne suffit plus.
      </p>
    </form>
  );
}
