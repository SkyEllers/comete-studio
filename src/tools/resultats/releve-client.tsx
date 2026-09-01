"use client";

import { Download, ThumbsUp, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { repondreReleve } from "@/app/app/[orgSlug]/(tools)/resultats/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { versCsv, type BaseDeCommission, type LigneReleve } from "./releve";

/**
 * Répondre à un relevé, et l'emporter.
 *
 * Valider est un geste simple, contester en demande un autre : dire quoi.
 * Louis ne peut rien corriger d'un « ce n'est pas bon », et un relevé
 * re-clôturé sans savoir quoi corriger reviendrait contesté.
 */
export function ReponseReleve({
  orgSlug,
  statementId,
  repondable,
}: {
  orgSlug: string;
  statementId: string;
  repondable: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  if (!repondable) return null;

  const repondre = (decision: "valide" | "conteste") =>
    startTransition(async () => {
      const resultat = await repondreReleve(orgSlug, {
        statementId,
        decision,
        commentaire: decision === "conteste" ? commentaire : undefined,
      });

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      toast.success(
        decision === "valide"
          ? "Relevé validé, merci"
          : "C'est signalé, Louis va regarder",
      );
      setOuvert(false);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => repondre("valide")} disabled={enCours}>
        <ThumbsUp aria-hidden="true" />
        Tout est juste
      </Button>

      <Button variant="outline" onClick={() => setOuvert(true)} disabled={enCours}>
        <TriangleAlert aria-hidden="true" />
        Quelque chose ne va pas
      </Button>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Qu&apos;est-ce qui ne va pas ?</DialogTitle>
            <DialogDescription>
              Dis-le en quelques mots : Louis corrigera et te renverra le relevé.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="contestation" className="sr-only">
              Ce qui te semble faux
            </Label>
            <Textarea
              id="contestation"
              value={commentaire}
              onChange={(event) => setCommentaire(event.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="La séance du 12 n'a pas eu lieu, la personne s'est décommandée la veille."
            />
          </div>

          <DialogFooter>
            <Button
              onClick={() => repondre("conteste")}
              disabled={enCours || commentaire.trim().length === 0}
            >
              Envoyer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * L'export.
 *
 * Le fichier se fabrique dans le navigateur : les lignes sont déjà sur la
 * page, et un aller-retour serveur pour recopier ce qu'on a sous les yeux
 * n'apporterait rien.
 */
export function ExportCsv({
  lignes,
  nom,
  base = "encaissement",
}: {
  lignes: LigneReleve[];
  nom: string;
  /** La règle du relevé : elle décide de la colonne « Date de vente ». */
  base?: BaseDeCommission;
}) {
  const telecharger = () => {
    // Le BOM, sans quoi Excel affiche « SÃ©ance » au lieu de « Séance ».
    const blob = new Blob(["﻿", versCsv(lignes, base)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);

    const lien = document.createElement("a");
    lien.href = url;
    lien.download = `${nom}.csv`;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();

    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <Button variant="outline" size="sm" onClick={telecharger}>
      <Download aria-hidden="true" />
      Exporter en CSV
    </Button>
  );
}
