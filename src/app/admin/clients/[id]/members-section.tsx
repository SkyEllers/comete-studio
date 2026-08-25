"use client";

import { MailPlus, Send, UserMinus } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  inviteMember,
  removeMember,
  resendInvitation,
} from "@/app/admin/clients/[id]/actions";
import { FieldError, hasFieldError } from "@/components/app/field-error";
import type { ActionResult } from "@/lib/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteMemberDialog({
  organizationId,
}: {
  organizationId: string;
}) {
  const [open, setOpen] = useState(false);
  // Les effets de bord (toast, fermeture, navigation) vivent dans cette
  // enveloppe côté client : les faire depuis un effet déclenche des rendus en
  // cascade, et React 19 le refuse.
  const [state, formAction, pending] = useActionState(
    async (
      previous: ActionResult<{ status: "invited" | "added" }> | null,
      formData: FormData,
    ) => {
      const result = await inviteMember(previous, formData);
      if (result.ok) {
        toast.success(
          result.data.status === "invited"
            ? "Invitation envoyée"
            : "Cette personne a déjà un compte, elle a été ajoutée à ce client",
        );
        setOpen(false);
      }
      return result;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <MailPlus aria-hidden="true" />
          Inviter
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inviter quelqu&apos;un</DialogTitle>
          <DialogDescription>
            La personne recevra un email pour choisir son mot de passe. Si elle
            a déjà un compte, elle est simplement ajoutée à ce client.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-5">
          <input type="hidden" name="organizationId" value={organizationId} />

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              aria-invalid={hasFieldError(state, "email")}
              aria-describedby="invite-email-error"
            />
            <FieldError state={state} field="email" id="invite-email-error" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Prénom et nom</Label>
            <Input
              id="fullName"
              name="fullName"
              required
              aria-invalid={hasFieldError(state, "fullName")}
              aria-describedby="invite-name-error"
            />
            <FieldError state={state} field="fullName" id="invite-name-error" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Rôle</Label>
            <select
              id="role"
              name="role"
              defaultValue="member"
              className="border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3"
            >
              <option value="member">Membre</option>
              <option value="owner">Responsable</option>
            </select>
            <FieldError state={state} field="role" id="invite-role-error" />
          </div>

          <FieldError state={state} id="invite-form-error" />

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Envoi…" : "Envoyer l'invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MemberActions({
  organizationId,
  userId,
  name,
  neverSignedIn,
}: {
  organizationId: string;
  userId: string;
  name: string;
  neverSignedIn: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const resend = () =>
    startTransition(async () => {
      const result = await resendInvitation({ organizationId, userId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.via === "invitation"
          ? "Invitation renvoyée"
          : "Un lien de connexion vient de partir",
      );
    });

  const remove = () =>
    startTransition(async () => {
      const result = await removeMember({ organizationId, userId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Personne retirée de ce client");
    });

  return (
    <div className="flex items-center justify-end gap-1">
      {neverSignedIn ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={resend}
          disabled={pending}
          title="Cette personne ne s'est jamais connectée"
        >
          <Send aria-hidden="true" />
          <span className="hidden sm:inline">Renvoyer l&apos;invitation</span>
        </Button>
      ) : null}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" disabled={pending}>
            <UserMinus aria-hidden="true" />
            <span className="sr-only">Retirer {name}</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer {name} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette personne perdra l&apos;accès à cet espace. Son compte, lui,
              reste : elle peut être membre d&apos;autres clients.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Retirer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
