import type { Metadata } from "next";

import { InvitationForm } from "@/app/(auth)/invitation/invitation-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Bienvenue — Comète Studio",
};

export default async function InvitationPage() {
  // La session vient du lien d'invitation.
  const { profile } = await requireUser();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          Bienvenue, choisis ton mot de passe
        </CardTitle>
        <CardDescription>
          Encore une étape et ton espace client Comète Studio est à toi.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <InvitationForm defaultFullName={profile.full_name} />
      </CardContent>
    </Card>
  );
}
