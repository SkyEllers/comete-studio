"use client";

import { Phone, PhoneCall } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { lireR2Titulaire, noterAppelR2, type R2Titulaire } from "./actions";
import { RESULTATS, libelleResultat, type ResultatR2 } from "./regles";

/**
 * Les R2 que les closeuses ont demandés (0054, Louis, 07/10/2026) : la
 * titulaire appelle quand elle veut, puis note ce que ça a donné. Rien ne
 * s'affiche tant qu'il n'y en a pas.
 */

const FUSEAU = "Europe/Paris";

function quand(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function BlocR2({ orgSlug }: { orgSlug: string }) {
  const [donnees, setDonnees] = useState<R2Titulaire[] | null>(null);
  const [version, setVersion] = useState(0);
  const recharger = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let actif = true;
    lireR2Titulaire(orgSlug).then((r) => {
      if (actif && r.ok) setDonnees(r.data);
    });
    return () => {
      actif = false;
    };
  }, [orgSlug, version]);

  if (!donnees || donnees.length === 0) return null;
  const aAppeler = donnees.filter((r) => !r.appeleeLe);
  const faits = donnees.filter((r) => r.appeleeLe).reverse();

  return (
    <section className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <PhoneCall aria-hidden="true" className="text-muted-foreground size-4" />
          <h2 className="text-sm">R2 à rappeler</h2>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Après leur diagnostic, elles veulent te parler avant de décider. Appelle-les quand tu veux, puis note ce que
          ça a donné : la closeuse est prévenue, et c&apos;est elle qui envoie le devis.
        </p>
      </div>
      {aAppeler.length ? (
        <div className="space-y-3">
          {aAppeler.map((r) => (
            <CarteR2 key={r.bookingId} orgSlug={orgSlug} r2={r} onFini={recharger} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Aucun R2 en attente.</p>
      )}
      {faits.length ? (
        <div className="border-line divide-line divide-y rounded-lg border">
          {faits.map((r) => (
            <div key={r.bookingId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="font-medium">{r.cliente}</span>
              <span className="text-muted-foreground">avec {r.closeuse}</span>
              {r.resultat ? (
                <Badge variant="outline" className={cn(r.resultat === "demarrer" && "border-success text-success")}>
                  {libelleResultat(r.resultat)}
                </Badge>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CarteR2({ orgSlug, r2, onFini }: { orgSlug: string; r2: R2Titulaire; onFini: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [resultat, setResultat] = useState<ResultatR2 | null>(null);
  const [note, setNote] = useState("");
  const [enCours, startTransition] = useTransition();

  const noter = () =>
    startTransition(async () => {
      if (!resultat) return;
      const r = await noterAppelR2(orgSlug, { bookingId: r2.bookingId, resultat, note });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("C'est noté", {
        description: r.data.mailCloseuse
          ? `${r2.closeuse} est prévenue par mail.`
          : `Le mail à ${r2.closeuse} n'est pas parti : préviens-la.`,
      });
      onFini();
    });

  return (
    <div className="bg-surface-1 border-line space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-medium">{r2.cliente}</p>
          <p className="text-muted-foreground text-xs">
            Diagnostic avec {r2.closeuse}, {quand(r2.rdvDebut)}
          </p>
        </div>
        {r2.telephone ? (
          <a
            href={`tel:${r2.telephone.replace(/[^\d+]/g, "")}`}
            className="text-ember inline-flex items-center gap-1 text-sm font-medium"
          >
            <Phone aria-hidden="true" className="size-4" />
            {r2.telephone}
          </a>
        ) : null}
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">Quand la joindre : </span>
        {r2.joindre}
      </p>
      <button
        className="text-ember text-xs underline-offset-4 hover:underline"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
      >
        {ouvert ? "Masquer la fiche" : "Voir la fiche de la closeuse"}
      </button>
      {ouvert ? (
        <dl className="border-line space-y-2.5 rounded-md border p-3 text-sm">
          {r2.lignes.map((l) => (
            <div key={l.libelle}>
              <dt className="text-muted-foreground text-xs">{l.libelle}</dt>
              <dd className="whitespace-pre-line">{l.texte}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="border-line space-y-2 border-t pt-3">
        <p className="text-sm font-medium">Après l&apos;appel</p>
        <div className="flex flex-wrap gap-2">
          {RESULTATS.map((x) => (
            <button
              key={x.cle}
              type="button"
              aria-pressed={resultat === x.cle}
              onClick={() => setResultat(x.cle)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                resultat === x.cle ? "border-ember bg-ember/10" : "border-line hover:bg-muted",
              )}
            >
              {x.libelle}
            </button>
          ))}
        </div>
        {resultat ? (
          <>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Un mot pour la closeuse (facultatif)"
            />
            <Button size="sm" disabled={enCours} onClick={noter}>
              {enCours ? "En cours…" : "Noter"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
