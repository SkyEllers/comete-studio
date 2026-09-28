"use client";

import { ChevronDown, ClipboardList, Loader2, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { lireParcours, type Parcours } from "./actions";

/**
 * Le haut de la fiche de la cliente (P16) : sa réservation et ses réponses,
 * puis ce qui s'est passé avec l'assistante WhatsApp. Lecture seule, des
 * phrases courtes.
 */

const quand = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })
    .format(new Date(iso))
    .replace(":", "h");

const RAISONS: Record<string, string> = {
  empechement: "un empêchement",
  pas_le_moment: "pas le moment",
  budget: "le budget",
  plus_interessee: "plus intéressée",
  autre_solution: "une autre solution",
  autre: "autre",
};

function lignesWhatsapp(w: NonNullable<Parcours["whatsapp"]>): string[] {
  const l: string[] = [];
  if (w.etat === "hors_champ") return ["Réservé moins de 24 h avant : l'assistante ne lui a pas écrit."];
  l.push(w.premiereReponseLe ? `A répondu à l'assistante le ${quand(w.premiereReponseLe)}.` : "N'a pas encore répondu à l'assistante.");
  if (w.confirmeLe) l.push(`A confirmé le ${quand(w.confirmeLe)}.`);
  else if (w.sansReponseVeille) l.push("Sans réponse au rappel de la veille.");
  if (w.reportsAgent > 0) l.push(`Reporté ${w.reportsAgent} fois avec l'assistante.`);
  if (w.stopLe) l.push(`A demandé à ne plus recevoir de messages (${quand(w.stopLe)}).`);
  if (w.annuleeParAgentLe) {
    const raison = w.raisonCategorie ? RAISONS[w.raisonCategorie] ?? w.raisonCategorie : null;
    l.push(`Annulé avec l'assistante le ${quand(w.annuleeParAgentLe)}${raison ? `, raison : ${raison}` : ""}.`);
  }
  return l;
}

export function BlocParcours({ orgSlug, bookingId }: { orgSlug: string; bookingId: string }) {
  const [parcours, setParcours] = useState<Parcours | null>(null);
  const [fini, setFini] = useState(false);
  const [reponsesOuvertes, setReponsesOuvertes] = useState(false);

  useEffect(() => {
    let actif = true;
    lireParcours(orgSlug, bookingId).then((r) => {
      if (!actif) return;
      if (r.ok) setParcours(r.data);
      setFini(true);
    });
    return () => {
      actif = false;
    };
  }, [orgSlug, bookingId]);

  if (!fini) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        Son parcours…
      </p>
    );
  }
  if (!parcours || (!parcours.reservation && !parcours.whatsapp)) return null;

  return (
    <div className="space-y-4">
      {parcours.reservation ? (
        <section className="space-y-1.5">
          <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <ClipboardList aria-hidden="true" className="size-3.5" />
            Sa réservation
          </h3>
          {parcours.reservation.reserveLe ? <p className="text-sm">Réservé le {quand(parcours.reservation.reserveLe)}.</p> : null}
          {parcours.reservation.reponses.length > 0 ? (
            <>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs underline-offset-4 hover:underline"
                onClick={() => setReponsesOuvertes((v) => !v)}
                aria-expanded={reponsesOuvertes}
              >
                <ChevronDown aria-hidden="true" className={`size-3 transition-transform ${reponsesOuvertes ? "rotate-180" : ""}`} />
                {reponsesOuvertes ? "Cacher ses réponses" : `Ses ${parcours.reservation.reponses.length} réponses`}
              </button>
              {reponsesOuvertes ? (
                <dl className="space-y-2 text-sm">
                  {parcours.reservation.reponses.map((r) => (
                    <div key={r.question}>
                      <dt className="text-muted-foreground text-xs">{r.question}</dt>
                      <dd>{r.reponse}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {parcours.whatsapp ? (
        <section className="space-y-1.5">
          <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <MessageCircle aria-hidden="true" className="size-3.5" />
            Avec l&apos;assistante WhatsApp
          </h3>
          <ul className="space-y-0.5 text-sm">
            {lignesWhatsapp(parcours.whatsapp).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {parcours.whatsapp.notes.length > 0 ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Ce qu&apos;elle a dit : </span>
              {parcours.whatsapp.notes.join(" ")}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
