"use client";

import { CalendarX2, Check, Undo2, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { marquerStatut } from "@/app/app/[orgSlug]/(tools)/resultats/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { dateHeure, heure, jour, montant, statutLisible } from "./format";
import type { Canal, RendezVous } from "./queries";

/**
 * La liste des rendez-vous et la fiche qui s'ouvre dessous.
 *
 * Pensée pour un téléphone : on lit une ligne d'un coup d'œil — l'heure, la
 * séance, d'où elle vient, combien — et on tape pour le détail. Les actions
 * vivent dans la fiche et non dans la liste : marquer « non venu » par erreur
 * en faisant défiler retirerait une séance de la commission sans que personne
 * ne s'en aperçoive.
 */

export type Activite = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
  profiles: { full_name: string } | null;
};

const LIBELLES_ACTIVITE: Record<string, string> = {
  "booking.created": "Rendez-vous reçu de Calendly",
  "booking.rescheduled": "Reprogrammé depuis une autre séance",
  "booking.canceled": "Annulé dans Calendly",
  "status.changed": "Statut modifié",
  "channel.changed": "Canal corrigé",
};

/** « Google Ads, via récurrence : séance du 12 mars ». */
function origine(
  rdv: RendezVous,
  canal: Canal | null,
  sources: Map<string, string>,
): string {
  const nom = canal?.label ?? "Sans canal";

  if (rdv.attribution === "manuel") {
    return `${nom}, corrigé par Louis${rdv.attribution_note ? ` : ${rdv.attribution_note}` : ""}`;
  }

  if (rdv.attribution === "recurrence") {
    const depuis = rdv.attribution_source_id
      ? sources.get(rdv.attribution_source_id)
      : null;
    return depuis
      ? `${nom}, via récurrence : séance du ${jour(depuis)}`
      : `${nom}, via récurrence`;
  }

  if (rdv.attribution === "utm") return `${nom}, via la campagne d'origine`;
  return `${nom} : aucune campagne, aucune séance récente`;
}

