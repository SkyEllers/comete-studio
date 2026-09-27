"use client";

import { Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  ajouterAbsence,
  enregistrerHoraires,
  enregistrerMaximum,
  enregistrerVisio,
  retirerAbsence,
} from "@/app/app/[orgSlug]/agenda/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { absenceEnMots, JOURS, type PlageSaisie } from "./reglages";

/**
 * Les réglages de « Mon agenda » : trois sur un écran (horaires, absences,
 * maximum), plus la visio. Chacun s'enregistre à part : on ne perd jamais
 * une absence parce que les horaires avaient une faute.
 */

function Section({ titre, sousTitre, children }: { titre: string; sousTitre?: string; children: React.ReactNode }) {
  return (
    <section className="border-line space-y-4 rounded-lg border p-5">
      <div className="space-y-1">
        <h2 className="text-base font-medium">{titre}</h2>
        {sousTitre ? <p className="text-muted-foreground text-sm">{sousTitre}</p> : null}
      </div>
      {children}
    </section>
  );
}

// ------------------------------- Horaires ----------------------------------

/** « Paris », « Montréal » : la ville du fuseau, pour dire à quelle heure on parle. */
function ville(fuseau: string): string {
  const nom = (fuseau.split("/").at(-1) ?? fuseau).replace(/_/g, " ");
  return nom === "Montreal" ? "Montréal" : nom;
}

