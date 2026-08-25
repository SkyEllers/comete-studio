import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/app/logo";

type LegalShellProps = {
  title: string;
  /** Date de dernière mise à jour, affichée en mono comme les autres repères techniques. */
  updatedAt: string;
  children: React.ReactNode;
};

/**
 * Coquille des deux seules pages publiques du hub. Volontairement nue : un
 * logo, un retour, le texte.
 */
export function LegalShell({ title, updatedAt, children }: LegalShellProps) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-line border-b">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-label="Retour à la connexion"
          >
            <Logo />
          </Link>
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Retour
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="text-3xl">{title}</h1>
        <p className="text-muted-foreground mt-2 font-mono text-xs">
          Dernière mise à jour : {updatedAt}
        </p>
        <div className="mt-10 space-y-10">{children}</div>
      </main>

      <footer className="border-line border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6 text-xs sm:px-6">
          <span>Espace client Comète Studio</span>
          <Link href="/mentions-legales" className="hover:text-foreground">
            Mentions légales
          </Link>
          <Link href="/confidentialite" className="hover:text-foreground">
            Confidentialité
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** Une section de texte légal : un titre, du contenu. */
export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg">{title}</h2>
      <div className="text-muted-foreground space-y-3 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  );
}
