import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ForgotForm } from "@/app/(auth)/mot-de-passe-oublie/forgot-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Mot de passe oublié — Comète Studio",
};

export default function MotDePasseOubliePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Mot de passe oublié</CardTitle>
        <CardDescription>
          Indique ton adresse : tu recevras un lien pour en choisir un nouveau.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ForgotForm />
      </CardContent>

      <CardFooter>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Retour à la connexion
        </Link>
      </CardFooter>
    </Card>
  );
}
