"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { confierUnRendezVous } from "./actions";

export function ConfierBouton(props: { organizationId: string; bookingId: string; personneId: string; nom: string }) {
  const [enCours, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={enCours}
      onClick={() =>
        startTransition(async () => {
          const r = await confierUnRendezVous({
            organizationId: props.organizationId,
            bookingId: props.bookingId,
            personneId: props.personneId,
          });
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success(`Confié à ${props.nom}`, {
            description: [
              r.data.mailCliente ? "La cliente a reçu le nouveau lien." : "Le mail à la cliente n'est pas parti : à lui envoyer à la main.",
              r.data.calendly
                ? "Pris sur Calendly : l'événement reste dans l'agenda de Peggy. Elle peut le supprimer (la synchronisation des annulations est coupée dans Calendly depuis le 07/10), en répondant « Ne pas envoyer » quand Google propose de prévenir les invités."
                : null,
            ]
              .filter(Boolean)
              .join(" "),
            duration: 10_000,
          });
        })
      }
    >
      {enCours ? "En cours…" : `Confier à ${props.nom}`}
    </Button>
  );
}
