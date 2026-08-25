"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { signIn } from "@/app/(auth)/actions";
import { FieldError, hasFieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signIn, null);
  // React remet le formulaire à zéro après une action : sans cet état,
  // l'adresse disparaît à chaque erreur et il faut la retaper.
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="space-y-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={hasFieldError(state, "email")}
          aria-describedby="email-error"
        />
        <FieldError state={state} field="email" id="email-error" />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="password">Mot de passe</Label>
          <Link
            href="/mot-de-passe-oublie"
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            Mot de passe oublié ?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={hasFieldError(state, "password")}
          aria-describedby="password-error"
        />
        <FieldError state={state} field="password" id="password-error" />
      </div>

      <FieldError state={state} id="form-error" />

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}
