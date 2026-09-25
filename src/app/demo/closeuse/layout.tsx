import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Espace closeuse — Comète Studio",
  robots: { index: false, follow: false },
};

/**
 * Démo de l'espace closeuse, montrée en partage d'écran pendant un
 * recrutement. Réservée à Louis : un compte client obtient un 404, comme pour
 * `/admin`. Rien n'y est lu ni écrit en base — les données d'exemple vivent
 * dans le navigateur de qui regarde.
 */
export default async function DemoCloseuseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return children;
}
