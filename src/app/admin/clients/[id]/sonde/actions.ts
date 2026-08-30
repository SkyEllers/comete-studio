"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { hote } from "@/tools/sonde/collecte";

/**
 * Les sites de Sonde, déclarés par Louis et par lui seul.
 *
 * `requireAdmin()` d'abord, clé de service ensuite : la RLS réserve déjà
 * l'écriture à l'administration, et ces actions ne s'en remettent pas à elle
 * pour le décider — les deux couches, comme partout.
 *
 * Le jeton n'ouvre rien : il désigne un site, il n'authentifie personne, et il
 * voyage en clair dans le HTML de la landing. Ce qu'il faut en protéger n'est
 * pas la confidentialité mais l'unicité — deux sites qui partageraient un
 * jeton mélangeraient leurs chiffres.
 */

const identifiant = z.uuid({ error: "Client introuvable." });
const siteId = z.uuid({ error: "Site introuvable." });

const nomSite = z
  .string({ error: "Donne un nom à ce site." })
  .trim()
  .min(1, { error: "Donne un nom à ce site." })
  .max(60, { error: "Le nom ne peut pas dépasser 60 caractères." });

/**
 * Les domaines autorisés, un par ligne ou séparés par des virgules.
 *
 * Chacun est réduit à son hôte : Louis peut coller une URL complète, ce qui
 * est ce qu'on fait naturellement quand on vient du navigateur du client.
 */
const domaines = z
  .string()
  .max(500, { error: "Trop de domaines d'un coup." })
  .transform((brut) =>
    [
      ...new Set(
        brut
          .split(/[\s,;]+/)
          .map((morceau) => hote(morceau))
          .filter((valeur): valeur is string => Boolean(valeur)),
      ),
    ].slice(0, 10),
  )
  .refine((liste) => liste.length > 0, {
    error: "Donne au moins un domaine, par exemple jonathan-cuinat.com.",
  });

/** Seize octets, en hexadécimal : la même forme que le défaut de la base. */
const nouveauJeton = () => randomBytes(16).toString("hex");

function rafraichir(organizationId: string) {
  revalidatePath(`/admin/clients/${organizationId}/sonde`);
  revalidatePath("/admin/radar");
}

export async function creerSite(
  organizationId: unknown,
  nom: unknown,
  hotes: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();

  const org = identifiant.safeParse(organizationId);
  if (!org.success) return fail("Client introuvable.");

  const parsedNom = nomSite.safeParse(nom);
  if (!parsedNom.success) return failFromZod(parsedNom.error);

  const parsedDomaines = domaines.safeParse(typeof hotes === "string" ? hotes : "");
  if (!parsedDomaines.success) {
    return fail(
      parsedDomaines.error.issues[0]?.message ?? "Domaines invalides.",
      "domaines",
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sonde_sites")
    .insert({
      organization_id: org.data,
      name: parsedNom.data,
      domains: parsedDomaines.data,
      token: nouveauJeton(),
    })
    .select("id")
    .single();

  if (error || !data) return fail("Ce site n'a pas pu être déclaré.");

  rafraichir(org.data);
  return ok({ id: data.id });
}

export async function modifierSite(
  organizationId: unknown,
  id: unknown,
  nom: unknown,
  hotes: unknown,
): Promise<ActionResult> {
  await requireAdmin();

  const org = identifiant.safeParse(organizationId);
  const cible = siteId.safeParse(id);
  if (!org.success || !cible.success) return fail("Site introuvable.");

  const parsedNom = nomSite.safeParse(nom);
  if (!parsedNom.success) return failFromZod(parsedNom.error);

  const parsedDomaines = domaines.safeParse(typeof hotes === "string" ? hotes : "");
  if (!parsedDomaines.success) {
    return fail(
      parsedDomaines.error.issues[0]?.message ?? "Domaines invalides.",
      "domaines",
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("sonde_sites")
    .update({ name: parsedNom.data, domains: parsedDomaines.data })
    .eq("id", cible.data)
    .eq("organization_id", org.data);

  if (error) return fail("Ce site n'a pas pu être modifié.");

  rafraichir(org.data);
  return ok();
}

/**
 * Éteindre ou rallumer un site.
 *
 * Éteint, il cesse de mesurer à la requête suivante — la route relit l'état à
 * chaque événement, sans cache. Ses chiffres passés restent : c'est un
 * interrupteur, pas une suppression.
 */
export async function basculerSite(
  organizationId: unknown,
  id: unknown,
  actif: unknown,
): Promise<ActionResult> {
  await requireAdmin();

  const org = identifiant.safeParse(organizationId);
  const cible = siteId.safeParse(id);
  const etat = z.boolean().safeParse(actif);
  if (!org.success || !cible.success || !etat.success) return fail("Site introuvable.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("sonde_sites")
    .update({ is_active: etat.data })
    .eq("id", cible.data)
    .eq("organization_id", org.data);

  if (error) return fail("Ce site n'a pas pu être basculé.");

  rafraichir(org.data);
  return ok();
}

/**
 * Régénérer le jeton.
 *
 * L'ancien meurt à l'instant : la balise posée sur la landing cesse d'être
 * reconnue dès la requête suivante, et la page ne mesure plus rien tant que
 * personne n'y a collé la nouvelle. C'est le seul geste irréversible de cet
 * écran, d'où l'avertissement à l'écran plutôt qu'ici.
 */
export async function regenererJeton(
  organizationId: unknown,
  id: unknown,
): Promise<ActionResult<{ token: string }>> {
  await requireAdmin();

  const org = identifiant.safeParse(organizationId);
  const cible = siteId.safeParse(id);
  if (!org.success || !cible.success) return fail("Site introuvable.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sonde_sites")
    .update({ token: nouveauJeton() })
    .eq("id", cible.data)
    .eq("organization_id", org.data)
    .select("token")
    .single();

  if (error || !data) return fail("Le jeton n'a pas pu être régénéré.");

  rafraichir(org.data);
  return ok({ token: data.token });
}
