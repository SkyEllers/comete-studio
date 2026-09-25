"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ouvrir } from "@/tools/agent/conversations";
import { recevoir } from "@/tools/agent/entrees";
import { traiter } from "@/tools/agent/file";
import { envoyerResumeTest } from "@/tools/agent/resume";
import { maintenantDe, tournerConversation } from "@/tools/agent/moteur";
import { CLES_PROFILS, profil as profilDe } from "@/tools/agent/profils";
import { invitationCalendly } from "@/tools/agent/reservation";
import {
  ajouterJours,
  instantLocal,
  intervalleMs,
  jourLocal,
} from "@/tools/agent/temps";

/**
 * L'administration de l'agent, et la simulation où Louis joue la cliente.
 *
 * Une simulation passe par exactement le même chemin qu'une vraie
 * réservation (`ouvrir`, le planning, le moteur, `recevoir`) : seuls le canal
 * et l'horloge changent. Elle n'écrit ni dans Calendly ni dans Radar.
 */

const PARIS = "Europe/Paris";
const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

// ------------------------------- Réglages ----------------------------------

const schemaReglages = z.object({
  organization_id: z.uuid("Choisis un client."),
  profil: z.enum(CLES_PROFILS as [string, ...string[]], "Profil inconnu."),
});

export async function creerReglages(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const lu = schemaReglages.safeParse({
    organization_id: formData.get("organization_id"),
    profil: formData.get("profil"),
  });
  if (!lu.success) return failFromZod(lu.error);

  const { error } = await createAdminClient()
    .from("agent_reglages")
    .upsert(lu.data, { onConflict: "organization_id" });
  if (error) return fail("Le réglage n'a pas pu être enregistré.");

  revalidatePath("/admin/agent");
  return ok();
}

// ------------------------------ Simulation ---------------------------------

const schemaSimulation = z.object({
  organization_id: z.uuid("Choisis un client."),
  prenom: z.string().trim().min(1, "Donne-lui un prénom.").max(40),
  rdv: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choisis le jour et l'heure du rendez-vous."),
  reponses: z.array(z.string().max(2000)),
});

export async function nouvelleSimulation(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const lu = schemaSimulation.safeParse({
    organization_id: formData.get("organization_id"),
    prenom: formData.get("prenom"),
    rdv: formData.get("rdv"),
    reponses: formData.getAll("reponse").map(String),
  });
  if (!lu.success) return failFromZod(lu.error);
  const { organization_id, prenom, rdv, reponses } = lu.data;

  const admin = createAdminClient();
  const { data: reglages } = await admin
    .from("agent_reglages")
    .select("profil, delai_minimum")
    .eq("organization_id", organization_id)
    .maybeSingle();
  const profil = reglages ? profilDe(reglages.profil) : null;
  if (!reglages || !profil) return fail("Ce client n'a pas d'agent réglé.");

  const [jour, heure] = rdv.split("T");
  const [h, m] = heure.split(":").map(Number);
  const debut = instantLocal(jour, h, m, PARIS);
  const maintenant = Date.now();
  if (debut <= maintenant) return fail("Le rendez-vous doit être dans le futur.", "rdv");

  const id = randomUUID();
  const invite = invitationCalendly.parse({
    uri: `simulation:${id}`,
    email: "simulation@cometestudio.fr",
    name: prenom,
    created_at: new Date(maintenant).toISOString(),
    timezone: PARIS,
    // Une vraie réservation Calendly porte toujours ces liens ; sans eux,
    // l'agent ne pourrait pas donner le lien au deuxième report.
    reschedule_url: `https://calendly.com/reschedulings/simulation-${id}`,
    cancel_url: `https://calendly.com/cancellations/simulation-${id}`,
    questions_and_answers: profil.formulaire.map((q, position) => ({
      question: q.question,
      answer: reponses[position] ?? "",
      position,
    })),
    scheduled_event: {
      uri: `simulation:${id}:rdv`,
      start_time: new Date(debut).toISOString(),
      end_time: new Date(debut + profil.dureeMinutes * MINUTE).toISOString(),
      event_type: null,
      location: { type: "zoom", join_url: "https://zoom.us/j/simulation" },
    },
  });

  const issue = await ouvrir(admin, organization_id, profil, invite, {
    delaiMinimumMs: intervalleMs(reglages.delai_minimum),
    recuLe: invite.created_at ?? new Date().toISOString(),
    simulation: true,
  });
  if (issue === "erreur") return fail("La simulation n'a pas pu s'ouvrir.");

  const { data: conversation } = await admin
    .from("agent_conversations")
    .select("id")
    .eq("invitee_uri", invite.uri)
    .single();
  if (!conversation) return fail("La simulation n'a pas pu s'ouvrir.");

  // Le premier message part « dans la minute » : ici, tout de suite.
  await tournerConversation(admin, conversation.id);
  redirect(`/admin/agent/${conversation.id}`);
}

