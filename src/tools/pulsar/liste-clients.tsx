"use client";

import {
  Archive,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  archiverClient,
  enregistrerClient,
  supprimerClient,
} from "@/app/app/[orgSlug]/(tools)/temps/actions";
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
import { cn } from "@/lib/utils";

import { formatDuree } from "./duree";
import {
  envoiDeLaFiche,
  FormulaireFiche,
  valeursDeLaFiche,
  type ValeursFiche,
} from "./fiche";
import { euros, tauxLisible, type BilanClient } from "./revenus";
import { libelleModele, libelleProfil, libelleStatut, libelleTache } from "./types";

/**
 * L'écran Par client : où passe le temps, et ce que chaque heure rapporte.
 *
 * Une ligne par client, la plus lourde du mois en haut. Elle se déplie sur
 * place plutôt que de mener ailleurs : la question « et lui, il m'a pris
 * combien ? » se pose en passant, et changer de page pour y répondre coûte
 * plus cher que la réponse.
 *
 * L'orange ne dit pas « erreur », il dit « regarde ça ». Deux raisons
 * seulement, et jamais de notification : un taux sous le seuil, ou un
 * pilotage qui déborde. Le reste est du gris.
 */

export function ListeClients({
  orgSlug,
  bilans,
  mois,
}: {
  orgSlug: string;
  bilans: BilanClient[];
  mois: string;
}) {
  const [creation, setCreation] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const creer = (valeurs: ValeursFiche) =>
    startTransition(async () => {
      const resultat = await enregistrerClient(orgSlug, envoiDeLaFiche(valeurs));

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      setCreation(false);
      toast.success("Client créé");
      router.refresh();
    });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground font-mono text-xs tracking-wide">
          Par client
        </h2>

        <Button variant="outline" size="sm" onClick={() => setCreation(true)}>
          <Plus aria-hidden="true" />
          Nouveau client
        </Button>
      </div>

      {bilans.length === 0 ? (
        <div className="border-line bg-surface-1 rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="font-display font-semibold">Aucun client dans ton carnet</p>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Crée une fiche pour commencer à chronométrer.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {bilans.map((bilan) => (
            <LigneClient
              key={bilan.client.id}
              orgSlug={orgSlug}
              bilan={bilan}
              mois={mois}
            />
          ))}
        </ul>
      )}

      <Dialog open={creation} onOpenChange={setCreation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau client</DialogTitle>
            <DialogDescription>
              Ce que tu as vendu, à qui, et depuis quand. Les chiffres se
              déduisent d&apos;ici.
            </DialogDescription>
          </DialogHeader>

          <FormulaireFiche
            key={creation ? "ouverte" : "fermee"}
            initiales={valeursDeLaFiche()}
            pending={pending}
            libelleAction="Créer"
            onValider={creer}
            onAnnuler={() => setCreation(false)}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}

// --------------------------------- Une ligne ---------------------------------

