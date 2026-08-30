"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  renommerBoite,
  supprimerBoite,
} from "@/app/app/[orgSlug]/(tools)/sas/actions";
import { compteIdees } from "./format";
import { LIMITE_NOM_BOITE } from "./types";

/** Le menu d'une boîte : la renommer, ou la supprimer. */
export function MenuBoite({
  orgSlug,
  boite,
  notes,
}: {
  orgSlug: string;
  boite: { id: string; name: string };
  notes: number;
}) {
  const [renommage, setRenommage] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [nom, setNom] = useState(boite.name);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const renommer = (event: React.FormEvent) => {
    event.preventDefault();
    setErreur(null);

    startTransition(async () => {
      const resultat = await renommerBoite(orgSlug, boite.id, nom);
      if (!resultat.ok) {
        setErreur(resultat.error);
        return;
      }
      setRenommage(false);
      toast.success("Boîte renommée");
      router.refresh();
    });
  };

  const supprimer = () =>
    startTransition(async () => {
      const resultat = await supprimerBoite(orgSlug, boite.id);
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      setSuppression(false);
      toast.success(`« ${boite.name} » supprimée`);
      router.refresh();
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`Menu de la boîte ${boite.name}`}
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setNom(boite.name);
              setRenommage(true);
            }}
          >
            <Pencil aria-hidden="true" />
            Renommer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={(event) => {
              event.preventDefault();
              setSuppression(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={renommage}
        onOpenChange={(valeur) => {
          setRenommage(valeur);
          if (!valeur) setErreur(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renommer la boîte</DialogTitle>
          </DialogHeader>

          <form onSubmit={renommer} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={`renommer-${boite.id}`}>Nom de la boîte</Label>
              <Input
                id={`renommer-${boite.id}`}
                value={nom}
                onChange={(event) => setNom(event.target.value)}
                required
                autoFocus
                maxLength={LIMITE_NOM_BOITE}
                autoComplete="off"
                aria-invalid={Boolean(erreur)}
              />
              {erreur ? (
                <p role="alert" className="text-danger text-sm">
                  {erreur}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Enregistrement…" : "Renommer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={suppression} onOpenChange={setSuppression}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {boite.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              {notes === 0
                ? "Cette boîte est vide."
                : `Ses ${compteIdees(notes).toLowerCase()} iront dans « À ranger ». Aucune n'est perdue.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button variant="destructive" disabled={pending} onClick={supprimer}>
              {pending ? "Suppression…" : "Supprimer la boîte"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
