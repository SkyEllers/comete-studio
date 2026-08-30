"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { classer, enregistrer } from "@/app/app/[orgSlug]/(tools)/sas/actions";
import { cn } from "@/lib/utils";

import { ideesManuelles } from "./decoupage";
import { LIMITE_CAPTURE, type Boite, type IdeeProposee } from "./types";
import { Verification } from "./verification";

/**
 * L'écran d'arrivée : une zone de texte, et un bouton.
 *
 * Tout le reste de l'outil est en aval. Ce qui compte ici, c'est le temps
 * entre « j'ai une idée » et « c'est sorti de ma tête » : pas de menu, pas de
 * choix à faire, pas de champ à remplir avant de taper.
 *
 * Deux filets de sécurité. `beforeunload` retient un brouillon qu'on
 * quitterait par accident — un vide-tête qui perd ce qu'on lui a confié ne
 * sert à rien. Et si la Server Action elle-même n'aboutit pas (réseau coupé
 * entre le téléphone et Vercel), le découpage par ligne se fait ici, dans le
 * navigateur : Louis garde son texte et peut le ranger dès que ça repasse.
 */

const SEUIL_COMPTEUR = 9_000;

export function Capture({ orgSlug, boites }: { orgSlug: string; boites: Boite[] }) {
  const [texte, setTexte] = useState("");
  const [idees, setIdees] = useState<IdeeProposee[] | null>(null);
  const [mode, setMode] = useState<"ia" | "manuel">("ia");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const longueur = texte.length;
  const tropLong = longueur > LIMITE_CAPTURE;
  const enVerification = idees !== null;

  // Un brouillon non envoyé, ou des idées non enregistrées : on prévient.
  useEffect(() => {
    const enCours = texte.trim().length > 0 || (idees?.length ?? 0) > 0;
    if (!enCours) return;

    const garde = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", garde);
    return () => window.removeEventListener("beforeunload", garde);
  }, [texte, idees]);

  const ranger = () => {
    if (texte.trim().length === 0 || tropLong) return;

    startTransition(async () => {
      try {
        const resultat = await classer(orgSlug, texte);

        if (!resultat.ok) {
          toast.error(resultat.error);
          return;
        }

        if (resultat.data.mode === "manuel") {
          toast.warning("L'IA n'a pas répondu, classe à la main");
        }

        setMode(resultat.data.mode);
        setIdees(resultat.data.idees);
      } catch {
        // Même l'aller-retour vers le serveur a échoué : on découpe ici.
        toast.warning("L'IA n'a pas répondu, classe à la main");
        setMode("manuel");
        setIdees(ideesManuelles(texte));
      }
    });
  };

  const valider = () => {
    if (!idees || idees.length === 0) return;

    startTransition(async () => {
      const resultat = await enregistrer(
        orgSlug,
        idees.map((idee) => ({ texte: idee.texte, destination: idee.destination })),
      );

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      const rangees = resultat.data.rangees;
      toast.success(rangees === 1 ? "1 idée rangée" : `${rangees} idées rangées`);

      setIdees(null);
      setTexte("");
      // Une boîte a pu naître : la liste des puces vient du serveur.
      router.refresh();
    });
  };

  if (enVerification) {
    return (
      <Verification
        idees={idees}
        boites={boites}
        mode={mode}
        pending={pending}
        onChange={setIdees}
        onEnregistrer={valider}
        onAnnuler={() => setIdees(null)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Textarea
        value={texte}
        onChange={(event) => setTexte(event.target.value)}
        placeholder="Vide ta tête. Une idée par ligne, ou en vrac."
        aria-label="Ce que tu as en tête"
        autoFocus
        className="min-h-[45svh] flex-1 resize-none border-0 bg-transparent px-0 text-base leading-relaxed focus-visible:border-0 focus-visible:ring-0 md:text-base dark:bg-transparent"
      />

      <div className="flex items-center gap-3">
        <Button onClick={ranger} disabled={pending || tropLong || texte.trim().length === 0}>
          {pending ? "Je trie…" : "Ranger"}
        </Button>

        {longueur > SEUIL_COMPTEUR ? (
          <p
            className={cn(
              "font-mono text-xs tabular-nums",
              tropLong ? "text-danger" : "text-muted-foreground",
            )}
            role={tropLong ? "alert" : undefined}
          >
            {longueur.toLocaleString("fr-FR")} / {LIMITE_CAPTURE.toLocaleString("fr-FR")}
            {tropLong ? " — c'est trop long d'un coup." : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
