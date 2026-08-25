"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { changePassword, updateFullName } from "@/app/app/profil/actions";
import { FieldError, hasFieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NameForm({ defaultFullName }: { defaultFullName: string }) {
  const [state, formAction, pending] = useActionState(updateFullName, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      toast.success("Nom mis à jour");
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
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

      <FieldError state={state} id="name-form-error" />

      <Button type="submit" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Mot de passe mis à jour");
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="new-password">Nouveau mot de passe</Label>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={hasFieldError(state, "password")}
          aria-describedby="new-password-error"
        />
        <p className="text-muted-foreground text-xs">8 caractères minimum.</p>
        <FieldError state={state} field="password" id="new-password-error" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-confirmation">Confirmation</Label>
        <Input
          id="new-confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={hasFieldError(state, "confirmation")}
          aria-describedby="new-confirmation-error"
        />
        <FieldError
          state={state}
          field="confirmation"
          id="new-confirmation-error"
        />
      </div>

      <FieldError state={state} id="password-form-error" />

      <Button type="submit" disabled={pending}>
        {pending ? "Enregistrement…" : "Changer le mot de passe"}
      </Button>
    </form>
  );
}
