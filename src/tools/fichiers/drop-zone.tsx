"use client";

import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { useEnvois } from "./upload-context";

/**
 * Les deux façons de déposer : glisser un fichier n'importe où sur la page, ou
 * appuyer sur « Déposer ». Les deux mènent au même dialog de préparation :
 * rien ne part sans être passé par là.
 *
 * Aucune restriction de type sur le sélecteur : sur un téléphone, un `accept`
 * restrictif ferme la porte soit à la pellicule, soit à l'app Fichiers. Mieux
 * vaut tout accepter et laisser le tri à qui dépose.
 */
export function ZoneDepot({ folderId }: { folderId: string | null }) {
  const { preparer } = useEnvois();
  const [survol, setSurvol] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  /*
   * `dragleave` part aussi quand le pointeur passe d'un élément à un autre à
   * l'intérieur de la fenêtre. On compte les entrées et les sorties plutôt que
   * de croire la dernière, sinon le bandeau clignote au moindre mouvement.
   */
  const profondeur = useRef(0);

  useEffect(() => {
    const porteUnFichier = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const entrer = (event: DragEvent) => {
      if (!porteUnFichier(event)) return;
      profondeur.current += 1;
      setSurvol(true);
    };

    const survoler = (event: DragEvent) => {
      if (!porteUnFichier(event)) return;
      // Sans ça, le navigateur ouvre le fichier au lieu de nous le donner.
      event.preventDefault();
    };

    const sortir = (event: DragEvent) => {
      if (!porteUnFichier(event)) return;
      profondeur.current = Math.max(0, profondeur.current - 1);
      if (profondeur.current === 0) setSurvol(false);
    };

    const deposer = (event: DragEvent) => {
      if (!porteUnFichier(event)) return;
      event.preventDefault();
      profondeur.current = 0;
      setSurvol(false);

      const fichiers = Array.from(event.dataTransfer?.files ?? []);
      if (fichiers.length > 0) preparer(fichiers, folderId);
    };

    window.addEventListener("dragenter", entrer);
    window.addEventListener("dragover", survoler);
    window.addEventListener("dragleave", sortir);
    window.addEventListener("drop", deposer);

    return () => {
      window.removeEventListener("dragenter", entrer);
      window.removeEventListener("dragover", survoler);
      window.removeEventListener("dragleave", sortir);
      window.removeEventListener("drop", deposer);
    };
  }, [preparer, folderId]);

  return (
    <>
      <input
        ref={champ}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const fichiers = Array.from(event.target.files ?? []);
          if (fichiers.length > 0) preparer(fichiers, folderId);
          // Remis à zéro : sans ça, redéposer le même fichier ne déclenche rien.
          event.target.value = "";
        }}
      />

      <Button onClick={() => champ.current?.click()}>
        <Upload aria-hidden="true" />
        Déposer
      </Button>

      {survol ? (
        <div
          aria-hidden="true"
          className="border-ember bg-void/80 pointer-events-none fixed inset-4 z-50 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed backdrop-blur-sm"
        >
          <Upload className="text-ember size-8" strokeWidth={1.5} />
          <p className="font-display text-lg font-semibold">Dépose ici</p>
        </div>
      ) : null}
    </>
  );
}
