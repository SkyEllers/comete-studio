"use client";

import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { SEUIL_OUVERTURE } from "./grille";
import type { AppelAnalyse, VueCloseuse } from "./queries";
import { BadgeIssue, DetailAnalyse, ListePassages, MarqueCoupe, TableComparaison } from "./vue-analyse";

/**
 * L'onglet « Mes analyses » de l'espace d'une closeuse (0056). Visible dès le
 * départ, il s'ouvre à son dixième rendez-vous tenu ; avant, il dit combien
 * il en reste (Louis, 07/10/2026). Louis le voit ouvert, avec un bandeau.
 */

type Vue = "appels" | "ensemble" | "autres";

const VUES: { id: Vue; label: string }[] = [
  { id: "appels", label: "Mes appels" },
  { id: "ensemble", label: "Mon ensemble" },
  { id: "autres", label: "Comment les autres s'y prennent" },
];

const date = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });

export function OngletAnalyses({ vue, titulaire, prenom }: { vue: VueCloseuse; titulaire: string; prenom: string }) {
  const [sous, setSous] = useState<Vue>("appels");

  if (!("appels" in vue)) {
    const fait = Math.min(vue.tenus, SEUIL_OUVERTURE);
    return (
      <div className="border-trait bg-papier-clair mx-auto max-w-xl rounded-lg border p-6 text-center">
        <Lock aria-hidden="true" className="text-muted-foreground mx-auto mb-3 size-6" />
        <p className="text-lg">
          Encore {vue.reste} rendez-vous {vue.reste > 1 ? "tenus" : "tenu"} avant d&apos;ouvrir tes analyses
        </p>
        <div className="bg-papier-fonce mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full" aria-hidden="true">
          <div className="bg-braise h-full" style={{ width: `${(fait / SEUIL_OUVERTURE) * 100}%` }} />
        </div>
        <p className="text-muted-foreground mt-2 text-xs tabular-nums">
          {fait} / {SEUIL_OUVERTURE}
        </p>
        <p className="text-muted-foreground mt-4 text-sm">
          Chaque appel que tu enregistres est relu. À ton dixième rendez-vous, tu verras ce que tu fais bien, ce que tu peux faire
          autrement, et comment les autres s&apos;y prennent.
        </p>
      </div>
    );
  }

  const faites = vue.appels.filter((a) => a.analyse);
  return (
    <div className="space-y-6">
      {vue.apercu ? (
        <p className="border-trait text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
          {prenom || "Elle"} ne voit pas encore cet onglet : {vue.tenus} rendez-vous tenus sur {SEUIL_OUVERTURE}. Elle voit à la
          place « Encore {vue.reste} rendez-vous ».
        </p>
      ) : null}

      <div role="tablist" className="flex flex-wrap gap-2">
        {VUES.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={sous === v.id}
            onClick={() => setSous(v.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              sous === v.id ? "border-encre bg-encre text-papier" : "border-trait text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {sous === "appels" ? <ListeAppels appels={vue.appels} /> : null}
      {sous === "ensemble" ? (
        faites.length ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Le repère qui revient le plus souvent sur tes appels, à côté de celui des autres closeuses (sans nom).
            </p>
            <TableComparaison lignes={vue.comparaison} nbAppels={faites.length} nbAppelsEquipe={vue.nbAppelsEquipe} />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Ton ensemble apparaît avec ton premier appel analysé.</p>
        )
      ) : null}
      {sous === "autres" ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Des passages réussis d&apos;autres appels, réécrits sans rien qui permette de reconnaître la cliente. Prends ce qui te
            parle, avec tes mots.
          </p>
          <ListePassages passages={vue.passages} titulaire={titulaire} />
        </div>
      ) : null}
    </div>
  );
}

function ListeAppels({ appels }: { appels: AppelAnalyse[] }) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  if (appels.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucun appel analysé pour l&apos;instant. Dépose l&apos;enregistrement de tes rendez-vous : l&apos;analyse arrive dans
        l&apos;heure qui suit le résultat noté.
      </p>
    );
  }
  return (
    <ul className="border-trait divide-trait divide-y rounded-lg border">
      {appels.map((a) => {
        const est = ouvert === a.bookingId;
        return (
          <li key={a.bookingId}>
            <button
              type="button"
              aria-expanded={est}
              disabled={!a.analyse}
              onClick={() => setOuvert(est ? null : a.bookingId)}
              className="hover:bg-papier-fonce flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="flex min-w-0 items-center gap-2">
                {a.analyse ? (
                  est ? (
                    <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
                  )
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                <span className="truncate text-sm">
                  {a.debut ? date.format(new Date(a.debut)) : ""} · {a.prenom}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <MarqueCoupe analyse={a.analyse} />
                {a.analyse ? null : (
                  <span className="text-muted-foreground text-xs">{a.etat === "echec" ? "Analyse à refaire" : "Analyse en cours"}</span>
                )}
                <BadgeIssue issue={a.issue} />
              </span>
            </button>
            {est && a.analyse ? (
              <div className="border-trait border-t p-4">
                <DetailAnalyse analyse={a.analyse} issue={a.issue} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
