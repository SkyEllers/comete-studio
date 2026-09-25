"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
  attribuerAVenirDuType,
  noterIncident,
  reglerGrille,
  relierTypeACloseuse,
} from "./closeuses-actions";

const champ =
  "border-input bg-input/30 h-8 rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function FormGrille(props: {
  organizationId: string;
  userId: string;
  taux: number;
  tauxPalier: number;
  palierApres: number;
}) {
  const [taux, setTaux] = useState(String(props.taux));
  const [tauxPalier, setTauxPalier] = useState(String(props.tauxPalier));
  const [palierApres, setPalierApres] = useState(String(props.palierApres));
  const [enCours, startTransition] = useTransition();

  const enregistrer = () =>
    startTransition(async () => {
      const r = await reglerGrille({
        organizationId: props.organizationId,
        userId: props.userId,
        taux: taux.replace(",", "."),
        tauxPalier: tauxPalier.replace(",", "."),
        palierApres,
      });
      if (!r.ok) toast.error(r.error);
      else toast.success("Grille enregistrée");
    });

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor={`taux-${props.userId}`} className="text-xs">Taux (%)</Label>
        <Input id={`taux-${props.userId}`} className="w-20" value={taux} onChange={(e) => setTaux(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`palier-${props.userId}`} className="text-xs">Au-delà de la vente n°</Label>
        <Input id={`palier-${props.userId}`} className="w-20" value={palierApres} onChange={(e) => setPalierApres(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`taux-palier-${props.userId}`} className="text-xs">Taux du palier (%)</Label>
        <Input id={`taux-palier-${props.userId}`} className="w-20" value={tauxPalier} onChange={(e) => setTauxPalier(e.target.value)} />
      </div>
      <Button size="sm" variant="outline" onClick={enregistrer} disabled={enCours}>
        Enregistrer
      </Button>
    </div>
  );
}

export function ChoixTypeCloseuse(props: {
  organizationId: string;
  filterId: string;
  nom: string;
  suivi: boolean;
  closeuseId: string | null;
  closeuses: { id: string; nom: string }[];
}) {
  const [valeur, setValeur] = useState(props.closeuseId ?? "");
  const [enCours, startTransition] = useTransition();

  const changer = (nouvelle: string) =>
    startTransition(async () => {
      const r = await relierTypeACloseuse({
        organizationId: props.organizationId,
        filterId: props.filterId,
        closeuseId: nouvelle || null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setValeur(nouvelle);
      toast.success(nouvelle ? "Les prochaines réservations iront à la closeuse" : "Ce type revient au client");
    });

  const attribuer = () =>
    startTransition(async () => {
      const r = await attribuerAVenirDuType({ organizationId: props.organizationId, filterId: props.filterId });
      if (!r.ok) toast.error(r.error);
      else toast.success(`${r.data.attribues} rendez-vous à venir attribués`);
    });

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <span className={cn("min-w-48", !props.suivi && "text-muted-foreground line-through")}>{props.nom}</span>
      <select
        className={champ}
        value={valeur}
        disabled={enCours}
        onChange={(e) => changer(e.target.value)}
        aria-label={`Qui tient les rendez-vous « ${props.nom} »`}
      >
        <option value="">Le client</option>
        {props.closeuses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nom}
          </option>
        ))}
      </select>
      {valeur ? (
        <Button size="sm" variant="ghost" onClick={attribuer} disabled={enCours}>
          Attribuer aussi les rendez-vous à venir
        </Button>
      ) : null}
    </div>
  );
}

export function ChoixIncident(props: {
  organizationId: string;
  bookingId: string;
  numero: number;
  libelle: string;
  valeur: "aucun" | "impaye" | "rembourse";
}) {
  const [valeur, setValeur] = useState(props.valeur);
  const [enCours, startTransition] = useTransition();

  const changer = (nouvelle: typeof valeur) =>
    startTransition(async () => {
      const r = await noterIncident({
        organizationId: props.organizationId,
        bookingId: props.bookingId,
        numero: props.numero,
        type: nouvelle,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setValeur(nouvelle);
    });

  return (
    <label
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1 text-xs",
        valeur === "aucun" ? "border-line" : "border-destructive/50 text-destructive",
      )}
    >
      {props.libelle}
      <select
        className="bg-transparent text-xs outline-none"
        value={valeur}
        disabled={enCours}
        onChange={(e) => changer(e.target.value as typeof valeur)}
      >
        <option value="aucun">normal</option>
        <option value="impaye">impayé</option>
        <option value="rembourse">remboursé</option>
      </select>
    </label>
  );
}
