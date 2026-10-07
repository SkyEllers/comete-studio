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
                ? r.data.agendaTitulaire === "teinte"
                  ? "Pris sur Calendly : chez Peggy, l'événement passe en Tomate et en « Disponible ». Il ne se supprime pas."
                  : r.data.agendaTitulaire === "sans_droit"
                    ? "Pris sur Calendly : l'événement reste tel quel chez Peggy (son agenda n'a pas encore le droit de le modifier). Ne pas le supprimer."
                    : "Pris sur Calendly : l'événement n'a pas pu passer en Tomate chez Peggy. Le faire à la main, sans le supprimer."
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
