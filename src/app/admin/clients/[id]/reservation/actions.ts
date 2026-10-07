"use server";

import { createHash, randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { lireJeton, reecrireDescription } from "@/tools/reservation/agenda";
import { confierRendezVous } from "@/tools/reservation/confier";
import { identifiants, jetonAcces, teinterConfie, type Teinte } from "@/tools/reservation/google";
import { baseEspace } from "@/tools/reservation/suites";

/**
 * L'administration de la réservation d'un client, réservée à Louis (0042).
 * Client admin, organisation dans chaque filtre : un identifiant recopié
 * d'un autre onglet ne touche jamais un autre client.
 */

const organisation = z.uuid({ error: "Client introuvable." });

function rafraichir(organizationId: string) {
  revalidatePath(`/admin/clients/${organizationId}/reservation`);
}

/** Poser les réglages du client, réservation fermée : rien n'est proposé au public. */
export async function preparerReservation(organizationId: unknown): Promise<ActionResult> {
  await requireAdmin();
  const org = organisation.safeParse(organizationId);
  if (!org.success) return failFromZod(org.error);

  const admin = createAdminClient();
  const { error } = await admin
    .from("reservation_reglages")
    .upsert({ organization_id: org.data, actif: false }, { onConflict: "organization_id", ignoreDuplicates: true });
  if (error) return fail(`Réglages : ${error.message}`);

  rafraichir(org.data);
  return ok();
}

const ajoutSchema = z.object({ organizationId: organisation, userId: z.uuid({ error: "Choisis une personne." }) });

/**
 * Ajouter quelqu'un qui prendra des diagnostics : une closeuse du client
 * devient closeuse, une membre devient la titulaire (une seule par client).
 */
export async function ajouterPersonne(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = ajoutSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, userId } = parsed.data;

  const admin = createAdminClient();
  const { data: membre } = await admin
    .from("memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membre) return fail("Cette personne n'est pas dans l'espace de ce client.");

  const role = membre.role === "closeuse" ? "closeuse" : "titulaire";
  const { error } = await admin.from("reservation_personnes").insert({ organization_id: organizationId, user_id: userId, role });
  if (error) {
    return fail(
      error.code === "23505"
        ? role === "titulaire"
          ? "Ce client a déjà sa titulaire, ou cette personne est déjà ajoutée."
          : "Cette personne est déjà ajoutée."
        : `Ajout : ${error.message}`,
    );
  }

  rafraichir(organizationId);
  return ok();
}

const actifSchema = z.object({ organizationId: organisation, personneId: z.uuid(), actif: z.boolean() });

/** Sortir quelqu'un du roulement (ou l'y remettre). Ses rendez-vous restent. */
export async function basculerPersonne(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = actifSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, personneId, actif } = parsed.data;

  const admin = createAdminClient();
  const { error } = await admin
    .from("reservation_personnes")
    .update({ actif })
    .eq("id", personneId)
    .eq("organization_id", organizationId);
  if (error) return fail(`Mise à jour : ${error.message}`);

  rafraichir(organizationId);
  return ok();
}

const ouvertureSchema = z.object({ organizationId: organisation, actif: z.boolean() });

/**
 * Ouvrir ou fermer la réservation. Fermée, la page du site ne propose rien
 * (`{ etat: "ferme" }`). Chez Peggy, elle ne s'ouvre qu'à la bascule.
 */
export async function ouvrirReservation(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = ouvertureSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, actif } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reservation_reglages")
    .update({ actif })
    .eq("organization_id", organizationId)
    .select("organization_id");
  if (error) return fail(`Réglages : ${error.message}`);
  if (!data || data.length === 0) return fail("Réglages introuvables : prépare d'abord la réservation.");

  rafraichir(organizationId);
  return ok();
}

const jetonSchema = z.object({
  organizationId: organisation,
  label: z.string().trim().min(1, { error: "Donne-lui un nom." }).max(60, { error: "60 caractères au plus." }),
});

/**
 * Un jeton pour le serveur du site (0045). Rendu une seule fois : seul son
 * SHA-256 est gardé. Il se range dans les variables de Vercel du site
 * (`COMETE_RESERVATION_TOKEN`), jamais dans le code.
 */
export async function creerJetonPage(input: unknown): Promise<ActionResult<{ jeton: string }>> {
  await requireAdmin();
  const parsed = jetonSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, label } = parsed.data;

  const jeton = randomBytes(32).toString("hex");
  const admin = createAdminClient();
  const { error } = await admin.from("reservation_jetons").insert({
    organization_id: organizationId,
    label,
    token_hash: createHash("sha256").update(jeton).digest("hex"),
  });
  if (error) return fail(`Jeton : ${error.message}`);

  rafraichir(organizationId);
  return ok({ jeton });
}

const revocationSchema = z.object({ organizationId: organisation, jetonId: z.uuid() });

export async function revoquerJetonPage(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = revocationSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, jetonId } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reservation_jetons")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", jetonId)
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .select("id");
  if (error) return fail(`Révocation : ${error.message}`);
  if (!data || data.length === 0) return fail("Ce jeton est déjà révoqué.");

  rafraichir(organizationId);
  return ok();
}

