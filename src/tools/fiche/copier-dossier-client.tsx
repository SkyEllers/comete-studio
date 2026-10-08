"use client";

import { Check, Copy, Download, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { lireDossier } from "./actions";

/**
 * « Copier tout le dossier » (Louis, 08/10/2026) : ses réponses au
 * questionnaire et l'enregistrement de son diagnostic en un seul texte, que
 * Peggy colle dans ChatGPT pour préparer son premier rendez-vous. Le texte se
 * prépare à l'ouverture de la fiche : la copie part au clic, sans attente (un
 * navigateur refuse souvent une copie faite après un aller-retour au serveur).
 */
export function CopierDossier({ orgSlug, bookingId, titre }: { orgSlug: string; bookingId: string; titre: string }) {
  const [dossier, setDossier] = useState<{ texte: string; manque: string[] } | null>(null);
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    let actif = true;
    lireDossier(orgSlug, bookingId).then((r) => {
      if (actif && r.ok) setDossier(r.data);
    });
    return () => {
      actif = false;
    };
  }, [orgSlug, bookingId]);

  // Rien à copier : ni réponses, ni enregistrement.
  if (!dossier || dossier.manque.length >= 2) return null;

  return (
    <section className="space-y-1.5">
      <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <FolderOpen aria-hidden="true" className="size-3.5" />
        Tout son dossier
      </h3>
      <p className="text-sm">Ses réponses et son diagnostic en un seul texte, à coller dans ChatGPT pour préparer le rendez-vous.</p>
      {dossier.manque.length ? <p className="text-muted-foreground text-xs">Il manque : {dossier.manque.join(", ")}.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(dossier.texte);
              setCopie(true);
              toast.success("Dossier copié.");
              window.setTimeout(() => setCopie(false), 2000);
            } catch {
              toast.error("La copie n'a pas marché : télécharge le .txt à côté.");
            }
          }}
        >
          {copie ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          Copier tout le dossier
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([dossier.texte], { type: "text/plain;charset=utf-8" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = `${titre.replace(/[\\/:*?"<>|]/g, "-")}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download aria-hidden="true" />
          .txt
        </Button>
      </div>
    </section>
  );
}
