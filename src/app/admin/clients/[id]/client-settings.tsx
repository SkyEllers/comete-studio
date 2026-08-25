"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deleteOrganization,
  renameOrganization,
  toggleTool,
} from "@/app/admin/clients/[id]/actions";
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
import { Switch } from "@/components/ui/switch";

export function RenameForm({
  organizationId,
  defaultName,
}: {
  organizationId: string;
  defaultName: string;
}) {
  const [state, formAction, pending] = useActionState(renameOrganization, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      toast.success("Nom mis à jour");
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <Label htmlFor="org-name" className="sr-only">
        Nom du client
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="org-name"
          name="name"
          required
          defaultValue={defaultName}
          className="max-w-sm"
          aria-invalid={hasFieldError(state, "name")}
          aria-describedby="org-name-error"
        />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "…" : "Renommer"}
        </Button>
      </div>
      <FieldError state={state} field="name" id="org-name-error" />
      <FieldError state={state} id="rename-form-error" />
    </form>
  );
}

export function ToolSwitch({
  organizationId,
  toolId,
  toolName,
  defaultEnabled,
}: {
  organizationId: string;
  toolId: string;
  toolName: string;
  defaultEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [pending, startTransition] = useTransition();

  const change = (next: boolean) => {
    setEnabled(next); // effet immédiat, on revient en arrière si ça échoue
    startTransition(async () => {
      const result = await toggleTool({ organizationId, toolId, enabled: next });
      if (!result.ok) {
        setEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success(next ? `${toolName} activé` : `${toolName} désactivé`);
    });
  };

  return (
    <Switch
      checked={enabled}
      onCheckedChange={change}
      disabled={pending}
      aria-label={`Activer ${toolName}`}
    />
  );
}

export function DangerZone({
  organizationId,
  slug,
  name,
}: {
  organizationId: string;
  slug: string;
  name: string;
}) {
  // Le succès ne repasse pas par ici : l'action redirige vers la liste, qui
  // affiche la confirmation.
  const [state, formAction, pending] = useActionState(deleteOrganization, null);

  return (
    <div className="border-danger/30 bg-danger/5 rounded-lg border p-5">
      <p className="font-display text-danger font-semibold">Supprimer</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Le client, ses appartenances et les données de ses outils disparaissent.
        C&apos;est définitif.
      </p>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" className="mt-4">
            Supprimer ce client
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer {name} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Tout ce qui appartient à ce client sera effacé, sans retour
              possible. Saisis son identifiant pour confirmer.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <form action={formAction} className="space-y-4">
            <input
              type="hidden"
              name="organizationId"
              value={organizationId}
            />
            <div className="space-y-2">
              <Label htmlFor="confirmation">
                Saisis <span className="font-mono">{slug}</span>
              </Label>
              <Input
                id="confirmation"
                name="confirmation"
                autoComplete="off"
                className="font-mono"
                aria-invalid={hasFieldError(state, "confirmation")}
                aria-describedby="confirmation-error"
              />
              <FieldError
                state={state}
                field="confirmation"
                id="confirmation-error"
              />
              <FieldError state={state} id="delete-form-error" />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel type="button">Annuler</AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Suppression…" : "Supprimer définitivement"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
