import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Administration — Comète Studio",
};

/**
 * Toute l'administration est derrière cette garde. Un compte client obtient un
 * 404, pas un 403 : il n'a pas à apprendre que `/admin` existe.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { profile } = await requireAdmin();

  return (
    <AdminShell
      user={{
        name: profile.full_name,
        email: profile.email,
        isAdmin: profile.is_admin,
      }}
    >
      {children}
    </AdminShell>
  );
}
