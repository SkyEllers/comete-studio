"use client";

import { Check, Copy, KeyRound, Link2Off } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  creerJetonExport,
  revoquerJetonExport,
} from "@/app/admin/clients/[id]/radar/actions";
import { FieldError, hasFieldError } from "@/components/app/field-error";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateHeure } from "@/tools/resultats/format";

/**
 * Les jetons de lecture d'un client, et le seul moment où l'on voit le jeton.
 *
 * Toute la difficulté de cet écran tient dans une phrase : le jeton apparaît
 * une fois, et la base n'en gardera que l'empreinte. Il faut donc que ce
 * moment soit impossible à rater — le bloc reste affiché jusqu'à ce que Louis
 * le ferme, il ne disparaît pas au premier rafraîchissement — et que la
 * conséquence soit écrite avant, pas après.
 */

export type JetonExport = {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function ExportsRadar({
  organizationId,
  jetons,
}: {
  organizationId: string;
  jetons: JetonExport[];
}) {
  const [etat, action, enCours] = useActionState(creerJetonExport, null);
  const [copie, setCopie] = useState(false);
  const [enRetrait, startTransition] = useTransition();
  const router = useRouter();

  /*
   * Le jeton se lit sur le résultat de l'action, il ne s'y recopie pas : un
   * `useEffect` qui pousserait la valeur dans un état la ferait vivre deux
   * fois, et c'est exactement ce qu'on ne veut pas d'un secret. `ferme` ne
   * garde que le fait qu'on l'a masqué — pas sa valeur.
   *
   * La liste, elle, se met à jour toute seule : l'action appelle
   * `revalidatePath`, ce qui suffit à rendre à nouveau la page côté serveur.
   */
  const [ferme, setFerme] = useState(false);
  const nouveau = etat?.ok && !ferme ? (etat.data?.jeton ?? null) : null;

  const copier = async () => {
    if (!nouveau) return;
    try {
      await navigator.clipboard.writeText(nouveau);
      setCopie(true);
      toast.success("Jeton copié");
      setTimeout(() => setCopie(false), 2000);
    } catch {
      toast.error("La copie a été refusée. Sélectionne le jeton à la main.");
    }
  };

  const revoquer = (tokenId: string) =>
    startTransition(async () => {
      const resultat = await revoquerJetonExport(organizationId, tokenId);
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("Jeton révoqué");
      router.refresh();
    });

  const vivants = jetons.filter((jeton) => !jeton.revoked_at);
  const eteints = jetons.filter((jeton) => jeton.revoked_at);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Un jeton donne à un rapport externe la lecture des rendez-vous de ce
        client, et de lui seul. Aucun nom n&apos;est jamais servi. Le jeton
        s&apos;affiche une seule fois, à sa création : la base n&apos;en garde
        que l&apos;empreinte.
      </p>

      {nouveau ? (
        <div className="border-ember bg-surface-2 space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">
            Copie ce jeton maintenant. Il ne sera plus affiché.
          </p>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{nouveau}</code>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={copier}
              aria-label="Copier le jeton"
              className="shrink-0"
            >
              {copie ? (
                <Check aria-hidden="true" className="text-success" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setFerme(true)}>
            J&apos;ai copié le jeton
          </Button>
        </div>
      ) : null}

      <form
        action={action}
        onSubmit={() => setFerme(false)}
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
          <Label htmlFor="label-jeton">Libellé</Label>
          <Input
            id="label-jeton"
            name="label"
            placeholder="Rapport Google Ads"
            maxLength={60}
            required
            aria-invalid={hasFieldError(etat, "label")}
          />
          <FieldError state={etat} field="label" />
        </div>
        <Button type="submit" disabled={enCours}>
          <KeyRound aria-hidden="true" />
          Créer un jeton
        </Button>
      </form>

      <FieldError state={etat} />

      {jetons.length === 0 ? (
        <p className="text-muted-foreground text-sm">Aucun jeton pour ce client.</p>
      ) : (
        <ul className="border-line divide-line divide-y overflow-hidden rounded-lg border">
          {[...vivants, ...eteints].map((jeton) => (
            <li key={jeton.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{jeton.label}</p>
                <p className="text-muted-foreground font-mono text-xs">
                  créé le {dateHeure(jeton.created_at)}
                  {" · "}
                  {jeton.last_used_at
                    ? `dernière lecture ${dateHeure(jeton.last_used_at)}`
                    : "jamais utilisé"}
                  {jeton.revoked_at ? ` · révoqué le ${dateHeure(jeton.revoked_at)}` : ""}
                </p>
              </div>

              {jeton.revoked_at ? (
                <span className="text-muted-foreground text-xs">Révoqué</span>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={enRetrait}>
                      <Link2Off aria-hidden="true" />
                      Révoquer
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Révoquer « {jeton.label} » ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Le rapport qui s&apos;en sert cessera de lire à la seconde
                        suivante. C&apos;est sans retour : il faudra créer un
                        nouveau jeton et le lui donner.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <Button
                        variant="destructive"
                        disabled={enRetrait}
                        onClick={() => revoquer(jeton.id)}
                      >
                        Révoquer
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