// ------------------------- Dans une conversation ---------------------------

const schemaRepondre = z.object({
  id: z.uuid(),
  texte: z.string().trim().min(1, "Écris quelque chose.").max(2000),
});

/** Louis, dans le rôle de la cliente, écrit ou touche un bouton. */
export async function repondre(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  // Un bouton touché l'emporte sur le champ de texte, resté vide.
  const lu = schemaRepondre.safeParse({
    id: formData.get("id"),
    texte: formData.get("bouton") || formData.get("texte"),
  });
  if (!lu.success) return failFromZod(lu.error);

  const admin = createAdminClient();
  const seulementSimulation = await estSimulation(admin, lu.data.id);
  if (!seulementSimulation) return fail("On ne répond qu'à la place d'une cliente simulée.");

  const recu = await recevoir(admin, lu.data.id, lu.data.texte);
  if (!recu) return fail("Le message n'a pas pu être noté.");

  await tournerConversation(admin, lu.data.id);
  revalidatePath(`/admin/agent/${lu.data.id}`);
  return ok();
}

async function estSimulation(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data } = await admin
    .from("agent_conversations")
    .select("simulation")
    .eq("id", id)
    .maybeSingle();
  return data?.simulation === true;
}

const schemaHorloge = z.object({
  id: z.uuid(),
  vers: z.enum(["heure", "jour", "10h", "veille", "matin", "apres", "maintenant"]),
});

/**
 * Avancer l'horloge d'une simulation, puis laisser le planning faire ce
 * qu'il ferait à cette heure-là. On n'avance jamais à reculons : un envoi
 * déjà parti resterait dans le futur.
 */
export async function avancerHorloge(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const lu = schemaHorloge.safeParse({ id: formData.get("id"), vers: formData.get("vers") });
  if (!lu.success) return failFromZod(lu.error);

  const admin = createAdminClient();
  const { data: c } = await admin
    .from("agent_conversations")
    .select("simulation, decalage, rdv_debut, rdv_fin, fuseau")
    .eq("id", lu.data.id)
    .maybeSingle();
  if (!c?.simulation) return fail("Seule une simulation a une horloge qu'on avance.");

  const reel = Date.now();
  const actuel = maintenantDe(c, reel);
  const jourRdv = jourLocal(c.rdv_debut, c.fuseau);
  const aujourdhui = jourLocal(actuel, c.fuseau);

  const cibles: Record<typeof lu.data.vers, number> = {
    maintenant: actuel,
    heure: actuel + HEURE,
    jour: actuel + 24 * HEURE,
    "10h": instantLocal(
      actuel < instantLocal(aujourdhui, 10, 0, c.fuseau) ? aujourdhui : ajouterJours(aujourdhui, 1),
      10,
      0,
      c.fuseau,
    ),
    veille: instantLocal(ajouterJours(jourRdv, -1), 10, 0, c.fuseau),
    matin: Math.min(instantLocal(jourRdv, 8, 0, c.fuseau), Date.parse(c.rdv_debut) - HEURE),
    apres: Date.parse(c.rdv_fin) + MINUTE,
  };
  const cible = cibles[lu.data.vers];
  if (cible < actuel) return fail("Ce moment est déjà passé dans cette simulation.");

  const secondes = Math.round((cible - reel) / 1000);
  await admin
    .from("agent_conversations")
    .update({ decalage: `${secondes} seconds` })
    .eq("id", lu.data.id);

  await tournerConversation(admin, lu.data.id, reel);
  revalidatePath(`/admin/agent/${lu.data.id}`);
  return ok();
}

