"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deconnecterAgenda } from "@/app/app/[orgSlug]/agenda/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import type { Issue } from "./etat";

const MESSAGES: Record<Issue, { texte: string; bon: boolean }> = {
  ok: { texte: "C'est fait, ton agenda est connecté.", bon: true },
  refus: { texte: "Tu as refusé l'accès, donc rien n'est connecté.", bon: false },
  droits: { texte: "Il manquait une case. Recommence en cochant les deux accès à l'agenda.", bon: false },
  erreur: { texte: "La connexion n'a pas marché. Réessaie, et si ça recommence, écris à Louis.", bon: false },
  expire: { texte: "Le lien a expiré. Recommence.", bon: false },
};

export function AgendaClient({
  orgSlug,
  email,
  issue,
}: {
  orgSlug: string;
  /** L'adresse connectée, ou null si aucun agenda n'est connecté. */
  email: string | null;
  issue: Issue | null;
}) {
  const [confirmation, setConfirmation] = useState(false);
  const [enCours, demarrer] = useTransition();
  const connecter = `/api/reservation/google/connecter?org=${encodeURIComponent(orgSlug)}`;
  const message = issue ? MESSAGES[issue] : null;

  const retirer = () =>
    demarrer(async () => {
      const r = await deconnecterAgenda(orgSlug);
      if (!r.ok) toast.error(r.error);
      setConfirmation(false);
    });

  return (
    <div className="max-w-2xl space-y-6">
      {message ? (
        <p
          role="status"
          className={
            message.bon
              ? "border-success/30 bg-success/10 text-success rounded-md border px-3 py-2 text-sm"
              : "border-warning/30 bg-warning/10 text-warning rounded-md border px-3 py-2 text-sm"
          }
        >
          {message.texte}
        </p>
      ) : null}

      {email !== null ? (
        <section className="border-line space-y-4 rounded-lg border p-5">
          <p className="text-sm font-medium">
            Ton agenda Google est connecté{email ? ` (${email})` : ""}.
          </p>
          <p className="text-muted-foreground text-sm">
            Chaque diagnostic réservé s&apos;y ajoute tout seul, et tes rendez-vous perso bloquent
            les créneaux où tu es prise. L&apos;outil voit juste quand tu es occupée. Ce que tu as
            noté, il ne le lit pas.
          </p>
          <Button variant="outline" onClick={() => setConfirmation(true)} disabled={enCours}>
            Déconnecter
          </Button>
        </section>
      ) : (
        <section className="border-line space-y-4 rounded-lg border p-5">
          <p className="text-sm">
            Connecte ton agenda Google pour recevoir des diagnostics. L&apos;outil y ajoute chaque
            rendez-vous et bloque les créneaux où tu es déjà prise. Il voit juste quand tu es
            occupée, pas le contenu de tes rendez-vous.
          </p>
          <p className="text-muted-foreground text-sm">
            Google va t&apos;afficher « Google n&apos;a pas validé cette application ». C&apos;est
            normal : clique sur « Paramètres avancés », puis sur « Accéder à Comète Studio (non
            sécurisé) ». Coche bien les deux cases de l&apos;agenda.
          </p>
          <Button asChild>
            <a href={connecter}>Connecter mon agenda Google</a>
          </Button>
        </section>
      )}

      <AlertDialog open={confirmation} onOpenChange={setConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Déconnecter ton agenda ?</AlertDialogTitle>
            <AlertDialogDescription>
              Tu ne recevras plus de nouveaux diagnostics tant que tu ne l&apos;auras pas
              reconnecté. Ceux déjà pris restent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={retirer} disabled={enCours}>
              Déconnecter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
