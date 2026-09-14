"use client";

import { ChevronRight, Pencil, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  arreter,
  corriger,
  demarrer,
  noter,
} from "@/app/app/[orgSlug]/(tools)/temps/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { formatChrono, formatDuree } from "./duree";
import { FormulaireEntree, Puce, versCorrection, type Valeurs } from "./formulaire";
import {
  libelleTache,
  LIMITE_NOTE,
  PLAFOND_CHRONOS,
  TACHES,
  type ClientPulsar,
  type Entree,
} from "./types";

/**
 * Les chronomètres : deux taps pour en lancer un, un pour l'arrêter.
 *
 * Le premier tap choisit le client, le second le type — dans l'ordre qu'on
 * veut : c'est le second, quel qu'il soit, qui lance. Pas de bouton
 * « Démarrer » en plus, parce qu'il serait toujours le troisième tap, et que
 * dix secondes de saisie se perdent là.
 *
 * Lancer n'arrête rien : chaque chronomètre a sa carte, et les puces restent
 * dessous pour en ajouter un. Deux sur le même créneau sont un choix, pas une
 * erreur — l'écran ne les compare pas, ne les signale pas. À quatre, les puces
 * laissent place à la phrase du plafond : le cinquième ne serait pas du
 * travail en plus, ce serait un oubli, et on le dit avant le tap plutôt
 * qu'après.
 *
 * Ce qui défile n'est qu'un compteur local calé sur `started_at`. Les
 * chronomètres, eux, vivent en base : ils survivent à la fermeture du
 * téléphone et s'arrêtent depuis n'importe quel appareil.
 */

export type ChronoAffiche = Entree & {
  clientNom: string;
  /** « 14:07 », ou « 12/09 16:40 » pour un chronomètre parti un autre jour. */
  depuis: string;
};

