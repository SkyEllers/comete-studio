import { AppShell } from "@/components/app/app-shell";
import { requireMembership } from "@/lib/access";

/**
 * Porte d'entrée d'un espace client. Tout ce qui vit en dessous est déjà
 * garanti accessible : `requireMembership` répond 404 sinon.
 */
export default async function OrgLayout({
  children,
  params,
}: LayoutProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  const { org, profile } = await requireMembership(orgSlug);

  return (
    <AppShell
      orgName={org.name}
      orgSlug={org.slug}
      user={{
        name: profile.full_name,
        email: profile.email,
        isAdmin: profile.is_admin,
      }}
    >
      {children}
    </AppShell>
  );
}
