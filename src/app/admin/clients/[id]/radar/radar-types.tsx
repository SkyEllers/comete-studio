"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  suivreTypeDeSeance,
  supprimerLignesDuType,
} from "@/app/admin/clients/[id]/radar/actions";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Les types de séance d'un client : ceux que Radar suit, ceux qu'il ignore.
 *
 * Un Calendly ne sert pas qu'à la prospection. Les séances de suivi de
 * clientes déjà acquises n'ont rien à faire dans Radar — elles ne viennent
 * d'aucun canal et gonfleraient l'entonnoir — et c'est ici qu'on les coupe.
 *
 * Deux gestes séparés, parce qu'ils n'ont pas le même poids. Couper un type
 * ferme la porte aux réservations suivantes et ne touche à rien d'autre : il
 * se rallume d'un clic. Supprimer ses lignes déjà reçues est sans retour —
 * Calendly ne les renverra pas — et demande donc une confirmation qui dit
 * combien partent, et combien restent parce qu'un relevé les a figées.
 */

export type TypeDeSeance = {
  id: string;
  event_type_name: string;
  tracked: boolean;
  /** « 4 sept. 2026 », calculé côté serveur. */
  vuLe: string;
  lignes: number;
  /** Rattachées à un relevé clôturé : elles ne se suppriment pas. */
  figees: number;
};

const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un);

export function TypesDeSeance({
  organizationId,
  types,
}: {
  organizationId: string;
  types: TypeDeSeance[];
}) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Chaque type de séance que Calendly a envoyé. Un type ignoré n&apos;entre
        plus dans Radar : ses réservations suivantes sont notées{" "}
        <code className="font-mono">filtered</code> au journal, et ses lignes
        déjà reçues restent jusqu&apos;à ce que tu les supprimes. Un type
        nouveau est suivi par défaut.
      </p>

      {types.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Aucun type vu pour l&apos;instant : ils apparaissent à leur première
          réservation.
        </p>
      ) : (
        <ul className="border-line divide-y divide-[var(--line)] overflow-hidden rounded-lg border">
          {types.map((type) => (
            <LigneType key={type.id} organizationId={organizationId} type={type} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LigneType({
  organizationId,
  type,
}: {
  organizationId: string;
  type: TypeDeSeance;
}) {
  // Effet immédiat, comme l'activation d'un outil : on revient en arrière si
  // l'action échoue.
  const [suivi, setSuivi] = useState(type.tracked);
  const [confirmation, setConfirmation] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const supprimables = type.lignes - type.figees;

  const changer = (suivant: boolean) => {
    setSuivi(suivant);
    startTransition(async () => {
      const resultat = await suivreTypeDeSeance({
        organizationId,
        filterId: type.id,
        tracked: suivant,
      });

      if (!resultat.ok) {
        setSuivi(!suivant);
        toast.error(resultat.error);
        return;
      }

      toast.success(
        suivant
          ? `« ${type.event_type_name} » est suivi`
          : `« ${type.event_type_name} » est ignoré : ses prochaines réservations n'entreront plus`,
      );
      router.refresh();
    });
  };

  const supprimer = () =>
    startTransition(async () => {
      const resultat = await supprimerLignesDuType({ organizationId, filterId: type.id });

      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }

      const { supprimees, figees } = resultat.data;
      setConfirmation(false);
      toast.success(
        `${supprimees} ${pluriel(supprimees, "ligne supprimée", "lignes supprimées")}` +
          (figees > 0
            ? ` · ${figees} ${pluriel(figees, "figée par un relevé reste", "figées par un relevé restent")}`
            : ""),
      );
      router.refresh();
    });

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-48 flex-1">
        <p className={cn("text-sm font-medium", !suivi && "text-muted-foreground")}>
          {type.event_type_name}
        </p>
        <p className="text-muted-foreground font-mono text-xs">
          vu le {type.vuLe} · {type.lignes} {pluriel(type.lignes, "ligne", "lignes")}
          {type.figees > 0
            ? ` dont ${type.figees} ${pluriel(type.figees, "figée", "figées")} par un relevé`
            : ""}
        </p>
      </div>

      {/* Sur un type suivi, supprimer ses lignes n'aurait pas de sens : les
          prochaines réservations les recréeraient. La base le refuse aussi. */}
      {!suivi && !type.tracked && supprimables > 0 ? (
        <AlertDialog open={confirmation} onOpenChange={setConfirmation}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={pending}>
              <Trash2 aria-hidden="true" />
              {type.lignes === 1
                ? "Supprimer la ligne existante"
                : `Supprimer les ${type.lignes} lignes existantes`}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Supprimer les lignes de « {type.event_type_name} » ?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {supprimables} {pluriel(supprimables, "rendez-vous disparaît", "rendez-vous disparaissent")}{" "}
                de Radar — liste, entonnoir, exports — sans retour : Calendly ne
                les renverra pas.
                {type.figees > 0
                  ? ` ${type.figees} ${pluriel(
                      type.figees,
                      "ligne est rattachée à un relevé clôturé : elle est figée et reste.",
                      "lignes sont rattachées à un relevé clôturé : elles sont figées et restent.",
                    )}`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <Button variant="destructive" disabled={pending} onClick={supprimer}>
                Supprimer
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {!suivi && !type.tracked && type.lignes > 0 && supprimables === 0 ? (
        <span className="text-muted-foreground text-xs">
          {pluriel(type.lignes, "Figée", "Toutes figées")} par un relevé
        </span>
      ) : null}

      {/* En bout de ligne, pour que les interrupteurs s'alignent quelle que
          soit la largeur de ce qui les précède. */}
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={suivi}
          onCheckedChange={changer}
          disabled={pending}
          aria-label={`Suivre « ${type.event_type_name} »`}
        />
        <span className="w-12">{suivi ? "Suivi" : "Ignoré"}</span>
      </label>
    </li>
  );
}
