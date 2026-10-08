"use client";

import { useEffect, useState } from "react";

import { lireRelances } from "./relances-actions";
import { ETAPES_RELANCE, type Relances } from "./relances";

const FUSEAU = "Europe/Paris";
const quand = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/**
 * Dans la fiche Radar d'un rendez-vous : les relances que la closeuse a
 * cochées, et quand (0058, 08/10/2026). Rien s'il n'y en a pas.
 */
export function BlocRelances({ orgSlug, bookingId }: { orgSlug: string; bookingId: string }) {
  const [relances, setRelances] = useState<Relances | null>(null);
  useEffect(() => {
    let actif = true;
    lireRelances(orgSlug, bookingId).then((r) => {
      if (actif && r.ok) setRelances(r.data);
    });
    return () => {
      actif = false;
    };
  }, [orgSlug, bookingId]);

  const cochees = ETAPES_RELANCE.filter((e) => relances?.[e.cle]);
  if (!cochees.length) return null;
  // Dans le <dl> de la fiche : même forme que ses autres lignes.
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground shrink-0 text-xs">Relances de la closeuse</dt>
      <dd className="text-right text-sm">
        <ul className="space-y-0.5">
          {cochees.map((e) => (
            <li key={e.cle}>
              {e.libelle} <span className="text-muted-foreground">· {quand(relances![e.cle]!)}</span>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}
