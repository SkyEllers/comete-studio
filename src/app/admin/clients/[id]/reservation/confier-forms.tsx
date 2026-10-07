"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { confierUnRendezVous, teinterDejaConfies } from "./actions";

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

const QUAND = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "short",
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const RESULTAT: Record<string, string> = {
  teinte: "en Tomate",
  introuvable: "introuvable dans son agenda",
  sans_droit: "pas le droit de le modifier",
  sans_adresse: "adresse de la cliente inconnue",
  erreur: "erreur Google",
};

/** Les rendez-vous Calendly confiés avant le 07/10 : leur événement chez la titulaire en Tomate et « Disponible ». */
export function TeinterDejaConfies({ organizationId }: { organizationId: string }) {
  const [enCours, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={enCours}
      onClick={() =>
        startTransition(async () => {
          const r = await teinterDejaConfies(organizationId);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          const faits = r.data.resultats.filter((x) => x.resultat === "teinte").length;
          const autres = r.data.resultats.filter((x) => x.resultat !== "teinte");
          toast.success(`${faits} sur ${r.data.resultats.length} rendez-vous Calendly confiés passés en Tomate.`, {
            description: autres.length
              ? autres.map((x) => `${x.prenom} (${QUAND.format(new Date(x.debut))}) : ${RESULTAT[x.resultat] ?? x.resultat}`).join(" · ")
              : undefined,
            duration: 20_000,
          });
        })
      }
    >
      {enCours ? "En cours…" : "Passer en Tomate les rendez-vous Calendly déjà confiés"}
    </Button>
  );
}
