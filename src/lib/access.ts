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
 * Garde d'entrée d'un espace client. Toujours `notFound()` en cas de refus :
 * on ne confirme jamais l'existence d'un client à quelqu'un qui n'y est pas.
 * Louis passe partout, avec le rôle `admin`.
 */
export async function requireMembership(slug: string): Promise<Access> {
  const session = await requireUser();

  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", org.id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (membership) return { ...session, org, role: membership.role };
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

  const supabase = await createClient();
  const { data: hasTool, error } = await supabase.rpc("has_tool", {
    org: access.org.id,
    tool_slug: toolSlug,
  });

  if (error || !hasTool) notFound();

  return access;
}
