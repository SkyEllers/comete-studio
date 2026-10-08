"use client";

import { CalendarPlus, TriangleAlert } from "lucide-react";
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
import type { APrendre } from "@/tools/reservation/a-prendre";

import { prendreUnRendezVous } from "./a-prendre-actions";

const FUSEAU = "Europe/Paris";
const quand = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const heure = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * Les diagnostics de la titulaire que personne ne couvre, qu'elle peut prendre
 * elle-même, même hors de ses horaires (Louis, 08/10/2026). Rien ne s'affiche
 * s'il n'y en a pas.
 */
export function BlocAPrendre({
  orgSlug,
  titulaire,
  aPrendre,
  vueDeLouis,
}: {
  orgSlug: string;
  titulaire: string;
  aPrendre: APrendre[];
  vueDeLouis: boolean;
}) {
  const [choisi, setChoisi] = useState<APrendre | null>(null);
  const [enCours, startTransition] = useTransition();
  const router = useRouter();
  if (!aPrendre.length) return null;

  const prendre = () =>
    startTransition(async () => {
      if (!choisi) return;
      const r = await prendreUnRendezVous(orgSlug, { bookingId: choisi.bookingId });
      if (!r.ok) {
        toast.error(r.error);
        setChoisi(null);
        router.refresh();
        return;
      }
      toast.success(`C'est à toi : ${choisi.prenom}, ${quand(choisi.debut)} à ${heure(choisi.debut)}`, {
        description: r.data.mailCliente
          ? "Elle a reçu son nouveau lien de visio. Le rendez-vous est dans ton agenda et dans « À venir »."
          : "Le rendez-vous est dans ton agenda et dans « À venir ». Son mail n'est pas parti : préviens Louis.",
        duration: 10_000,
      });
      setChoisi(null);
      router.refresh();
    });

  return (
    <section className="border-line bg-surface-1 space-y-3 rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg">
          <CalendarPlus aria-hidden="true" className="text-muted-foreground size-5" />À prendre
        </h2>
        <p className="text-muted-foreground text-sm">
          Des diagnostics de {titulaire || "la titulaire"} que personne ne peut prendre pour l&apos;instant. Ton agenda
          Google est libre à ces heures-là : tu peux en prendre un, même en dehors de tes horaires.
        </p>
      </div>
      <ul className="divide-line divide-y">
        {aPrendre.map((r) => (
          <li key={r.bookingId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="text-sm">
              <span className="font-medium">
                {quand(r.debut)}, {heure(r.debut)}
              </span>{" "}
              · {r.prenom}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={vueDeLouis}
              title={vueDeLouis ? "Seule la closeuse elle-même peut le prendre." : undefined}
              onClick={() => setChoisi(r)}
            >
              Je le prends
            </Button>
          </li>
        ))}
      </ul>

      <Dialog open={choisi !== null} onOpenChange={(o) => (o || enCours ? null : setChoisi(null))}>
        <DialogContent className="sm:max-w-md">
          {choisi ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {choisi.prenom}, {quand(choisi.debut)} à {heure(choisi.debut)}
                </DialogTitle>
                <DialogDescription>Ce diagnostic devient le tien, comme ceux de tes créneaux.</DialogDescription>
              </DialogHeader>
              <div className="border-warning/50 bg-warning/10 flex gap-2 rounded-lg border p-3 text-sm">
                <TriangleAlert aria-hidden="true" className="text-warning mt-0.5 size-4 shrink-0" />
                <p>
                  Avant de le prendre, ouvre ton agenda Google à cette heure-là. L&apos;outil a vérifié qu&apos;il n&apos;y a
                  rien de marqué « occupé », mais un événement marqué « disponible » ne compte pas. Prends-le seulement si
                  tu es vraiment libre de {heure(choisi.debut)} à {heure(choisi.fin)}.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setChoisi(null)} disabled={enCours}>
                  Annuler
                </Button>
                <Button onClick={prendre} disabled={enCours}>
                  {enCours ? "En cours…" : "J'ai vérifié, je le prends"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