/**
 * Réécrire, dans les agendas Google, la description des diagnostics à venir
 * pris avant le 30/09/2026 : numéro, réponses et lien de la fiche (Louis).
 * Sans risque à relancer : la description est simplement réécrite.
 */
export async function reecrireDescriptions(
  organizationId: unknown,
): Promise<ActionResult<{ reecrits: number; echecs: number }>> {
  await requireAdmin();
  const org = organisation.safeParse(organizationId);
  if (!org.success) return failFromZod(org.error);
  const ids = identifiants();
  if (!ids) return fail("Identifiants Google absents du serveur.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reservation_rendez_vous")
    .select("id")
    .eq("organization_id", org.data)
    .eq("statut", "confirme")
    .not("google_event_id", "is", null)
    .gt("debut", new Date().toISOString())
    .order("debut")
    .limit(100);
  if (error) return fail(`Rendez-vous : ${error.message}`);

  const base = await baseEspace(admin, org.data);
  let reecrits = 0;
  let echecs = 0;
  for (const r of data ?? []) {
    try {
      if (await reecrireDescription(admin, r.id, ids, base)) reecrits++;
    } catch (erreur) {
      echecs++;
      console.error("Réservation, description :", erreur instanceof Error ? erreur.message : "erreur");
    }
  }
  return ok({ reecrits, echecs });
}

/**
 * Les rendez-vous Calendly déjà confiés à une closeuse, à venir : leur
 * événement chez la titulaire passe en Tomate et « Disponible » (Louis,
 * 07/10/2026 : ceux confiés avant que « Confier » le fasse tout seul). Sans
 * risque à relancer : un événement déjà en Tomate le reste.
 */
export async function teinterDejaConfies(
  organizationId: unknown,
): Promise<ActionResult<{ resultats: { prenom: string; debut: string; resultat: Teinte | "sans_adresse" | "erreur" }[] }>> {
  await requireAdmin();
  const org = organisation.safeParse(organizationId);
  if (!org.success) return failFromZod(org.error);
  const ids = identifiants();
  if (!ids) return fail("Identifiants Google absents du serveur.");

  const admin = createAdminClient();
  const [{ data: rdvs, error }, { data: titulaire }] = await Promise.all([
    admin
      .from("radar_bookings")
      .select("id, scheduled_start, scheduled_end, invitee_first_name, invitee_uri")
      .eq("organization_id", org.data)
      .eq("status", "confirme")
      .not("closeuse_id", "is", null)
      .gt("scheduled_start", new Date().toISOString())
      .not("invitee_uri", "like", "reservation:%")
      .order("scheduled_start"),
    admin.from("reservation_personnes").select("id").eq("organization_id", org.data).eq("role", "titulaire").maybeSingle(),
  ]);
  if (error) return fail(`Rendez-vous : ${error.message}`);
  const jeton = titulaire ? await lireJeton(admin, titulaire.id) : null;
  if (!jeton) return fail("L'agenda de la titulaire n'est pas connecté.");
  const acces = await jetonAcces(jeton, ids);

  const resultats: { prenom: string; debut: string; resultat: Teinte | "sans_adresse" | "erreur" }[] = [];
  for (const r of rdvs ?? []) {
    const { data: ligne } = await admin
      .from("reservation_rendez_vous")
      .select("email")
      .eq("radar_booking_id", r.id)
      .not("email", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prenom = r.invitee_first_name || "Une cliente";
    if (!ligne?.email) {
      resultats.push({ prenom, debut: r.scheduled_start, resultat: "sans_adresse" });
      continue;
    }
    try {
      const resultat = await teinterConfie(acces, { debut: r.scheduled_start, fin: r.scheduled_end, email: ligne.email });
      resultats.push({ prenom, debut: r.scheduled_start, resultat });
    } catch (erreur) {
      console.error("Tomate, déjà confiés :", erreur instanceof Error ? erreur.message : "erreur");
      resultats.push({ prenom, debut: r.scheduled_start, resultat: "erreur" });
    }
  }
  return ok({ resultats });
}

const confierSchema = z.object({
  organizationId: organisation,
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  personneId: z.uuid({ error: "Closeuse introuvable." }),
});

/**
 * Confier à une closeuse un diagnostic pris chez la titulaire (Louis,
 * 06/10/2026) : son agenda, le nouveau lien à la cliente, Radar, l'assistante.
 */
export async function confierUnRendezVous(
  input: unknown,
): Promise<ActionResult<{ mailCliente: boolean; calendly: boolean; agendaTitulaire: string | null }>> {
  await requireAdmin();
  const parsed = confierSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const ids = identifiants();
  if (!ids) return fail("Identifiants Google absents du serveur.");

  const admin = createAdminClient();
  const r = await confierRendezVous(admin, parsed.data.organizationId, parsed.data.bookingId, parsed.data.personneId, ids);
  if (!r.ok) return fail(r.erreur);
  revalidatePath(`/admin/clients/${parsed.data.organizationId}/reservation`);
  return ok({ mailCliente: r.mailCliente, calendly: r.calendly, agendaTitulaire: r.agendaTitulaire });
}