function LigneClient({
  orgSlug,
  bilan,
  mois,
}: {
  orgSlug: string;
  bilan: BilanClient;
  mois: string;
}) {
  const [depliee, setDepliee] = useState(false);
  const [menu, setMenu] = useState(false);
  const [edition, setEdition] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [pending, startTransition] = useTransition();
  const declencheur = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const { client } = bilan;
  const enAlerte = bilan.alerteTaux || bilan.alerteHeures;

  /*
   * Agir depuis le menu — le même motif que les lignes d'entrée de la journée.
   *
   * Laissé à lui-même, le menu se referme sur la sélection et rend le focus à
   * son bouton, hors de la fenêtre qui vient de s'ouvrir, qui se referme
   * aussitôt. L'empêcher de se fermer ne valait pas mieux : il restait ouvert,
   * modal, et la page ne répondait plus une fois la fenêtre fermée. On le ferme
   * donc soi-même, sans le laisser reprendre le focus, et c'est la fenêtre qui
   * rend le focus au bouton en partant.
   */
  const depuisLeMenu = (agirEnsuite: () => void) => (evenement: Event) => {
    evenement.preventDefault();
    setMenu(false);
    agirEnsuite();
  };

  const rendreLeFocus = (evenement: Event) => {
    evenement.preventDefault();
    declencheur.current?.focus();
  };

  const agir = (
    action: () => Promise<{ ok: boolean; error?: string }>,
    succes: string,
    apres?: () => void,
  ) =>
    startTransition(async () => {
      const resultat = await action();

      if (!resultat.ok) {
        toast.error(resultat.error ?? "Ça n'a pas marché.");
        return;
      }

      apres?.();
      toast.success(succes);
      router.refresh();
    });

  return (
    <li
      className={cn(
        "border-line bg-surface-1 rounded-lg border",
        enAlerte && "border-warning/40",
        client.statut === "termine" && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          onClick={() => setDepliee((ouvert) => !ouvert)}
          aria-expanded={depliee}
          className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          <span className="flex items-center gap-1.5">
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "text-muted-foreground size-4 shrink-0 transition-transform",
                depliee && "rotate-90",
              )}
            />
            <span className="truncate font-medium">{client.name}</span>
          </span>

          <span className="text-muted-foreground mt-0.5 block pl-5.5 text-xs">
            {libelleModele(client.modele)}
            {" · "}
            {libelleStatut(client.statut)}
            {client.profil ? ` · ${libelleProfil(client.profil)}` : null}
          </span>
        </button>

        <div className="shrink-0 text-right">
          <p className="font-mono text-sm tabular-nums">
            {formatDuree(bilan.minutesDuMois)}
          </p>
          <p className="text-muted-foreground font-mono text-xs tabular-nums">
            {euros(bilan.encaisseCents)} · {tauxLisible(bilan.tauxCents)}
            {bilan.base === "cumule" ? (
              <span className="text-muted-foreground"> cumulé</span>
            ) : null}
          </p>
        </div>

        {client.is_internal ? (
          <span className="w-7 shrink-0" aria-hidden="true" />
        ) : (
          <DropdownMenu open={menu} onOpenChange={setMenu}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={declencheur}
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={`Menu de ${client.name}`}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(evenement) => evenement.preventDefault()}
            >
              <DropdownMenuItem onSelect={depuisLeMenu(() => setEdition(true))}>
                <Pencil aria-hidden="true" />
                Modifier la fiche
              </DropdownMenuItem>

              {client.statut === "termine" ? null : (
                <DropdownMenuItem
                  onSelect={depuisLeMenu(() =>
                    agir(() => archiverClient(orgSlug, client.id), "Client archivé"),
                  )}
                >
                  <Archive aria-hidden="true" />
                  Archiver
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="text-destructive"
                onSelect={depuisLeMenu(() => setSuppression(true))}
              >
                <Trash2 aria-hidden="true" />
                Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {enAlerte ? (
        <p className="text-warning flex items-start gap-1.5 px-3 pb-3 text-xs">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {bilan.alerteTaux
              ? `${tauxLisible(bilan.tauxCents)} ce mois-ci, sous ton seuil.`
              : null}
            {bilan.alerteTaux && bilan.alerteHeures ? " " : null}
            {bilan.alerteHeures
              ? `${formatDuree(bilan.minutesDuMois)} de pilotage, au-dessus de ton plafond.`
              : null}
          </span>
        </p>
      ) : null}

      {depliee ? (
        <div className="border-line space-y-4 border-t p-3">
          <Repartition bilan={bilan} />

          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${orgSlug}/temps/clients/${client.id}?mois=${mois}`} prefetch>
              Voir le détail du mois
            </Link>
          </Button>
        </div>
      ) : null}

      <Dialog open={edition} onOpenChange={setEdition}>
        <DialogContent onCloseAutoFocus={rendreLeFocus}>
          <DialogHeader>
            <DialogTitle>Fiche de {client.name}</DialogTitle>
            <DialogDescription>
              Les heures déjà comptées gardent leur phase : corriger une fiche ne
              réécrit pas l&apos;histoire.
            </DialogDescription>
          </DialogHeader>

          <FormulaireFiche
            initiales={valeursDeLaFiche(client)}
            pending={pending}
            libelleAction="Enregistrer"
            onValider={(valeurs) =>
              agir(
                () => enregistrerClient(orgSlug, envoiDeLaFiche(valeurs)),
                "Fiche enregistrée",
                () => setEdition(false),
              )
            }
            onAnnuler={() => setEdition(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={suppression} onOpenChange={setSuppression}>
        <AlertDialogContent onCloseAutoFocus={rendreLeFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer {client.name} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Dès qu&apos;une heure a été comptée sur ce client, la base refuse :
              archive-le plutôt, il sortira des listes du chronomètre et ses
              heures resteront dans tes chiffres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evenement) => {
                evenement.preventDefault();
                agir(() => supprimerClient(orgSlug, client.id), "Client supprimé", () =>
                  setSuppression(false),
                );
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

// ------------------------------ Les répartitions -----------------------------

/**
 * Setup contre pilotage, puis les types de tâche en barres.
 *
 * Les barres sont proportionnelles à la plus longue, pas au total : à
 * l'échelle du total, un mois éclaté en six tâches ne montre que des traits.
 */
export function Repartition({ bilan }: { bilan: BilanClient }) {
  const plusLongue = bilan.taches[0]?.minutes ?? 0;
  const { setup, pilotage, interne } = bilan.phases;
  const total = setup + pilotage + interne;

  if (total === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucune heure comptée sur ce mois.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-muted-foreground font-mono text-xs">Phases</p>
        <p className="text-sm">
          {[
            setup > 0 ? `${formatDuree(setup)} de setup` : null,
            pilotage > 0 ? `${formatDuree(pilotage)} de pilotage` : null,
            interne > 0 ? `${formatDuree(interne)} en interne` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-muted-foreground text-xs">
          Cumulé depuis le début : {formatDuree(bilan.minutesCumulees)}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-muted-foreground font-mono text-xs">Types de tâche</p>
        <ul className="space-y-1">
          {bilan.taches.map((part) => (
            <li key={part.task} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 truncate">{libelleTache(part.task)}</span>
              <span className="bg-surface-2 h-2 flex-1 overflow-hidden rounded-full">
                <span
                  className="bg-ember block h-full rounded-full"
                  style={{
                    width: `${plusLongue === 0 ? 0 : Math.round((part.minutes / plusLongue) * 100)}%`,
                  }}
                />
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">
                {formatDuree(part.minutes)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
