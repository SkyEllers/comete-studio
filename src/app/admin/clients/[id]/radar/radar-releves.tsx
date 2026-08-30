"use client";

import { BadgeEuro, Lock, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  cloturerMois,
  enregistrerSaisie,
  marquerPaye,
} from "@/app/admin/clients/[id]/radar/actions";
import { FieldError, hasFieldError } from "@/components/app/field-error";
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

/** Clôturer un mois, ou le re-clôturer après une contestation. */
export function BoutonCloture({
  organizationId,
  mois,
  reCloture,
}: {
  organizationId: string;
  mois: string;
  reCloture: boolean;
}) {
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  const cloturer = () =>
    startTransition(async () => {
      const resultat = await cloturerMois({ organizationId, mois });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success(reCloture ? "Relevé re-clôturé" : "Mois clôturé");
      router.refresh();
    });

  return (
    <Button variant="outline" size="sm" onClick={cloturer} disabled={enCours}>
      {reCloture ? <RotateCcw aria-hidden="true" /> : <Lock aria-hidden="true" />}
      {reCloture ? "Re-clôturer" : "Clôturer"}
    </Button>
  );
}

/**
 * Marquer payé.
 *
 * Sur un relevé validé, un clic suffit. Sur un relevé seulement clôturé,
 * l'accord s'est pris hors de l'outil et la note en est la seule trace : le
 * dialog s'ouvre pour la demander.
 */
export function BoutonPaiement({
  organizationId,
  statementId,
  valide,
}: {
  organizationId: string;
  statementId: string;
  valide: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [note, setNote] = useState("");
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  const payer = (avecNote?: string) =>
    startTransition(async () => {
      const resultat = await marquerPaye({
        organizationId,
        statementId,
        note: avecNote,
      });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("Relevé marqué payé");
      setOuvert(false);
      router.refresh();
    });

  if (valide) {
    return (
      <Button size="sm" onClick={() => payer()} disabled={enCours}>
        <BadgeEuro aria-hidden="true" />
        Marquer payé
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOuvert(true)} disabled={enCours}>
        <BadgeEuro aria-hidden="true" />
        Marquer payé
      </Button>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payé sans validation du client ?</DialogTitle>
            <DialogDescription>
              Ce relevé attend encore sa réponse. Dis sur quoi vous vous êtes mis
              d&apos;accord : ce sera la seule trace de l&apos;échange.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="note-paiement" className="sr-only">
              Note
            </Label>
            <Input
              id="note-paiement"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              placeholder="Accord par téléphone le 3 septembre, virement reçu."
            />
          </div>

          <DialogFooter>
            <Button
              onClick={() => payer(note)}
              disabled={enCours || note.trim().length === 0}
            >
              Marquer payé
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Dépense, visiteurs et clics d'un canal Comète, pour un mois. */
/**
 * La saisie mensuelle d'un canal.
 *
 * Quand Sonde mesure le mois, les deux champs d'audience disparaissent et
 * laissent la place aux nombres mesurés : les laisser vides inviterait à
 * ressaisir par-dessus une mesure, et les laisser remplis ferait croire que
 * c'est ce qu'on affiche. La dépense, elle, reste à saisir — aucune mesure ne
 * la connaît.
 *
 * Le formulaire n'envoie alors plus ces deux champs, et l'action laisse en
 * base ce qui y était : le mois où l'on repasserait à la main retrouverait ses
 * valeurs d'avant.
 */
export function FormulaireSaisie({
  organizationId,
  mois,
  canal,
  saisie,
  mesure,
  depuis,
  partielle,
}: {
  organizationId: string;
  mois: string;
  canal: { id: string; label: string };
  saisie: { spend_cents: number; visitors: number; clicks: number } | null;
  /** Ce que Sonde a mesuré pour ce canal, ou `null` si le mois est saisi. */
  mesure?: { visiteurs: number; clics: number } | null;
  depuis?: string | null;
  partielle?: boolean;
}) {
  const [state, formAction, pending] = useActionState(enregistrerSaisie, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      toast.success(`${canal.label} enregistré`);
      router.refresh();
    }
  }, [state, router, canal.label]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="channelId" value={canal.id} />
      <input type="hidden" name="mois" value={mois} />

      <span className="w-28 shrink-0 text-sm">{canal.label}</span>

      <div className="space-y-1">
        <Label htmlFor={`${canal.id}-spend`} className="text-muted-foreground text-xs">
          Dépense €
        </Label>
        <Input
          id={`${canal.id}-spend`}
          name="spend"
          inputMode="decimal"
          defaultValue={saisie ? (saisie.spend_cents / 100).toFixed(2) : ""}
          placeholder="0"
          className="h-8 w-28"
          aria-invalid={hasFieldError(state, "spendCents")}
        />
      </div>

      {mesure ? (
        <p className="text-muted-foreground pb-1.5 text-xs">
          <span className="font-mono tabular-nums">{mesure.visiteurs}</span> visiteurs
          · <span className="font-mono tabular-nums">{mesure.clics}</span> clics,
          mesurés par Sonde
          {partielle && depuis ? ` depuis le ${depuis}` : ""}
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <Label htmlFor={`${canal.id}-visitors`} className="text-muted-foreground text-xs">
              Visiteurs
            </Label>
            <Input
              id={`${canal.id}-visitors`}
              name="visitors"
              type="number"
              min="0"
              defaultValue={saisie?.visitors ?? ""}
              placeholder="0"
              className="h-8 w-28"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${canal.id}-clicks`} className="text-muted-foreground text-xs">
              Clics
            </Label>
            <Input
              id={`${canal.id}-clicks`}
              name="clicks"
              type="number"
              min="0"
              defaultValue={saisie?.clicks ?? ""}
              placeholder="0"
              className="h-8 w-28"
            />
          </div>
        </>
      )}

      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "…" : "Enregistrer"}
      </Button>

      <div className="w-full">
        <FieldError state={state} field="spendCents" id={`${canal.id}-spend-error`} />
        <FieldError state={state} id={`${canal.id}-saisie-error`} />
      </div>
    </form>
  );
}