export function Chrono({
  orgSlug,
  clients,
  tous,
  enCours,
  aujourdhui,
}: {
  orgSlug: string;
  /** Les clients qu'on peut lancer : les archivés n'y sont pas. */
  clients: ClientPulsar[];
  /** Tous les clients, pour corriger un chronomètre dont le dossier a fermé. */
  tous: ClientPulsar[];
  enCours: ChronoAffiche[];
  aujourdhui: string;
}) {
  const [client, setClient] = useState<string | null>(null);
  const [tache, setTache] = useState<Entree["task"] | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const complet = enCours.length >= PLAFOND_CHRONOS;

  const lancer = (clientId: string, task: Entree["task"]) => {
    setClient(null);
    setTache(null);

    startTransition(async () => {
      const resultat = await demarrer(orgSlug, { clientId, task });

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      const nombre = resultat.data.enCours;
      toast.success(
        nombre > 1 ? `C'est parti. ${nombre} chronomètres tournent.` : "C'est parti.",
      );
      router.refresh();
    });
  };

  const choisirClient = (id: string) => {
    if (tache) return lancer(id, tache);
    setClient(id);
  };

  const choisirTache = (valeur: Entree["task"]) => {
    if (client) return lancer(client, valeur);
    setTache(valeur);
  };

  return (
    <section className="space-y-5">
      {enCours.length > 0 ? (
        <ul className="space-y-3">
          {enCours.map((entree) => (
            /* La clé remonte la carte à chaque chronomètre : la note de l'un ne
               doit pas rester dans le champ d'un autre. */
            <li key={entree.id}>
              <CarteEnCours
                orgSlug={orgSlug}
                entree={entree}
                tous={tous}
                aujourdhui={aujourdhui}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {complet ? (
        <p className="border-line text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">
          Quatre chronomètres tournent. Arrête-en un d&apos;abord.
        </p>
      ) : (
        <div className="space-y-3">
          <h2 className="text-muted-foreground font-mono text-xs tracking-wide">
            {enCours.length > 0 ? "En lancer un autre" : "Sur quoi tu travailles ?"}
          </h2>

          <div className="flex flex-wrap gap-1.5">
            {clients.map((candidat) => (
              <Puce
                key={candidat.id}
                label={candidat.name}
                actif={client === candidat.id}
                disabled={pending}
                onClick={() => choisirClient(candidat.id)}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TACHES.map((candidate) => (
              <Puce
                key={candidate.valeur}
                label={candidate.label}
                actif={tache === candidate.valeur}
                disabled={pending}
                onClick={() => choisirTache(candidate.valeur)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * La carte d'un chronomètre en marche.
 *
 * Elle porte sa propre note, et c'est pour ça qu'elle est à part : montée à
 * neuf pour chaque entrée, elle n'a aucun état à recopier quand la liste
 * change — ni effet, ni synchronisation, ni note d'un client qui traînerait
 * sur un autre.
 *
 * La note part deux fois plutôt qu'une : en quittant le champ, et dans
 * l'écriture qui arrête. La première parce qu'un chronomètre démarré sur le
 * téléphone s'arrête souvent depuis l'ordinateur ; la seconde parce qu'on
 * appuie sur Arrêter sans toujours sortir du champ d'abord.
 *
 * Le champ est replié tant qu'il n'y a rien à y lire : la carte n'a que
 * quatre choses à dire — sur quoi, depuis quand, et les deux boutons — et un
 * champ vide entre les deux repousse Arrêter sous le pouce. Il s'ouvre déjà
 * déplié quand une note existe, parce qu'une note qu'on a écrite et qu'on ne
 * voit plus est une note perdue.
 *
 * « Corriger » est à côté d'Arrêter, pas dans un menu : le chronomètre oublié
 * sur pause se découvre au moment d'arrêter, et c'est là qu'il faut pouvoir
 * dire « coupe à 45 min » plutôt que d'arrêter trois heures fausses pour les
 * reprendre ensuite.
 */
function CarteEnCours({
  orgSlug,
  entree,
  tous,
  aujourdhui,
}: {
  orgSlug: string;
  entree: ChronoAffiche;
  tous: ClientPulsar[];
  aujourdhui: string;
}) {
  const [note, setNote] = useState(entree.note ?? "");
  const [correction, setCorrection] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /*
   * Constante pour la durée de vie de la carte, qui est remontée à chaque
   * chronomètre : `autoFocus` ne vaut donc vrai que pour un champ ouvert au
   * doigt, jamais pour celui qu'on trouve déjà déplié en arrivant sur la page.
   */
  const avaitUneNote = Boolean(entree.note);
  const [depliee, setDepliee] = useState(avaitUneNote);

  const stopper = () =>
    startTransition(async () => {
      const resultat = await arreter(orgSlug, entree.id, note);

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      if (resultat.data) {
        toast.success(
          `${resultat.data.client} : ${formatDuree(resultat.data.minutes)} comptées.`,
        );
      }
      router.refresh();
    });

  const enregistrer = (valeurs: Valeurs) =>
    startTransition(async () => {
      const resultat = await corriger(orgSlug, {
        id: entree.id,
        clientId: valeurs.clientId,
        task: valeurs.task,
        note: valeurs.note,
        ...versCorrection(valeurs, true),
      });

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      setCorrection(false);
      setNote(valeurs.note);

      const arrete = resultat.data.arrete;
      toast.success(
        arrete
          ? `${arrete.client} : ${formatDuree(arrete.minutes)} comptées.`
          : "Chronomètre corrigé",
      );
      router.refresh();
    });

  return (
    <div className="border-ember/40 bg-surface-1 space-y-4 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate">
            <span className="font-medium">{entree.clientNom}</span>
            <span className="text-muted-foreground">
              {" · "}
              {libelleTache(entree.task)}
            </span>
          </p>
          <p className="text-muted-foreground font-mono text-xs tabular-nums">
            depuis {entree.depuis}
          </p>
        </div>
        <Compteur depuis={entree.started_at} />
      </div>

      {depliee ? (
        <Input
          value={note}
          autoFocus={!avaitUneNote}
          maxLength={LIMITE_NOTE}
          placeholder="Une note, si tu veux"
          aria-label={`Note du chronomètre ${entree.clientNom}`}
          onChange={(evenement) => setNote(evenement.target.value)}
          onBlur={() => {
            if (note === (entree.note ?? "")) return;
            void noter(orgSlug, entree.id, note);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setDepliee(true)}
          aria-expanded={false}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-sm text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{note.length > 0 ? note : "Ajouter une note"}</span>
        </button>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => setCorrection(true)}
          disabled={pending}
          className="h-12"
        >
          <Pencil aria-hidden="true" />
          Corriger
        </Button>
        <Button onClick={stopper} disabled={pending} className="h-12 flex-1 text-base">
          <Square aria-hidden="true" />
          Arrêter
        </Button>
      </div>

      <Dialog open={correction} onOpenChange={setCorrection}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Corriger ce chronomètre</DialogTitle>
            <DialogDescription>
              Parti trop tard : avance son début. Oublié en route : arrête-le à
              la durée qu&apos;il aurait dû compter.
            </DialogDescription>
          </DialogHeader>

          <FormulaireEntree
            clients={tous}
            entree={{ ...entree, note }}
            maxJour={aujourdhui}
            pending={pending}
            onValider={enregistrer}
            onAnnuler={() => setCorrection(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Le compteur qui défile.
 *
 * Rien n'est rendu au premier passage : l'écart entre `started_at` et
 * maintenant n'est pas le même sur le serveur et dans le navigateur, et React
 * le reprocherait à l'hydratation. La largeur est réservée en attendant, pour
 * que la ligne ne saute pas quand le chiffre arrive.
 */
export function Compteur({
  depuis,
  className = "font-mono text-2xl tabular-nums",
}: {
  depuis: string;
  className?: string;
}) {
  const [millisecondes, setMillisecondes] = useState<number | null>(null);

  useEffect(() => {
    const calculer = () => setMillisecondes(Date.now() - Date.parse(depuis));

    calculer();
    const battement = setInterval(calculer, 1000);
    return () => clearInterval(battement);
  }, [depuis]);

  return (
    <span className={className} aria-live="off">
      {millisecondes === null ? "—:—:—" : formatChrono(millisecondes)}
    </span>
  );
}
