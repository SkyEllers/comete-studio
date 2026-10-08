"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CLES_ALERTES, CLES_POINTS, libelleAlerte } from "@/tools/analyse/grille";
import { etiquetteAlerte } from "@/tools/analyse/schema";
import { analyserUn, synthetiser } from "@/tools/analyse/moteur";

/**
 * Les gestes de Louis sur l'analyse des diagnostics (0056). Toujours
 * `requireAdmin()` d'abord, puis le service role.
 */

const id = z.string().uuid("Identifiant invalide.");

const decision = z.object({ id, statut: z.enum(["active", "refusee", "retiree"]) });

/** Valider une leçon proposée, la refuser, ou retirer une leçon du carnet. */
export async function deciderLecon(entree: z.input<typeof decision>): Promise<ActionResult> {
  await requireAdmin();
  const lu = decision.safeParse(entree);
  if (!lu.success) return failFromZod(lu.error);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("radar_analyse_lecons")
    .update({ statut: lu.data.statut, decidee_le: new Date().toISOString() })
    .eq("id", lu.data.id)
    .select("id");
  if (error || !data?.length) return fail("La leçon n'a pas pu être enregistrée.");
  revalidatePath("/admin/analyses");
  return ok();
}

const correction = z.object({
  bookingId: id,
  texte: z.string().trim().min(5, "Écris ta correction en une phrase au moins.").max(1000, "1 000 caractères au plus."),
  point: z.enum(["general", ...CLES_POINTS] as [string, ...string[]]),
  reanalyser: z.boolean(),
});

/**
 * « Pas d'accord » : la correction devient une leçon active tout de suite,
 * relue par toutes les analyses suivantes. Avec « relire cet appel », l'appel
 * repasse dans la file et sera réanalysé avec elle.
 */
export async function corrigerAnalyse(entree: z.input<typeof correction>): Promise<ActionResult> {
  await requireAdmin();
  const lu = correction.safeParse(entree);
  if (!lu.success) return failFromZod(lu.error);

  const admin = createAdminClient();
  const { data: analyse } = await admin
    .from("radar_analyses")
    .select("organization_id")
    .eq("booking_id", lu.data.bookingId)
    .maybeSingle();
  if (!analyse) return fail("Analyse introuvable.");

  const { error } = await admin.from("radar_analyse_lecons").insert({
    organization_id: analyse.organization_id,
    texte: lu.data.texte,
    point: lu.data.point,
    sens: "conseil",
    appuis: [lu.data.bookingId],
    nb_appuis: 1,
    statut: "active",
    origine: "correction",
    booking_id: lu.data.bookingId,
    decidee_le: new Date().toISOString(),
  });
  if (error) return fail("La correction n'a pas pu être enregistrée.");

  if (lu.data.reanalyser) {
    await admin.from("radar_analyses").update({ etat: "a_faire", tentatives: 0 }).eq("booking_id", lu.data.bookingId);
  }
  revalidatePath("/admin/analyses", "layout");
  return ok();
}

/** Relancer l'analyse d'un appel tout de suite (une à trois minutes). */
export async function relancerAnalyse(bookingId: string): Promise<ActionResult> {
  await requireAdmin();
  const lu = id.safeParse(bookingId);
  if (!lu.success) return failFromZod(lu.error);

  const admin = createAdminClient();
  await admin.from("radar_analyses").update({ etat: "a_faire", tentatives: 0 }).eq("booking_id", lu.data);
  const r = await analyserUn(admin, lu.data);
  revalidatePath("/admin/analyses", "layout");
  return r.ok ? ok() : fail(`L'analyse n'a pas abouti : ${r.erreur}. Elle sera retentée par l'horloge.`);
}

/** Lancer la synthèse sans attendre lundi. */
export async function lancerSynthese(organizationId: string): Promise<ActionResult<{ appels: number }>> {
  await requireAdmin();
  const lu = id.safeParse(organizationId);
  if (!lu.success) return failFromZod(lu.error);

  const r = await synthetiser(createAdminClient(), lu.data);
  revalidatePath("/admin/analyses");
  return r.ok ? ok({ appels: r.appels ?? 0 }) : fail(`La synthèse n'a pas abouti : ${r.erreur}.`);
}

const tranche = z.object({
  bookingId: id,
  cle: z.enum(CLES_ALERTES as [string, ...string[]]),
  minute: z.string().max(12),
  extrait: z.string().max(600),
  verdict: z.enum(["permis", "interdit"]),
  reponse: z.string().trim().max(600, "600 caractères au plus."),
});

/**
 * Trancher une alerte « à vérifier » (Louis, 08/10/2026). Le verdict entre au
 * carnet comme une correction, active tout de suite, relue par toutes les
 * analyses suivantes ; la `note` porte l'étiquette de l'alerte, qui la sort
 * de la liste. « Faux ou interdit » fait relire l'appel : l'alerte y devient
 * sûre, et la closeuse la voit.
 */
export async function trancherAlerte(entree: z.input<typeof tranche>): Promise<ActionResult> {
  await requireAdmin();
  const lu = tranche.safeParse(entree);
  if (!lu.success) return failFromZod(lu.error);
  const { bookingId, cle, minute, extrait, verdict, reponse } = lu.data;

  const admin = createAdminClient();
  const { data: analyse } = await admin
    .from("radar_analyses")
    .select("organization_id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (!analyse) return fail("Analyse introuvable.");

  const sujet = extrait ? `« ${extrait.slice(0, 300)} »` : libelleAlerte(cle).toLowerCase();
  const texte =
    verdict === "permis"
      ? `Vérifié par Louis : ${sujet} est vrai ou permis (${libelleAlerte(cle).toLowerCase()}). Ce n'est pas une alerte.`
      : `Vérifié par Louis : ${sujet} est faux ou interdit (${libelleAlerte(cle).toLowerCase()}). C'est une alerte sûre.`;

  const { error } = await admin.from("radar_analyse_lecons").insert({
    organization_id: analyse.organization_id,
    texte: reponse ? `${texte} La bonne réponse : ${reponse}` : texte,
    point: "general",
    sens: verdict === "permis" ? "conseil" : "perd",
    appuis: [bookingId],
    nb_appuis: 1,
    statut: "active",
    origine: "correction",
    booking_id: bookingId,
    note: etiquetteAlerte({ minute, cle }),
    decidee_le: new Date().toISOString(),
  });
  if (error) return fail("Le verdict n'a pas pu être enregistré.");

  if (verdict === "interdit") {
    await admin.from("radar_analyses").update({ etat: "a_faire", tentatives: 0 }).eq("booking_id", bookingId);
  }
  revalidatePath("/admin/analyses", "layout");
  return ok();
}
