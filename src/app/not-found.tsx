import Link from "next/link";

import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div className="space-y-2">
        <p className="text-muted-foreground font-mono text-xs">404</p>
        <h1 className="text-2xl">Cette page n&apos;existe pas ou tu n&apos;y as pas accès.</h1>
      </div>
      <Button asChild>
        <Link href="/app">Retour à ton espace</Link>
      </Button>
    </div>
  );
}