export function ListeRendezVous({
  orgSlug,
  rendezVous,
  canaux,
  activites,
  sourcesAttribution,
  moisCloture,
}: {
  orgSlug: string;
  rendezVous: RendezVous[];
  canaux: Canal[];
  activites: Record<string, Activite[]>;
  /** Date de la séance qui a transmis son canal, par identifiant. */
  sourcesAttribution: Record<string, string>;
  moisCloture: boolean;
}) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  const parCanal = new Map(canaux.map((canal) => [canal.id, canal]));
  const sources = new Map(Object.entries(sourcesAttribution));
  const choisi = rendezVous.find((rdv) => rdv.id === ouvert) ?? null;

  const changer = (bookingId: string, statut: string) =>
    startTransition(async () => {
      const resultat = await marquerStatut(orgSlug, { bookingId, statut });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      setOuvert(null);
      router.refresh();
    });

  // Groupées par jour : c'est ainsi qu'on se souvient d'une semaine.
  const parJour = new Map<string, RendezVous[]>();
  for (const rdv of rendezVous) {
    const cle = jour(rdv.scheduled_start);
    parJour.set(cle, [...(parJour.get(cle) ?? []), rdv]);
  }

  return (
    <>
      <div className="space-y-6">
        {[...parJour.entries()].map(([date, lignes]) => (
          <section key={date} className="space-y-2">
            <h2 className="text-muted-foreground font-mono text-xs">{date}</h2>
            <ul className="border-line divide-line divide-y overflow-hidden rounded-lg border">
              {lignes.map((rdv) => {
                const canal = rdv.channel_id ? parCanal.get(rdv.channel_id) : null;
                const declareDiverge =
                  rdv.declared_source &&
                  canal &&
                  !canal.label.toLowerCase().includes(rdv.declared_source.toLowerCase());

                return (
                  <li key={rdv.id}>
                    <button
                      type="button"
                      onClick={() => setOuvert(rdv.id)}
                      className="hover:bg-surface-2 flex w-full items-start gap-3 p-3 text-left transition-colors"
                    >
                      <span className="text-muted-foreground w-12 shrink-0 font-mono text-xs">
                        {heure(rdv.scheduled_start)}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {rdv.event_type_name}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant={canal?.is_comete ? "default" : "outline"}>
                            {canal?.label ?? "Sans canal"}
                          </Badge>
                          {declareDiverge ? (
                            <span className="text-muted-foreground text-xs">
                              déclaré : {rdv.declared_source}
                            </span>
                          ) : null}
                        </span>
                      </span>

                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-sm tabular-nums">
                          {montant(rdv.amount_cents, rdv.currency)}
                        </span>
                        <span
                          className={cn(
                            "mt-1 block text-xs",
                            rdv.effective_status === "honore" && "text-success",
                            (rdv.effective_status === "annule" ||
                              rdv.effective_status === "no_show") &&
                              "text-muted-foreground",
                          )}
                        >
                          {statutLisible(rdv.effective_status)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <Sheet open={choisi !== null} onOpenChange={(valeur) => !valeur && setOuvert(null)}>
        <SheetContent side="bottom" className="max-h-[88svh] overflow-y-auto">
          {choisi ? (
            <FicheRendezVous
              rdv={choisi}
              canal={choisi.channel_id ? (parCanal.get(choisi.channel_id) ?? null) : null}
              activites={activites[choisi.id] ?? []}
              sources={sources}
              moisCloture={moisCloture}
              enCours={enCours}
              onChanger={changer}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Ligne({ label, valeur }: { label: string; valeur: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="text-right text-sm">{valeur}</dd>
    </div>
  );
}

function FicheRendezVous({
  rdv,
  canal,
  activites,
  sources,
  moisCloture,
  enCours,
  onChanger,
}: {
  rdv: RendezVous;
  canal: Canal | null;
  activites: Activite[];
  sources: Map<string, string>;
  moisCloture: boolean;
  enCours: boolean;
  onChanger: (bookingId: string, statut: string) => void;
}) {
  const modifiable = rdv.status !== "honore";

  return (
    <>
      <SheetHeader>
        <SheetTitle>{rdv.event_type_name}</SheetTitle>
        <SheetDescription>{dateHeure(rdv.scheduled_start)}</SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-6">
        <dl className="divide-line divide-y">
          <Ligne label="Statut" valeur={statutLisible(rdv.effective_status)} />
          <Ligne label="D'où elle vient" valeur={origine(rdv, canal, sources)} />
          {rdv.declared_source ? (
            <Ligne label="Réponse à « comment m'avez-vous connu ? »" valeur={rdv.declared_source} />
          ) : null}
          <Ligne label="Montant" valeur={montant(rdv.amount_cents, rdv.currency)} />
          <Ligne
            label="Paiement"
            valeur={rdv.payment_ok ? "Réussi" : "Aucun paiement enregistré"}
          />
          {rdv.payment_ref ? (
            <Ligne
              label="Référence"
              valeur={<span className="font-mono text-xs">{rdv.payment_ref}</span>}
            />
          ) : null}
          <Ligne
            label="Compte dans la commission"
            valeur={rdv.counts_for_commission ? "Oui" : "Non"}
          />
          {rdv.status_note ? <Ligne label="Note" valeur={rdv.status_note} /> : null}
        </dl>

        {moisCloture ? (
          <p className="border-line text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            Le relevé de ce mois est clôturé : les statuts n&apos;y changent plus.
            Si quelque chose te semble faux, conteste le relevé — Louis corrigera
            et le re-clôturera.
          </p>
        ) : modifiable ? (
          <div className="flex flex-wrap gap-2">
            {rdv.status !== "no_show" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={enCours}
                onClick={() => onChanger(rdv.id, "no_show")}
              >
                <UserX aria-hidden="true" />
                Elle n&apos;est pas venue
              </Button>
            ) : null}

            {rdv.status !== "annule" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={enCours}
                onClick={() => onChanger(rdv.id, "annule")}
              >
                <CalendarX2 aria-hidden="true" />
                Annulée
              </Button>
            ) : null}

            {rdv.status !== "confirme" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={enCours}
                onClick={() => onChanger(rdv.id, "confirme")}
              >
                <Undo2 aria-hidden="true" />
                Rétablir
              </Button>
            ) : null}
          </div>
        ) : null}

        {activites.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs">Ce qui s&apos;est passé</h3>
            <ul className="space-y-2">
              {activites.map((activite) => (
                <li key={activite.id} className="flex items-start gap-2 text-xs">
                  <Check
                    aria-hidden="true"
                    className="text-muted-foreground mt-0.5 size-3 shrink-0"
                  />
                  <span>
                    {LIBELLES_ACTIVITE[activite.type] ?? activite.type}
                    <span className="text-muted-foreground">
                      {" · "}
                      {dateHeure(activite.created_at)}
                      {activite.profiles?.full_name ? ` · ${activite.profiles.full_name}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

/**
 * Le bloc « À vérifier » du tableau de bord.
 *
 * Une séance passée que personne n'a contestée compte comme honorée, donc dans
 * la commission. La montrer ici, avec un bouton direct, c'est laisser au client
 * l'occasion de dire non avant que le mois se clôture.
 */
export function AVerifier({
  orgSlug,
  lignes,
  canaux,
}: {
  orgSlug: string;
  lignes: RendezVous[];
  canaux: Canal[];
}) {
  const [enCours, startTransition] = useTransition();
  const router = useRouter();
  const parCanal = new Map(canaux.map((canal) => [canal.id, canal]));

  const marquer = (bookingId: string) =>
    startTransition(async () => {
      const resultat = await marquerStatut(orgSlug, { bookingId, statut: "no_show" });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      router.refresh();
    });

  return (
    <ul className="border-line divide-line divide-y overflow-hidden rounded-lg border">
      {lignes.map((rdv) => (
        <li key={rdv.id} className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{rdv.event_type_name}</p>
            <p className="text-muted-foreground font-mono text-xs">
              {dateHeure(rdv.scheduled_start)} ·{" "}
              {parCanal.get(rdv.channel_id ?? "")?.label ?? "Sans canal"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={enCours}
            onClick={() => marquer(rdv.id)}
          >
            <UserX aria-hidden="true" />
            Non venue
          </Button>
        </li>
      ))}
    </ul>
  );
}
