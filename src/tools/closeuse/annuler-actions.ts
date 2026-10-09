"use server";

import { createHash, randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifierSite, outilVersAgent } from "@/tools/agent/outil";
import { lienMonRdv } from "@/tools/agent/outil-regles";
import { effacerRendezVous } from "@/tools/reservation/agenda";
import { siteDuClient } from "@/tools/reservation/confier";
import { identifiants } from "@/tools/reservation/google";
import { annulerDansRadar } from "@/tools/reservation/radar";

/**
 * La closeuse annule un diagnostic que la cliente lui a demandé d'annuler
 * (Louis, 09/10/2026 : Maryline et Flora avaient annulé auprès de Marion, et
 * rien ne bougeait dans l'outil). Même chemin que l'annulation par la cliente
 * avec son lien : la base (le créneau se libère), l'agenda Google, Radar
 * (« Annulée par la personne », et Calendly suit), l'assistante se tait, et la
 * cliente reçoit le mail du site « Ton diagnostic est annulé », avec un bouton
 * pour reprendre un rendez-vous.
 */

const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");

export async function annulerUnRendezVous(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ mailCliente: boolean }>> {
  const acces = await getMembership(orgSlug);
  if (!acces) return fail("Cet espace n'est plus accessible.");
  if (acces.role !== "closeuse") return fail("Seule la closeuse du rendez-vous peut l'annuler.");
  const parsed = z.object({ bookingId: z.uuid({ error: "Rendez-vous introuvable." }) }).safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const admin = createAdminClient();
  const org = acces.org.id;
  const { data: rdv } = await admin
    .from("radar_bookings")
    .select("id, organization_id, closeuse_id, status, scheduled_start")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();
  if (!rdv || rdv.organization_id !== org || rdv.closeuse_id !== acces.userId) return fail("Ce rendez-vous ne t'est pas confié.");
  if (rdv.status !== "confirme") return fail("Ce rendez-vous n'est plus confirmé.");

  const { data: ligne } = await admin
    .from("reservation_rendez_vous")
    .select("id")
    .eq("radar_booking_id", rdv.id)
    .eq("statut", "confirme")
    .maybeSingle();
  if (!ligne) return fail("Ce rendez-vous n'est pas dans l'outil : il s'annule dans Calendly.");

  // Un nouveau lien personnel : le site ne croit que lui pour envoyer le mail.
  const jeton = randomBytes(32).toString("hex");
  const { error: eJeton } = await admin.from("reservation_rendez_vous").update({ jeton_hash: empreinte(jeton) }).eq("id", ligne.id);
  if (eJeton) return fail("Le rendez-vous n'a pas pu être annulé.");

  const { error } = await admin.rpc("reservation_annuler", { rendez_vous: ligne.id, par: "cliente" });
  if (error) return fail("Le rendez-vous n'a pas pu être annulé.");

  const ids = identifiants();
  if (ids) {
    try {
      await effacerRendezVous(admin, ligne.id, ids);
    } catch (erreur) {
      console.error("Annulation par la closeuse, Google :", erreur instanceof Error ? erreur.message : "erreur");
    }
  }
  await annulerDansRadar(admin, ligne.id, { reprogramme: false, par: "cliente" });
  await outilVersAgent(admin, org, { type: "annule", rdvId: ligne.id });
  const mailCliente = await notifierSite(lienMonRdv(await siteDuClient(admin, org), jeton), "annule");

  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok({ mailCliente });
}
