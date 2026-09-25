"use client";

import dynamic from "next/dynamic";

/**
 * La démo ne se rend que dans le navigateur : ses exemples dépendent de
 * l'heure de qui regarde et de son `localStorage`, qu'un rendu serveur ne
 * connaît pas.
 */
export const EspaceCloseuse = dynamic(() => import("./espace-closeuse"), {
  ssr: false,
  loading: () => (
    <div className="text-muted-foreground py-24 text-center text-sm">
      Chargement…
    </div>
  ),
});
