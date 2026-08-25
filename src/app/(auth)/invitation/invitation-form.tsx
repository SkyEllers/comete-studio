"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { acceptInvitation } from "@/app/(auth)/invitation/actions";
import { FieldError, hasFieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InvitationForm({ defaultFullName }: { defaultFullName: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitation, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      toast.success("Bienvenue !");
      router.replace("/app");
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="fullName">Prénom et nom</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          defaultValue={defaultFullName}
          aria-invalid={hasFieldError(state, "fullName")}
          aria-describedby="fullName-error"
        />
        <FieldError state={state} field="fullName" id="fullName-error" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={hasFieldError(state, "password")}
          aria-describedby="password-error"
        />
        <p className="text-muted-foreground text-xs">8 caractères minimum.</p>
        <FieldError state={state} field="password" id="password-error" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmation">Confirmation</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={hasFieldError(state, "confirmation")}
          aria-describedby="confirmation-error"
        />
        <FieldError
          state={state}
          field="confirmation"
          id="confirmation-error"
        />
      </div>

      <FieldError state={state} id="form-error" />

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Création…" : "Entrer dans mon espace"}
      </Button>
    </form>
  );
}
