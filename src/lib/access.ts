import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { requireUser, type Session } from "./auth";
import type { Database } from "./supabase/database.types";
import { createClient } from "./supabase/server";

export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type MembershipRole = Database["public"]["Enums"]["membership_role"];
export type AccessRole = MembershipRole | "admin";
export type Access = Session & { org: Organization; role: AccessRole };

/**
 * Organisation par slug, vue à travers la RLS de l'utilisateur courant : un
 * non-membre obtient `null`, même si l'organisation existe.
 */
export const getOrgBySlug = cache(async (slug: string): Promise<Organization | null> => {
  const supabase = await createClient();

  const { data } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  return data ?? null;
});

/**
 * Rôle d'un membre dans une organisation, ou `null`.
 *
 * Mémoïsé par requête : un layout et sa page appellent tous deux la garde, et
 * sans ça la même lecture partait deux fois.
 */
const getMembershipRole = cache(
  async (organizationId: string, userId: string): Promise<MembershipRole | null> => {
    const supabase = await createClient();

    const { data } = await supabase
      .from("memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    return data?.role ?? null;
  },
);

/** Outil activé pour cette organisation ? Mémoïsé pour la même raison. */
const checkTool = cache(
  async (organizationId: string, toolSlug: string): Promise<boolean> => {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("has_tool", {
      org: organizationId,
      tool_slug: toolSlug,
    });

    return !error && Boolean(data);
  },
);

/**
 * Accès d'un utilisateur à un espace client, ou `null`.
 *
 * Version qui ne coupe pas la page : une Server Action doit pouvoir répondre
 * « ce n'est plus accessible » proprement plutôt que de lever un 404.
 */
export async function getMembership(slug: string): Promise<Access | null> {
  const session = await requireUser();

  const org = await getOrgBySlug(slug);
  if (!org) return null;

  const role = await getMembershipRole(org.id, session.userId);

  if (role) return { ...session, org, role };
  if (session.profile.is_admin) return { ...session, org, role: "admin" };

  return null;
}

/**
 * Garde d'entrée d'un espace client. Toujours `notFound()` en cas de refus :
 * on ne confirme jamais l'existence d'un client à quelqu'un qui n'y est pas.
 * Louis passe partout, avec le rôle `admin`.
 */
export async function requireMembership(slug: string): Promise<Access> {
  const access = await getMembership(slug);
  if (!access) notFound();
  return access;
}

/**
 * Garde d'un outil. L'outil doit être actif dans le catalogue ET activé pour
 * cette organisation — la règle est la même pour Louis : dans un espace client,
 * il voit ce que le client voit.
 */
export async function requireToolAccess(
  slug: string,
  toolSlug: string,
): Promise<Access> {
  const access = await requireMembership(slug);

  if (!(await checkTool(access.org.id, toolSlug))) notFound();

  return access;
}

/** Une organisation telle qu'elle apparaît dans le menu du compte. */
export type Espace = Pick<Organization, "id" | "name" | "slug">;

/**
 * Les organisations dont l'utilisateur est **réellement membre**.
 *
 * La distinction compte pour Louis, et pour lui seul : la RLS lui montre
 * toutes les organisations, si bien qu'une lecture de `organizations` lui
 * rendrait la liste entière des clients. Ce n'est pas ce que « mes espaces »
 * veut dire — on part donc de `memberships`, filtré sur son identité, et le
 * menu lui offre « Tous les clients » à part.
 *
 * Mémoïsé par requête : la coquille l'appelle à chaque rendu de page, et
 * `requireUser()` l'est déjà pour la même raison.
 */
export const getMesEspaces = cache(async (): Promise<Espace[]> => {
  const session = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("memberships")
    .select("organizations(id, name, slug)")
    .eq("user_id", session.userId);

  return (data ?? [])
    .map((ligne) => ligne.organizations)
    .filter((org): org is Espace => Boolean(org))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
});