export function Horaires({
  orgSlug,
  initiales,
  fuseau,
}: {
  orgSlug: string;
  initiales: PlageSaisie[];
  fuseau: string;
}) {
  const [plages, setPlages] = useState<PlageSaisie[]>(initiales);
  const [enCours, demarrer] = useTransition();

  const changer = (i: number, champ: "debut" | "fin", valeur: string) =>
    setPlages((p) => p.map((x, j) => (j === i ? { ...x, [champ]: valeur } : x)));
  const ajouter = (jour: number) => {
    const du = plages.filter((p) => p.jour === jour);
    const derniere = du.at(-1);
    // Une nouvelle plage l'après-midi si le matin est pris, sinon le matin.
    const suivante = derniere && derniere.fin <= "13:00" ? { debut: "14:00", fin: "18:00" } : { debut: "09:00", fin: "12:00" };
    setPlages((p) => [...p, { jour, ...suivante }]);
  };
  const retirer = (i: number) => setPlages((p) => p.filter((_, j) => j !== i));

  const enregistrer = () =>
    demarrer(async () => {
      const r = await enregistrerHoraires(orgSlug, plages);
      if (r.ok) toast.success("Tes horaires sont enregistrés.");
      else toast.error(r.error);
    });

  return (
    <Section
      titre="Mes horaires habituels"
      sousTitre={`Les jours et les heures où tu peux prendre des diagnostics, chaque semaine. À l'heure de ${ville(fuseau)}.`}
    >
      {plages.length === 0 ? (
        <p className="text-warning text-sm">
          Aucun horaire pour l&apos;instant. Tant qu&apos;il n&apos;y en a pas, tu ne reçois aucun diagnostic.
        </p>
      ) : null}
      <div className="divide-line divide-y">
        {JOURS.map((nom, k) => {
          const jour = k + 1;
          const lignes = plages.map((p, i) => ({ p, i })).filter(({ p }) => p.jour === jour);
          return (
            <div key={nom} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
              <span className="w-24 shrink-0 pt-2 text-sm capitalize">{nom}</span>
              <div className="flex flex-1 flex-col gap-2">
                {lignes.map(({ p, i }) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="time"
                      step={900}
                      value={p.debut}
                      onChange={(e) => changer(i, "debut", e.target.value)}
                      className="w-28"
                      aria-label={`${nom}, début`}
                    />
                    <span className="text-muted-foreground text-sm">à</span>
                    <Input
                      type="time"
                      step={900}
                      value={p.fin}
                      onChange={(e) => changer(i, "fin", e.target.value)}
                      className="w-28"
                      aria-label={`${nom}, fin`}
                    />
                    <Button variant="ghost" size="icon" onClick={() => retirer(i)} aria-label="Retirer">
                      <X />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button variant="ghost" size="sm" onClick={() => ajouter(jour)} className="text-muted-foreground">
                    <Plus /> Ajouter une plage
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Button onClick={enregistrer} disabled={enCours}>
        Enregistrer mes horaires
      </Button>
    </Section>
  );
}

// ------------------------------- Absences ----------------------------------

export function Absences({
  orgSlug,
  absences,
  aujourdhui,
}: {
  orgSlug: string;
  absences: { id: string; du: string; au: string }[];
  aujourdhui: string;
}) {
  const [du, setDu] = useState(aujourdhui);
  const [au, setAu] = useState(aujourdhui);
  const [enCours, demarrer] = useTransition();

  const ajouter = () =>
    demarrer(async () => {
      const r = await ajouterAbsence(orgSlug, { du, au });
      if (r.ok) toast.success("C'est noté.");
      else toast.error(r.error);
    });
  const retirer = (id: string) =>
    demarrer(async () => {
      const r = await retirerAbsence(orgSlug, id);
      if (!r.ok) toast.error(r.error);
    });

  return (
    <Section
      titre="Mes absences"
      sousTitre="Un jour ou une période où tu ne prends rien. Tes horaires habituels reprennent ensuite."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="absence-du">Du</Label>
          <Input
            id="absence-du"
            type="date"
            min={aujourdhui}
            value={du}
            onChange={(e) => {
              setDu(e.target.value);
              if (au < e.target.value) setAu(e.target.value);
            }}
            className="w-40"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="absence-au">Au</Label>
          <Input id="absence-au" type="date" min={du} value={au} onChange={(e) => setAu(e.target.value)} className="w-40" />
        </div>
        <Button onClick={ajouter} disabled={enCours}>
          Ajouter
        </Button>
      </div>
      {absences.length === 0 ? (
        <p className="text-muted-foreground text-sm">Aucune absence prévue.</p>
      ) : (
        <ul className="divide-line divide-y">
          {absences.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{absenceEnMots(a.du, a.au)}</span>
              <Button variant="ghost" size="sm" onClick={() => retirer(a.id)} disabled={enCours}>
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ------------------------------- Maximum -----------------------------------

export function Maximum({ orgSlug, initial }: { orgSlug: string; initial: number }) {
  const [valeur, setValeur] = useState(String(initial));
  const [enCours, demarrer] = useTransition();

  const enregistrer = () =>
    demarrer(async () => {
      const r = await enregistrerMaximum(orgSlug, valeur);
      if (r.ok) toast.success("C'est noté.");
      else toast.error(r.error);
    });

  return (
    <Section titre="Mon maximum par jour" sousTitre="Au-delà, on ne te donne plus de diagnostic ce jour-là.">
      <div className="flex items-center gap-3">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          className="w-24"
          aria-label="Mon maximum par jour"
        />
        <Button onClick={enregistrer} disabled={enCours}>
          Enregistrer
        </Button>
      </div>
    </Section>
  );
}

// -------------------------------- Visio ------------------------------------

export function Visio({ orgSlug, visio, lien }: { orgSlug: string; visio: string; lien: string | null }) {
  const [choix, setChoix] = useState<"meet" | "lien">(visio === "lien" ? "lien" : "meet");
  const [adresse, setAdresse] = useState(lien ?? "");
  const [enCours, demarrer] = useTransition();

  const enregistrer = () =>
    demarrer(async () => {
      const r = await enregistrerVisio(orgSlug, choix === "lien" ? { visio: "lien", lien: adresse } : { visio: "meet" });
      if (r.ok) toast.success("C'est noté.");
      else toast.error(r.error);
    });

  return (
    <Section titre="Ma visio">
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="visio" checked={choix === "meet"} onChange={() => setChoix("meet")} />
          Google Meet, un lien créé pour chaque rendez-vous
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="visio" checked={choix === "lien"} onChange={() => setChoix("lien")} />
          Mon lien fixe (Zoom, Teams…)
        </label>
        {choix === "lien" ? (
          <div className="space-y-2 pl-6">
            <Input
              type="url"
              placeholder="https://"
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              aria-label="Mon lien fixe"
            />
            <p className="text-muted-foreground">
              Active la salle d&apos;attente sur ton lien fixe, pour que la personne suivante n&apos;arrive pas en
              plein rendez-vous.
            </p>
          </div>
        ) : null}
      </div>
      <Button onClick={enregistrer} disabled={enCours}>
        Enregistrer
      </Button>
    </Section>
  );
}
