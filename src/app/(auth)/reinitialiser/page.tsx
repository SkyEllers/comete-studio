import type { Metadata } from "next";

import { ResetForm } from "@/app/(auth)/reinitialiser/reset-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Nouveau mot de passe — Comète Studio",
};

export default async function ReinitialiserPage() {
  // La session vient du lien de récupération. Le proxy filtre déjà, on
  // revérifie ici : les deux couches sont obligatoires (CLAUDE.md §6).
  await requireUser();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Nouveau mot de passe</CardTitle>
        <CardDescription>
          Choisis un mot de passe, et te voilà de retour dans ton espace.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ResetForm />
      </CardContent>
    </Card>
  );
}
