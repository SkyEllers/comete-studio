import Link from "next/link";

import { Logo } from "@/components/app/logo";

/** Coquille commune aux quatre écrans d'authentification : centrée, nue. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-10 px-4 py-12">
      <Logo />

      <div className="w-full max-w-sm">{children}</div>

      <footer className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs">
        <span>Espace client Comète Studio</span>
        <span aria-hidden="true" className="text-line">
          ·
        </span>
        <a
          href="https://louisgirault.fr"
          className="hover:text-foreground transition-colors"
        >
          louisgirault.fr
        </a>
        <span aria-hidden="true" className="text-line">
          ·
        </span>
        <Link
          href="/mentions-legales"
          className="hover:text-foreground transition-colors"
        >
          Mentions légales
        </Link>
        <span aria-hidden="true" className="text-line">
          ·
        </span>
        <Link
          href="/confidentialite"
          className="hover:text-foreground transition-colors"
        >
          Confidentialité
        </Link>
      </footer>
    </div>
  );
}
