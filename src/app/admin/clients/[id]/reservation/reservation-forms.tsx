"use client";

import { Check, Copy } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  ajouterPersonne,
  basculerPersonne,
  creerJetonPage,
  ouvrirReservation,
  preparerReservation,
  reecrireDescriptions,
  revoquerJetonPage,
} from "./actions";

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

/** Ouvrir ou fermer la page. Ouvrir se confirme : c'est ce qui la met en service. */
export function OuvrirBouton({
  organizationId,
  actif,
  nomClient,
}: {
  organizationId: string;
  actif: boolean;
  nomClient: string;
}) {
  const [enCours, demarrer] = useTransition();
  const basculer = () =>
    demarrer(async () => {
      const r = await ouvrirReservation({ organizationId, actif: !actif });
      if (r.ok) toast.success(actif ? "Réservation fermée." : "Réservation ouverte.");
      else toast.error(r.error);
    });

  if (actif) {
    return (
      <Button variant="outline" size="sm" disabled={enCours} onClick={basculer}>
        Fermer
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={enCours}>
          Ouvrir
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ouvrir la réservation de {nomClient} ?</AlertDialogTitle>
          <AlertDialogDescription>
            La page du site proposera aussitôt des créneaux, et chaque réservation s&apos;écrira dans
            l&apos;agenda de la personne choisie.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={basculer}>Ouvrir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Un jeton pour le site. Il s'affiche une fois : la base n'en garde que
 * l'empreinte. Il ne vit que dans le résultat de l'action, pas dans un état.
 */
export function CreerJeton({ organizationId }: { organizationId: string }) {
  const [label, setLabel] = useState("");
  const [jeton, setJeton] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [enCours, demarrer] = useTransition();

  const copier = async () => {
    if (!jeton) return;
    try {
      await navigator.clipboard.writeText(jeton);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      toast.error("La copie a été refusée. Sélectionne le jeton à la main.");
    }
  };

  return (
    <div className="space-y-3">
      {jeton ? (
        <div className="border-ember bg-surface-2 space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Copie ce jeton maintenant. Il ne sera plus affiché.</p>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{jeton}</code>
            <Button variant="ghost" size="icon-sm" onClick={copier} aria-label="Copier le jeton" className="shrink-0">
              {copie ? <Check aria-hidden="true" className="text-success" /> : <Copy aria-hidden="true" />}
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setJeton(null)}>
            J&apos;ai copié le jeton
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Site de Peggy"
          maxLength={60}
          aria-label="Nom du jeton"
          className="max-w-xs"
        />
        <Button
          variant="outline"
          disabled={enCours || !label.trim()}
          onClick={() =>
            demarrer(async () => {
              const r = await creerJetonPage({ organizationId, label });
              if (r.ok) {
                setJeton(r.data.jeton);
                setLabel("");
              } else toast.error(r.error);
            })
          }
        >
          Créer un jeton
        </Button>
      </div>
    </div>
  );
}

export function RevoquerJeton({ organizationId, jetonId }: { organizationId: string; jetonId: string }) {
  const [enCours, demarrer] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={enCours}
      onClick={() =>
        demarrer(async () => {
          const r = await revoquerJetonPage({ organizationId, jetonId });
          if (r.ok) toast.success("Jeton révoqué.");
          else toast.error(r.error);
        })
      }
    >
      Révoquer
    </Button>
  );
}

/** Pour les diagnostics pris avant le 30/09/2026 : numéro, réponses et lien de la fiche dans Google. */
export function ReecrireDescriptions({ organizationId }: { organizationId: string }) {
  const [enCours, demarrer] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={enCours}
      onClick={() =>
        demarrer(async () => {
          const r = await reecrireDescriptions(organizationId);
          if (!r.ok) toast.error(r.error);
          else if (r.data.echecs > 0) toast.error(`${r.data.reecrits} réécrits, ${r.data.echecs} refusés par Google.`);
          else toast.success(`${r.data.reecrits} rendez-vous réécrits dans Google Agenda.`);
        })
      }
    >
      {enCours ? "Réécriture…" : "Réécrire les rendez-vous à venir dans Google"}
    </Button>
  );
}
