import { LoginForm } from "@/app/(auth)/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { nextPathSchema } from "@/lib/validations/common";

export default async function ConnexionPage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;

  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const parsedNext = nextPathSchema.safeParse(rawNext ?? "");
  const next = parsedNext.success ? parsedNext.data : undefined;

  const lienInvalide = params.erreur === "lien-invalide";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Connexion</CardTitle>
        <CardDescription>
          Ton espace client Comète Studio. L&apos;accès se fait sur invitation.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {lienInvalide ? (
          <p
            role="alert"
            className="border-warning/30 bg-warning/10 text-warning rounded-md border px-3 py-2 text-sm"
          >
            Ce lien a expiré ou a déjà été utilisé. Demande-en un nouveau.
          </p>
        ) : null}

        <LoginForm next={next} />
      </CardContent>
    </Card>
  );
}
