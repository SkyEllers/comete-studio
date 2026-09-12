"use client";

import { Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { arreter, demarrer, noter } from "@/app/app/[orgSlug]/(tools)/temps/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { formatChrono, formatDuree } from "./duree";
import { Puce } from "./formulaire";
import {
  libelleTache,
  LIMITE_NOTE,
  TACHES,
  type ClientPulsar,
  type Entree,
} from "./types";

/**
 * Le chronomètre : deux taps pour partir, un pour s'arrêter.
 *
 * Le premier tap choisit le client, le second le type — dans l'ordre qu'on
 * veut : c'est le second, quel qu'il soit, qui lance. Pas de bouton
 * « Démarrer » en plus, parce qu'il serait toujours le troisième tap, et que
 * dix secondes de saisie se perdent là.
 *
 * Les puces restent affichées pendant la course, sous le titre « Passer à
 * autre chose » : changer de client au milieu de la journée est le geste le
 * plus fréquent de l'outil. L'ancien chronomètre s'arrête, arrondi et
 * enregistré, et le toast dit ce qui vient d'être compté — une information,
 * jamais un blocage.
 *
 * Ce qui défile n'est qu'un compteur local calé sur `started_at`. Le
 * chronomètre, lui, vit en base : il survit à la fermeture du téléphone et
 * s'arrête depuis n'importe quel appareil.
 */

export function Chrono({
  orgSlug,
  clients,
  enCours,
  nomEnCours,
}: {
  orgSlug: string;
  clients: ClientPulsar[];
  enCours: Entree | null;
  nomEnCours: string | null;
}) {
  const [client, setClient] = useState<string | null>(null);
  const [tache, setTache] = useState<Entree["task"] | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const lancer = (clientId: string, task: Entree["task"]) => {
    setClient(null);
    setTache(null);

    startTransition(async () => {
      const resultat = await demarrer(orgSlug, { clientId, task });

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      const remplace = resultat.data.remplace;
      toast.success(
        remplace
          ? `${remplace.client} : ${formatDuree(remplace.minutes)} comptées. C'est parti sur la suite.`
          : "C'est parti.",
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
      {enCours ? (
        /* La clé remonte la carte à chaque nouveau chronomètre : la note du
           précédent ne doit pas rester dans le champ du suivant. */
        <CarteEnCours
          key={enCours.id}
          orgSlug={orgSlug}
          entree={enCours}
          client={nomEnCours}
        />
      ) : null}

      <div className="space-y-3">
        <h2 className="text-muted-foreground font-mono text-xs tracking-wide">
          {enCours ? "Passer à autre chose" : "Sur quoi tu travailles ?"}
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
    </section>
  );
}

/**
 * La carte du chronomètre en marche.
 *
 * Elle porte sa propre note, et c'est pour ça qu'elle est à part : montée à
 * neuf pour chaque entrée, elle n'a aucun état à recopier quand le
 * chronomètre change — ni effet, ni synchronisation, ni note d'un client qui
 * traînerait sur le suivant.
 *
 * La note part deux fois plutôt qu'une : en quittant le champ, et dans
 * l'écriture qui arrête. La première parce qu'un chronomètre démarré sur le
 * téléphone s'arrête souvent depuis l'ordinateur ; la seconde parce qu'on
 * appuie sur Arrêter sans toujours sortir du champ d'abord.
 */
function CarteEnCours({
  orgSlug,
  entree,
  client,
}: {
  orgSlug: string;
  entree: Entree;
  client: string | null;
}) {
  const [note, setNote] = useState(entree.note ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const stopper = () =>
    startTransition(async () => {
      const resultat = await arreter(orgSlug, note);

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

  return (
    <div className="border-ember/40 bg-surface-1 space-y-4 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate">
          <span className="font-medium">{client}</span>
          <span className="text-muted-foreground">
            {" · "}
            {libelleTache(entree.task)}
          </span>
        </p>
        <Compteur depuis={entree.started_at} />
      </div>

      <Input
        value={note}
        maxLength={LIMITE_NOTE}
        placeholder="Une note, si tu veux"
        aria-label="Note du chronomètre en cours"
        onChange={(evenement) => setNote(evenement.target.value)}
        onBlur={() => {
          if (note === (entree.note ?? "")) return;
          void noter(orgSlug, note);
        }}
      />

      <Button onClick={stopper} disabled={pending} className="h-12 w-full text-base">
        <Square aria-hidden="true" />
        Arrêter
      </Button>
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
