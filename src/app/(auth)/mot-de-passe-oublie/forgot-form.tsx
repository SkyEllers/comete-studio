"use client";

import { useActionState } from "react";

import { requestPasswordReset } from "@/app/(auth)/mot-de-passe-oublie/actions";
import { FieldError, hasFieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    null,
  );

  if (state?.ok) {
    return (
      <p
        role="status"
        className="border-success/30 bg-success/10 text-success rounded-md border px-3 py-2 text-sm"
      >
        Si un compte existe pour cette adresse, un email vient de partir.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          aria-invalid={hasFieldError(state, "email")}
          aria-describedby="email-error"
        />
        <FieldError state={state} field="email" id="email-error" />
      </div>

      <FieldError state={state} id="form-error" />

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Envoi…" : "Recevoir un lien"}
      </Button>
    </form>
  );
}
