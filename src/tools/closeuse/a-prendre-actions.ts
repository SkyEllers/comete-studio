"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { lecteurOccupe } from "@/tools/reservation/agenda";
import { personneCloseuse, raisonDeNePasPrendre } from "@/tools/reservation/a-prendre";
import { confierRendezVous } from "@/tools/reservation/confier";
import { identifiants } from "@/tools/reservation/google";

/**
 * Une closeuse prend elle-même un diagnostic de la titulaire que personne ne
 * couvre (Louis, 08/10/2026). Même geste que « Confier » côté admin : son
 * agenda, Radar, l'assistante, le mail à la cliente (nouveau lien de visio),
 * le mail « Nouveau diagnostic ». Tout est relu au clic.
 */
export async function prendreUnRendezVous(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ mailCliente: boolean }>> {
  const acces = await getMembership(orgSlug);
  if (!acces) return fail("Cet espace n'est plus accessible.");
  if (acces.role !== "closeuse") return fail("Seule la closeuse elle-même peut prendre un rendez-vous.");

  const parsed = z.object({ bookingId: z.uuid({ error: "Rendez-vous introuvable." }) }).safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const ids = identifiants();
  if (!ids) return fail("L'outil ne lit pas les agendas en ce moment : préviens Louis.");

  const admin = createAdminClient();
  const org = acces.org.id;
  const personne = await personneCloseuse(admin, org, acces.userId);
  if (!personne?.google_connecte_le || personne.google_agenda === "primary") {
    return fail("Relie d'abord ton agenda Google dans « Mon agenda ».");
  }

  const [{ data: rdv }, { data: reglages }] = await Promise.all([
    admin
      .from("radar_bookings")
      .select("id, scheduled_start, scheduled_end, closeuse_id, status, event_type_name")
      .eq("id", parsed.data.bookingId)
      .eq("organization_id", org)
      .maybeSingle(),
    admin.from("reservation_reglages").select("preavis_minutes").eq("organization_id", org).maybeSingle(),
  ]);
  if (!rdv || !/diagnostic/i.test(rdv.event_type_name ?? "")) return fail("Rendez-vous introuvable.");

  const raison = await raisonDeNePasPrendre(
    admin,
    org,
    personne.id,
    rdv,
    lecteurOccupe(admin, ids),
    reglages?.preavis_minutes ?? 120,
  );
  if (raison) return fail(raison);

  // Deux closeuses qui cliquent en même temps : la première qui le réserve
  // dans Radar l'a, l'autre reçoit « une autre vient de le prendre ».
  const { data: reserve } = await admin
    .from("radar_bookings")
    .update({ closeuse_id: acces.userId, updated_at: new Date().toISOString() })
    .eq("id", rdv.id)
    .is("closeuse_id", null)
    .select("id");
  if (!reserve?.length) return fail("Une autre closeuse vient de le prendre.");

  const r = await confierRendezVous(admin, org, rdv.id, personne.id, ids);
  if (!r.ok) {
    await admin.from("radar_bookings").update({ closeuse_id: null }).eq("id", rdv.id).eq("closeuse_id", acces.userId);
    return fail(r.erreur);
  }
  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok({ mailCliente: r.mailCliente });
}
