"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { POINTS } from "@/tools/analyse/grille";

import { corrigerAnalyse, deciderLecon, lancerSynthese, relancerAnalyse } from "./actions";

/** Les boutons de la page Analyses : chacun appelle une action, puis rafraîchit la page. */

export function BoutonSynthese({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={enCours}
      onClick={() =>
        demarrer(async () => {
          const r = await lancerSynthese(organizationId);
          if (!r.ok) toast.error(r.error);
          else {
            toast.success(`Synthèse faite sur ${r.data.appels} appels.`);
            router.refresh();
          }
        })
      }
    >
      {enCours ? "Synthèse en cours (une à quatre minutes)…" : "Lancer la synthèse"}
    </Button>
  );
}

export function BoutonsLecon({ id, statut }: { id: string; statut: "proposee" | "active" | "refusee" | "retiree" }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const decider = (s: "active" | "refusee" | "retiree", message: string) =>
    demarrer(async () => {
      const r = await deciderLecon({ id, statut: s });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(message);
        router.refresh();
      }
    });

  if (statut === "proposee") {
    return (
      <span className="flex gap-2">
        <Button size="sm" disabled={enCours} onClick={() => decider("active", "Leçon ajoutée au carnet.")}>
          Valider
        </Button>
        <Button size="sm" variant="ghost" disabled={enCours} onClick={() => decider("refusee", "Leçon refusée : elle ne reviendra pas.")}>
          Refuser
        </Button>
      </span>
    );
  }
  if (statut === "active") {
    return (
      <Button size="sm" variant="ghost" disabled={enCours} onClick={() => decider("retiree", "Leçon retirée du carnet.")}>
        Retirer
      </Button>
    );
  }
  return (
    <Button size="sm" variant="ghost" disabled={enCours} onClick={() => decider("active", "Leçon remise au carnet.")}>
      Remettre
    </Button>
  );
}

export function BoutonRelancer({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={enCours}
      onClick={() =>
        demarrer(async () => {
          const r = await relancerAnalyse(bookingId);
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Analyse refaite.");
            router.refresh();
          }
        })
      }
    >
      {enCours ? "Analyse en cours (une à trois minutes)…" : "Refaire l'analyse"}
    </Button>
  );
}

export function FormCorrection({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [texte, setTexte] = useState("");
  const [point, setPoint] = useState("general");
  const [reanalyser, setReanalyser] = useState(true);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        demarrer(async () => {
          const r = await corrigerAnalyse({ bookingId, texte, point, reanalyser });
          if (!r.ok) toast.error(r.error);
          else {
            toast.success(reanalyser ? "Correction ajoutée au carnet. L'appel sera relu avec elle." : "Correction ajoutée au carnet.");
            setTexte("");
            router.refresh();
          }
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="correction-point">Sur quoi</Label>
        <select
          id="correction-point"
          value={point}
          onChange={(e) => setPoint(e.target.value)}
          className="border-champ bg-papier-clair h-9 w-full rounded-md border px-2 text-sm"
        >
          <option value="general">En général</option>
          {POINTS.map((p) => (
            <option key={p.cle} value={p.cle}>
              {p.libelle}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="correction-texte">Ce que l&apos;analyse aurait dû dire</Label>
        <Textarea
          id="correction-texte"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Par exemple : citer un résultat de Laetitia est permis, elle a donné son accord."
        />
        <p className="text-muted-foreground text-xs">
          Écris-la comme une règle générale : elle sera relue par toutes les analyses suivantes.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={reanalyser} onChange={(e) => setReanalyser(e.target.checked)} />
        Relire cet appel avec la correction
      </label>
      <Button type="submit" disabled={enCours || texte.trim().length < 5}>
        {enCours ? "Enregistrement…" : "Ajouter au carnet"}
      </Button>
    </form>
  );
}
