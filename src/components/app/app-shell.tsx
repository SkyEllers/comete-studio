import Link from "next/link";

import { Logo } from "@/components/app/logo";
import { UserMenu } from "@/components/app/user-menu";
import { cn } from "@/lib/utils";

type AppShellProps = {
  /** Nom du client dont on regarde l'espace, absent sur la page de dispatch. */
  orgName?: string;
  user: { name: string; email: string; isAdmin: boolean };
  children: React.ReactNode;
  className?: string;
};

/**
 * Coquille de l'espace connecté : une barre haute, du contenu, rien d'autre.
 * Pas de sidebar en phase 1 — un seul outil, elle n'aurait rien à porter.
 */
export function AppShell({
  orgName,
  user,
  children,
  className,
}: AppShellProps) {
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
