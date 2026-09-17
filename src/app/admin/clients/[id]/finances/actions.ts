"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { contenuSchema, lireLignes, lireMontant } from "@/tools/horizon/contenu";

/**
 * Les relevés d'Horizon, écrits par Louis et par lui seul.
 *
 * `requireAdmin()` d'abord, clé de service ensuite : la RLS réserve déjà
 * l'écriture à l'administration, et ces actions ne s'en remettent pas à elle
 * pour le décider — les deux couches, comme partout.
 *
 * Le formulaire arrive en texte (lignes « Libellé ; montant », montants en
 * euros) : tout est converti en centimes ici, puis le document entier passe le
 * schéma avant d'être écrit.
 */

const identifiant = z.uuid({ error: "Client introuvable." });
const moisSaisi = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Choisis un mois." })
  .transform((valeur) => `${valeur}-01`);

export type SaisieReleve = {
  organizationId: string;
  mois: string;
  publie: boolean;
  resume: string;
  entrees: string;
  charges: string;
  vie: string;
  aVenir: string;
  tauxImpots: string;
  salaire: string;
  impots: string;
  bloque: string;
  fondsRoulement: string;
  reserve: string;
  palierReserve: string;
  objectifReserve: string;
  ecarts: string;
  notionTitre: string;
  notionTexte: string;
};

function rafraichir(organizationId: string, slug: string | null) {
  revalidatePath(`/admin/clients/${organizationId}/finances`);
  if (slug) revalidatePath(`/app/${slug}/finances`);
}

function montantOuZero(valeur: string, champ: string): number | ActionResult<never> {
  if (!valeur.trim()) return 0;
  const centimes = lireMontant(valeur);
  return centimes === null ? fail(`« ${valeur} » n'est pas un montant.`, champ) : centimes;
}

export async function enregistrerReleve(saisie: SaisieReleve): Promise<ActionResult<{ mois: string }>> {
  await requireAdmin();

  const org = identifiant.safeParse(saisie.organizationId);
  if (!org.success) return fail("Client introuvable.");

  const mois = moisSaisi.safeParse(saisie.mois);
  if (!mois.success) return fail("Choisis un mois.", "mois");

  const listes = {
    entrees: lireLignes(saisie.entrees),
    charges: lireLignes(saisie.charges),
    vie: lireLignes(saisie.vie, { avecBudget: true }),
    aVenir: lireLignes(saisie.aVenir),
  };
  for (const [champ, lu] of Object.entries(listes)) {
    if (!lu.ok) return fail(lu.erreur, champ);
  }

  const montants: Record<string, number> = {};
  for (const champ of [
    "salaire",
    "impots",
    "bloque",
    "fondsRoulement",
    "reserve",
    "palierReserve",
    "objectifReserve",
  ] as const) {
    const lu = montantOuZero(saisie[champ], champ);
    if (typeof lu !== "number") return lu;
    montants[champ] = lu;
  }

  const taux = Number(saisie.tauxImpots || "40");
  if (!Number.isInteger(taux) || taux < 0 || taux > 100) {
    return fail("Le taux des impôts est un nombre entier entre 0 et 100.", "tauxImpots");
  }

  const contenu = contenuSchema.safeParse({
    resume: saisie.resume,
    entrees: listes.entrees.ok ? listes.entrees.lignes : [],
    charges: listes.charges.ok ? listes.charges.lignes : [],
    vie: listes.vie.ok ? listes.vie.lignes : [],
    aVenir: listes.aVenir.ok ? listes.aVenir.lignes : [],
    tauxImpots: taux,
    salaireCentimes: montants.salaire,
    poches: {
      impotsCentimes: montants.impots,
      bloqueCentimes: montants.bloque,
      fondsRoulementCentimes: montants.fondsRoulement,
      reserveCentimes: montants.reserve,
    },
    objectifs: {
      palierReserveCentimes: montants.palierReserve,
      objectifReserveCentimes: montants.objectifReserve,
    },
    ecarts: saisie.ecarts
      .split(/\r?\n/)
      .map((ligne) => ligne.trim())
      .filter(Boolean),
    notion: { titre: saisie.notionTitre, texte: saisie.notionTexte },
  });

  if (!contenu.success) {
    const probleme = contenu.error.issues[0];
    return fail(
      probleme?.path.includes("ecarts")
        ? "Trois écarts au plus, 240 caractères chacun."
        : "Un champ dépasse la longueur permise.",
    );
  }

  const admin = createAdminClient();
  const { data: organisation } = await admin
    .from("organizations")
    .select("slug")
    .eq("id", org.data)
    .maybeSingle();
  if (!organisation) return fail("Client introuvable.");

  const { error } = await admin.from("horizon_releves").upsert(
    {
      organization_id: org.data,
      mois: mois.data,
      publie: saisie.publie,
      contenu: contenu.data,
    },
    { onConflict: "organization_id,mois" },
  );

  if (error) return fail("Ce relevé n'a pas pu être enregistré.");

  rafraichir(org.data, organisation.slug);
  return ok({ mois: mois.data });
}

export async function supprimerReleve(organizationId: unknown, id: unknown): Promise<ActionResult> {
  await requireAdmin();

  const org = identifiant.safeParse(organizationId);
  const releve = z.uuid().safeParse(id);
  if (!org.success || !releve.success) return fail("Relevé introuvable.");

  const admin = createAdminClient();
  const { data: organisation } = await admin
    .from("organizations")
    .select("slug")
    .eq("id", org.data)
    .maybeSingle();

  const { error } = await admin
    .from("horizon_releves")
    .delete()
    .eq("id", releve.data)
    .eq("organization_id", org.data);

  if (error) return fail("Ce relevé n'a pas pu être supprimé.");

  rafraichir(org.data, organisation?.slug ?? null);
  return ok();
}
