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
 * Garde d'entrée d'un espace client. Toujours `notFound()` en cas de refus :
 * on ne confirme jamais l'existence d'un client à quelqu'un qui n'y est pas.
 * Louis passe partout, avec le rôle `admin`.
 */
export async function requireMembership(slug: string): Promise<Access> {
  const session = await requireUser();

  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const role = await getMembershipRole(org.id, session.user.id);

  if (role) return { ...session, org, role };
  if (session.profile.is_admin) return { ...session, org, role: "admin" };

  notFound();
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
