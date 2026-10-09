"use client";

import { CalendarX2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { annulerUnRendezVous } from "./annuler-actions";

/** « Annuler » : la cliente a demandé d'annuler (Louis, 09/10/2026). */
export function BoutonAnnuler({ orgSlug, bookingId, prenom }: { orgSlug: string; bookingId: string; prenom: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  const annuler = () =>
    startTransition(async () => {
      const r = await annulerUnRendezVous(orgSlug, { bookingId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Rendez-vous de ${prenom} annulé`, {
        description: r.data.mailCliente
          ? "Ton créneau est libéré. Elle a reçu un mail pour reprendre un rendez-vous quand elle voudra."
          : "Ton créneau est libéré. Son mail n'est pas parti : préviens Louis.",
        duration: 10_000,
      });
      setOuvert(false);
      router.refresh();
    });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOuvert(true)}>
        <CalendarX2 aria-hidden="true" />
        Annuler
      </Button>
      <Dialog open={ouvert} onOpenChange={(o) => (enCours ? null : setOuvert(o))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Annuler le rendez-vous de {prenom} ?</DialogTitle>
            <DialogDescription>
              Seulement si elle te l&apos;a demandé. Si elle veut un autre moment, utilise plutôt « Déplacer ».
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Ton créneau se libère, et elle reçoit un mail « Ton diagnostic est annulé », avec un bouton pour reprendre
            un rendez-vous quand elle voudra.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOuvert(false)} disabled={enCours}>
              Retour
            </Button>
            <Button variant="destructive" onClick={annuler} disabled={enCours}>
              {enCours ? "En cours…" : "Annuler le rendez-vous"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
