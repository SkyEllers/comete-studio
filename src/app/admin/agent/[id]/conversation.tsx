"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { avancerHorloge, repondre, supprimerSimulation } from "../actions";

type Message = {
  id: string;
  sens: string;
  genre: string;
  modele: string | null;
  texte: string;
  boutons: string[];
  statut: string;
  erreur: string | null;
  created_at: string;
};

const MODELES: Record<string, string> = {
  reservation: "modèle 1 · après la réservation",
  rappel: "modèle 2 · rappel",
  veille: "modèle 3 · la veille",
  matin: "modèle 4 · le matin même",
  preparation: "modèle 5 · préparation",
};

const heure = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** Le fil, vu depuis son téléphone : l'agent à gauche, elle à droite. */
export function Fil({ messages, pied }: { messages: Message[]; pied: string | null }) {
  if (messages.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun message pour l&apos;instant.</p>;
  }
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        const agent = m.sens === "sortant";
        return (
          <li key={m.id} className={cn("flex", agent ? "justify-start" : "justify-end")}>
            <div
              className={cn(
                "max-w-[85%] rounded-lg border px-3 py-2 text-sm",
                agent ? "border-line bg-surface-1" : "border-ember/40 bg-ember/10",
              )}
            >
              <p className="text-muted-foreground mb-1 font-mono text-[11px]">
                {heure(m.created_at)}
                {m.modele ? ` · ${MODELES[m.modele] ?? m.modele}` : null}
                {agent && m.genre === "libre" ? " · libre" : null}
              </p>
              <p className="whitespace-pre-line">{m.texte}</p>
              {agent && m.genre === "modele" && pied ? (
                <p className="text-muted-foreground mt-1 text-xs">{pied}</p>
              ) : null}
              {m.boutons.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.boutons.map((b) => (
                    <span key={b} className="border-line rounded-md border px-2 py-1 text-xs">
                      {b}
                    </span>
                  ))}
                </div>
              ) : null}
              {m.statut === "echec" ? (
                <p className="text-destructive mt-1 text-xs">Non parti : {m.erreur}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Louis, dans le rôle de la cliente. */
export function Repondre({
  id,
  boutons,
  desactive,
}: {
  id: string;
  boutons: string[];
  desactive: boolean;
}) {
  // React vide le formulaire tout seul une fois l'action finie.
  const [etat, action, enCours] = useActionState(repondre, null);

  return (
    <form action={action} className="border-line mt-6 space-y-2 border-t pt-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-muted-foreground text-xs">Tu es la cliente. Réponds comme elle le ferait.</p>
      {boutons.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {boutons.map((b) => (
            <Button
              key={b}
              type="submit"
              name="bouton"
              value={b}
              variant="outline"
              size="sm"
              disabled={enCours || desactive}
            >
              {b}
            </Button>
          ))}
        </div>
      ) : null}
      <Textarea name="texte" rows={2} placeholder="Ton message…" disabled={enCours || desactive} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={enCours || desactive}>
          Envoyer
        </Button>
        {desactive ? (
          <span className="text-muted-foreground text-xs">La conversation est close.</span>
        ) : null}
        {etat && !etat.ok ? <span className="text-destructive text-xs">{etat.error}</span> : null}
      </div>
    </form>
  );
}

const SAUTS = [
  { vers: "heure", libelle: "+1 heure" },
  { vers: "jour", libelle: "+1 jour" },
  { vers: "10h", libelle: "Prochain 10h" },
  { vers: "veille", libelle: "La veille, 10h" },
  { vers: "matin", libelle: "Le matin même" },
  { vers: "apres", libelle: "Après le rendez-vous" },
];

export function Horloge({ id }: { id: string }) {
  const [etat, action, enCours] = useActionState(avancerHorloge, null);
  return (
    <form action={action} className="border-line bg-surface-1 rounded-lg border p-4">
      <input type="hidden" name="id" value={id} />
      <p className="mb-2 text-sm">Avancer l&apos;horloge</p>
      <div className="flex flex-wrap gap-2">
        {SAUTS.map((s) => (
          <Button key={s.vers} type="submit" name="vers" value={s.vers} size="sm" variant="outline" disabled={enCours}>
            {s.libelle}
          </Button>
        ))}
      </div>
      {etat && !etat.ok ? <p className="text-destructive mt-2 text-xs">{etat.error}</p> : null}
    </form>
  );
}

export function Supprimer({ id }: { id: string }) {
  const [etat, action, enCours] = useActionState(supprimerSimulation, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" disabled={enCours}>
        Supprimer cette simulation
      </Button>
      {etat && !etat.ok ? <p className="text-destructive mt-2 text-xs">{etat.error}</p> : null}
    </form>
  );
}
