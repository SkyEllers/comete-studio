import Link from "next/link";

import { Logo } from "@/components/app/logo";
import { UserMenu } from "@/components/app/user-menu";
import { getMesEspaces } from "@/lib/access";
import { cn } from "@/lib/utils";

type AppShellProps = {
  /** Nom du client dont on regarde l'espace, absent sur la page de dispatch. */
  orgName?: string;
  /** Son slug : c'est lui qui est coché dans « Mes espaces ». */
  orgSlug?: string;
  user: { name: string; email: string; isAdmin: boolean };
  children: React.ReactNode;
  className?: string;
};

/**
 * Coquille de l'espace connecté : une barre haute, du contenu, rien d'autre.
 * Pas de sidebar en phase 1 — un seul outil, elle n'aurait rien à porter.
 *
 * Elle va chercher elle-même la liste des espaces plutôt que de la recevoir :
 * c'est une propriété de la session, identique sur toutes les pages, et la
 * faire passer de main en main garantissait qu'un jour une page l'oublierait.
 * La lecture est mémoïsée par requête, elle ne coûte rien de plus.
 */
export async function AppShell({
  orgName,
  orgSlug,
  user,
  children,
  className,
}: AppShellProps) {
  const espaces = await getMesEspaces();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-line bg-void/95 supports-[backdrop-filter]:bg-void/75 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/app"
            prefetch
            className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-label="Retour à ton espace"
          >
            <Logo />
          </Link>

          {orgName ? (
            <>
              <span
                aria-hidden="true"
                className="bg-line hidden h-5 w-px sm:block"
              />
              <span className="truncate text-sm font-medium">{orgName}</span>
            </>
          ) : null}

          <div className="ml-auto">
            <UserMenu
              name={user.name}
              email={user.email}
              isAdmin={user.isAdmin}
              espaces={espaces}
              orgSlug={orgSlug}
            />
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6",
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}
