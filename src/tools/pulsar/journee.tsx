"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { modifier, saisir, supprimer } from "@/app/app/[orgSlug]/(tools)/temps/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { formatDuree } from "./duree";
import { FormulaireEntree, valeursParDefaut, type Valeurs } from "./formulaire";
import { libelleTache, type ClientPulsar, type Entree } from "./types";

/**
 * La journée : ce qui a été compté aujourd'hui, et de quoi rattraper un oubli.
 *
 * Tout se corrige et tout s'efface, sans limite de temps : c'est un carnet
 * personnel, pas un registre contractuel — l'inverse exact de Radar, et c'est
 * une décision, pas un oubli. La suppression demande quand même confirmation,
 * parce qu'elle part d'une liste où le doigt glisse.
 *
 * Le chronomètre en marche n'est pas ici : il a sa carte au-dessus, et une
 * ligne qui n'a pas encore de durée n'aurait rien à montrer dans une colonne
 * de durées.
 */

export type EntreeAffichee = Entree & {
  clientNom: string;
  heureLabel: string;
};

export function Journee({
  orgSlug,
  entrees,
  clients,
  aujourdhui,
}: {
  orgSlug: string;
  entrees: EntreeAffichee[];
  /** Les clients encore chronométrables : les archivés ne sont pas proposés. */
  clients: ClientPulsar[];
  aujourdhui: string;
}) {
  const [saisieOuverte, setSaisieOuverte] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground font-mono text-xs tracking-wide">
          Aujourd&apos;hui
        </h2>

        <Button variant="outline" size="sm" onClick={() => setSaisieOuverte(true)}>
          <Plus aria-hidden="true" />
          Ajouter une heure
        </Button>
      </div>

      {entrees.length === 0 ? (
        <div className="border-line bg-surface-1 rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="font-display font-semibold">Rien de compté aujourd&apos;hui</p>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Deux taps au-dessus, et le chronomètre part.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {entrees.map((entree) => (
            <Ligne
              key={entree.id}
              orgSlug={orgSlug}
              entree={entree}
              clients={clients}
              aujourdhui={aujourdhui}
            />
          ))}
        </ul>
      )}

      <Saisie
        orgSlug={orgSlug}
        clients={clients}
        aujourdhui={aujourdhui}
        ouverte={saisieOuverte}
        onFermer={() => setSaisieOuverte(false)}
      />
    </section>
  );
}

// --------------------------------- Une ligne ---------------------------------

function Ligne({
  orgSlug,
  entree,
  clients,
  aujourdhui,
}: {
  orgSlug: string;
  entree: EntreeAffichee;
  clients: ClientPulsar[];
  aujourdhui: string;
}) {
  const [edition, setEdition] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const enregistrer = (valeurs: Valeurs) =>
    startTransition(async () => {
      const resultat = await modifier(orgSlug, {
        id: entree.id,
        clientId: valeurs.clientId,
        task: valeurs.task,
        minutes: valeurs.minutes,
        note: valeurs.note,
      });

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      setEdition(false);
      toast.success("Entrée corrigée");
      router.refresh();
    });

  const effacer = () =>
    startTransition(async () => {
      const resultat = await supprimer(orgSlug, entree.id);

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      setSuppression(false);
      toast.success("Entrée supprimée");
      router.refresh();
    });

  return (
    <li className="border-line bg-surface-1 flex items-start gap-3 rounded-lg border p-3">
      <span className="text-muted-foreground mt-0.5 w-12 shrink-0 font-mono text-xs tabular-nums">
        {entree.heureLabel}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="font-medium">{entree.clientNom}</span>
          <span className="text-muted-foreground">
            {" · "}
            {libelleTache(entree.task)}
          </span>
        </p>
        {entree.note ? (
          <p className="text-muted-foreground mt-0.5 text-sm break-words">
            {entree.note}
          </p>
        ) : null}
      </div>

      <span className="shrink-0 font-mono text-sm tabular-nums">
        {formatDuree(entree.duration_minutes ?? 0)}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`Menu de l'entrée ${entree.clientNom}`}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(evenement) => {
              evenement.preventDefault();
              setEdition(true);
            }}
          >
            <Pencil aria-hidden="true" />
            Modifier
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-destructive"
            onSelect={(evenement) => {
              // Le menu se referme sur la sélection : sans ça, il emporterait
              // la fenêtre de confirmation avec lui.
              evenement.preventDefault();
              setSuppression(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={edition} onOpenChange={setEdition}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Corriger cette entrée</DialogTitle>
            <DialogDescription>
              La phase d&apos;origine est conservée : elle dit ce qu&apos;était ce
              client au moment où tu as travaillé.
            </DialogDescription>
          </DialogHeader>

          <FormulaireEntree
            clients={clients}
            initiales={{
              clientId: entree.client_id,
              task: entree.task,
              minutes: entree.duration_minutes ?? 15,
              jour: aujourdhui,
              note: entree.note ?? "",
            }}
            avecDate={false}
            maxJour={aujourdhui}
            pending={pending}
            libelleAction="Enregistrer"
            onValider={enregistrer}
            onAnnuler={() => setEdition(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={suppression} onOpenChange={setSuppression}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette entrée ?</AlertDialogTitle>
            <AlertDialogDescription>
              {entree.clientNom} · {libelleTache(entree.task)} —{" "}
              {formatDuree(entree.duration_minutes ?? 0)}. Ces minutes
              disparaîtront de tes totaux.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evenement) => {
                evenement.preventDefault();
                effacer();
              }}
              disabled={pending}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

// ----------------------------- La saisie manuelle ----------------------------

/**
 * L'oubli qu'on rattrape : trois champs obligatoires, dix secondes.
 *
 * La date par défaut est aujourd'hui et ne va jamais au-delà — le navigateur
 * le tient par l'attribut `max`, l'action le revérifie. Une heure comptée
 * demain n'est pas une erreur de saisie, c'est une prévision, et Pulsar ne
 * mesure que ce qui a eu lieu.
 */
function Saisie({
  orgSlug,
  clients,
  aujourdhui,
  ouverte,
  onFermer,
}: {
  orgSlug: string;
  clients: ClientPulsar[];
  aujourdhui: string;
  ouverte: boolean;
  onFermer: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const premier = clients[0]?.id ?? "";

  const enregistrer = (valeurs: Valeurs) =>
    startTransition(async () => {
      const resultat = await saisir(orgSlug, valeurs);

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      onFermer();
      toast.success(`${formatDuree(resultat.data.minutes)} ajoutées`);
      router.refresh();
    });

  return (
    <Dialog open={ouverte} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter une heure</DialogTitle>
          <DialogDescription>
            Pour ce que tu as fait sans lancer le chronomètre.
          </DialogDescription>
        </DialogHeader>

        {/* Le formulaire se remonte à chaque ouverture : sans cette clé, il
            garderait la saisie précédente, durée comprise. */}
        <FormulaireEntree
          key={ouverte ? "ouverte" : "fermee"}
          clients={clients}
          initiales={valeursParDefaut(premier, aujourdhui)}
          avecDate
          maxJour={aujourdhui}
          pending={pending}
          libelleAction="Ajouter"
          onValider={enregistrer}
          onAnnuler={onFermer}
        />
      </DialogContent>
    </Dialog>
  );
}
