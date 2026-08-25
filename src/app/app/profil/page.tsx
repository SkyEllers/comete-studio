import { LogOut } from "lucide-react";
import type { Metadata } from "next";

import { signOut } from "@/components/app/actions";
import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { NameForm, PasswordForm } from "@/app/app/profil/profil-forms";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Ton profil — Comète Studio",
};

export default async function ProfilPage() {
  const { profile } = await requireUser();

  return (
    <AppShell
      user={{
        name: profile.full_name,
        email: profile.email,
        isAdmin: profile.is_admin,
      }}
    >
      <PageHeader
        title="Ton profil"
        description="Ton nom, ton mot de passe, et la sortie."
      />

      <div className="max-w-xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Identité</CardTitle>
            <CardDescription>
              Ton adresse de connexion est{" "}
              <span className="font-mono text-xs">{profile.email}</span>. Pour en
              changer, écris à Louis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NameForm defaultFullName={profile.full_name} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mot de passe</CardTitle>
            <CardDescription>
              Tu es déjà connecté : l&apos;ancien mot de passe n&apos;est pas
              redemandé.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>
              Tu devras te reconnecter avec ton email et ton mot de passe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={signOut}>
              <Button type="submit" variant="outline">
                <LogOut aria-hidden="true" />
                Déconnexion
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
