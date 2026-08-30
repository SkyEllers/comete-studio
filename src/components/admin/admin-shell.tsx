import Link from "next/link";

import { AdminNav } from "@/components/admin/admin-nav";
import { Logo } from "@/components/app/logo";
import { UserMenu } from "@/components/app/user-menu";
import { getMesEspaces } from "@/lib/access";

type AdminShellProps = {
  user: { name: string; email: string; isAdmin: boolean };
  children: React.ReactNode;
};

/**
 * Coquille de l'administration : même barre haute, navigation en plus.
 *
 * Le menu du compte y porte les mêmes « Mes espaces » qu'ailleurs : c'est
 * depuis l'administration que Louis a le plus souvent besoin d'aller voir un
 * espace client tel que le client le voit.
 */
export async function AdminShell({ user, children }: AdminShellProps) {
  const espaces = await getMesEspaces();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-line bg-void/95 supports-[backdrop-filter]:bg-void/75 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/admin"
            className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-label="Administration"
          >
            <Logo />
          </Link>

          <span aria-hidden="true" className="bg-line hidden h-5 w-px sm:block" />
          <span className="text-muted-foreground hidden font-mono text-xs sm:inline">
            admin
          </span>

          <AdminNav className="ml-4" />

          <div className="ml-auto">
            <UserMenu
              name={user.name}
              email={user.email}
              isAdmin={user.isAdmin}
              espaces={espaces}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
