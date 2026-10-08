"use client";

import { CalendarClock } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { deplacerUnRendezVous } from "./deplacer-actions";
import { HEURES_POSSIBLES } from "./deplacer";

const FUSEAU = "Europe/Paris";
const jourParis = (instant: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(instant),
  );
const heureParis = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
const quand = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/**
 * « Déplacer » : la closeuse choisit avec la cliente un autre jour et une
 * autre heure, même hors de ses horaires (Louis, 08/10/2026).
 */
export function BoutonDeplacer({
  orgSlug,
  bookingId,
  prenom,
  debut,
}: {
  orgSlug: string;
  bookingId: string;
  prenom: string;
  debut: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [aujourdhui] = useState(() => jourParis(Date.now()));
  const [date, setDate] = useState(() => jourParis(Date.now() + 86_400_000));
  const [heure, setHeure] = useState(() => {
    const h = heureParis(debut);
    return HEURES_POSSIBLES.includes(h) ? h : "18:00";
  });
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  const deplacer = () =>
    startTransition(async () => {
      const r = await deplacerUnRendezVous(orgSlug, { bookingId, date, heure });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Déplacé : ${quand(r.data.debut)}`, {
        description: r.data.mailCliente
          ? `${prenom} a reçu un mail avec la nouvelle date et le lien de visio.`
          : `Le mail à ${prenom} n'est pas parti : donne-lui la nouvelle date toi-même, et préviens Louis.`,
        duration: 10_000,
      });
      setOuvert(false);
      router.refresh();
    });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOuvert(true)}>
        <CalendarClock aria-hidden="true" />
        Déplacer
      </Button>
      <Dialog open={ouvert} onOpenChange={(o) => (enCours ? null : setOuvert(o))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Déplacer le rendez-vous de {prenom}</DialogTitle>
            <DialogDescription>
              Choisis avec elle le nouveau moment. Ça peut être en dehors de tes horaires, si tu es libre.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`deplacer-jour-${bookingId}`}>Le jour</Label>
              <Input
                id={`deplacer-jour-${bookingId}`}
                type="date"
                min={aujourdhui}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`deplacer-heure-${bookingId}`}>L&apos;heure</Label>
              <select
                id={`deplacer-heure-${bookingId}`}
                className="border-input bg-input/30 h-8 w-full rounded-lg border px-2.5 text-sm"
                value={heure}
                onChange={(e) => setHeure(e.target.value)}
              >
                {HEURES_POSSIBLES.map((h) => (
                  <option key={h} value={h}>
                    {h.replace(":", "h")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            L&apos;outil vérifie que ton agenda Google est libre à ce moment-là (un événement « disponible » ne compte
            pas). {prenom} reçoit un mail avec la nouvelle date et le lien de visio, et l&apos;assistante suit.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOuvert(false)} disabled={enCours}>
              Annuler
            </Button>
            <Button onClick={deplacer} disabled={enCours || !date}>
              {enCours ? "En cours…" : "Déplacer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