export async function supprimerSimulation(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return fail("Simulation introuvable.");

  const { error } = await createAdminClient()
    .from("agent_conversations")
    .delete()
    .eq("id", id.data)
    .eq("simulation", true);
  if (error) return fail("La simulation n'a pas pu être supprimée.");

  redirect("/admin/agent");
}

// ------------------------------ La file ------------------------------------

const schemaQuestion = z.discriminatedUnion("choix", [
  z.object({
    id: z.uuid(),
    choix: z.literal("envoyer"),
    texte: z.string().trim().min(1, "Écris la réponse.").max(2000),
    garder: z.boolean(),
    question_type: z.string().trim().max(2000),
  }),
  z.object({ id: z.uuid(), choix: z.literal("classer") }),
]);

/**
 * Louis tranche une question de la file : la réponse part dans la voix de
 * l'agent (et devient une réponse fixe s'il la garde), ou la question est
 * classée sans rien envoyer.
 */
export async function traiterQuestion(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const lu = schemaQuestion.safeParse({
    id: formData.get("id"),
    choix: formData.get("choix"),
    texte: formData.get("texte") ?? "",
    garder: formData.get("garder") === "on",
    question_type: formData.get("question_type") ?? "",
  });
  if (!lu.success) return failFromZod(lu.error);

  const d = lu.data;
  if (d.choix === "envoyer" && d.garder && !d.question_type) {
    return fail("Écris la question type à garder, ou décoche « Garder ».", "question_type");
  }

  const admin = createAdminClient();
  const issue = await traiter(
    admin,
    d.id,
    d.choix === "classer"
      ? { choix: "classer" }
      : { choix: "envoyer", texte: d.texte, fixe: d.garder ? { question: d.question_type } : null },
  );
  if (!issue.ok) return fail(issue.erreur);

  revalidatePath("/admin/agent/file");
  revalidatePath("/admin/agent");
  return ok();
}

/** Une réponse fixe qui ne tient plus : l'agent cesse de s'en servir. */
export async function retirerReponseFixe(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return fail("Réponse introuvable.");

  const { error } = await createAdminClient()
    .from("agent_reponses_fixes")
    .update({ actif: false })
    .eq("id", id.data);
  if (error) return fail("La réponse n'a pas pu être retirée.");

  revalidatePath("/admin/agent/file");
  return ok();
}

// --------------------------- Le mail du matin ------------------------------

const schemaResume = z.object({
  organization_id: z.uuid(),
  resume_actif: z.boolean(),
  resume_destinataires: z
    .array(z.email("Une adresse ne ressemble pas à une adresse mail."))
    .max(5, "Cinq adresses au plus."),
});

/** Qui reçoit le mail du matin, et s'il part. */
export async function reglerResume(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const lu = schemaResume.safeParse({
    organization_id: formData.get("organization_id"),
    resume_actif: formData.get("resume_actif") === "on",
    resume_destinataires: String(formData.get("resume_destinataires") ?? "")
      .split(/[\s,;]+/)
      .map((a) => a.trim())
      .filter(Boolean),
  });
  if (!lu.success) return failFromZod(lu.error);
  if (lu.data.resume_actif && lu.data.resume_destinataires.length === 0) {
    return fail("Donne au moins une adresse, ou laisse le mail éteint.", "resume_destinataires");
  }

  const { error } = await createAdminClient()
    .from("agent_reglages")
    .update({
      resume_actif: lu.data.resume_actif,
      resume_destinataires: lu.data.resume_destinataires,
    })
    .eq("organization_id", lu.data.organization_id);
  if (error) return fail("Le réglage n'a pas pu être enregistré.");

  revalidatePath("/admin/agent");
  return ok();
}

const schemaResumeTest = z.object({
  organization_id: z.uuid(),
  jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choisis un jour."),
});

/** Le mail du matin d'un jour choisi, simulations comprises, chez Louis seul. */
export async function testerResume(
  _precedent: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const lu = schemaResumeTest.safeParse({
    organization_id: formData.get("organization_id"),
    jour: formData.get("jour"),
  });
  if (!lu.success) return failFromZod(lu.error);

  const parti = await envoyerResumeTest(createAdminClient(), lu.data.organization_id, lu.data.jour);
  if (parti === null) return fail("Aucun diagnostic ce jour-là, même en simulation : rien à envoyer.");
  if (!parti) return fail("Le mail n'est pas parti (Resend).");
  return ok();
}
