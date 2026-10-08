import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { diagnosticsAConfier, type LireOccupe } from "./a-confier.ts";

/**
 * Les diagnostics de la titulaire que personne ne couvre, proposés aux
 * closeuses dans leur espace (Louis, 08/10/2026 : 17 rendez-vous de Peggy
 * sans closeuse disponible). Une closeuse peut en prendre un **même hors de
 * ses horaires**, tant que son agenda Google est libre à ce moment-là et
 * qu'elle n'a pas déjà un diagnostic dans l'outil. Les plus proches d'abord,
 * quatre au plus ; jamais un rendez-vous qui commence avant le préavis de la
 * page de réservation.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type APrendre = { bookingId: string; debut: string; fin: string; prenom: string };

export const A_PRENDRE_MAX = 4;

/** La fiche de réservation de la closeuse, si elle peut prendre des rendez-vous. */
export async function personneCloseuse(admin: Admin, org: string, userId: string) {
  const { data } = await admin
    .from("reservation_personnes")
    .select("id, google_connecte_le, google_agenda")
    .eq("organization_id", org)
    .eq("user_id", userId)
    .eq("role", "closeuse")
    .maybeSingle();
  return data;
}

/**
 * Peut-elle le prendre ? null si oui, sinon la raison, dite à elle. Relu au
 * clic : entre l'affichage et le clic, une autre a pu le prendre.
 */
export async function raisonDeNePasPrendre(
  admin: Admin,
  org: string,
  personneId: string,
  rdv: { id: string; scheduled_start: string; scheduled_end: string; closeuse_id: string | null; status: string },
  lireOccupe: LireOccupe,
  preavisMinutes: number,
): Promise<string | null> {
  if (rdv.status !== "confirme" || rdv.closeuse_id) return "Une autre closeuse vient de le prendre.";
  if (Date.parse(rdv.scheduled_start) < Date.now() + preavisMinutes * 60_000) return "Il commence trop tôt pour être pris.";
  const { data: siens } = await admin
    .from("reservation_rendez_vous")
    .select("id")
    .eq("organization_id", org)
    .eq("personne_id", personneId)
    .eq("statut", "confirme")
    .lt("debut", rdv.scheduled_end)
    .gt("bloque_jusqu_a", rdv.scheduled_start)
    .limit(1);
  if (siens?.length) return "Tu as déjà un rendez-vous à ce moment-là.";
  let occupe: { debut: number; fin: number }[];
  try {
    occupe = await lireOccupe(personneId, Date.parse(rdv.scheduled_start), Date.parse(rdv.scheduled_end));
  } catch {
    return "Ton agenda Google ne se lit pas : reconnecte-le dans « Mon agenda ».";
  }
  const d = Date.parse(rdv.scheduled_start);
  const f = Date.parse(rdv.scheduled_end);
  if (occupe.some((o) => o.debut < f && o.fin > d)) return "Ton agenda Google est occupé à ce moment-là.";
  return null;
}

/** Les quatre plus proches que personne ne couvre et qu'elle peut prendre. */
export async function diagnosticsAPrendre(
  admin: Admin,
  org: string,
  userId: string,
  lireOccupe: LireOccupe | null,
): Promise<APrendre[]> {
  if (!lireOccupe) return [];
  const personne = await personneCloseuse(admin, org, userId);
  if (!personne?.google_connecte_le || personne.google_agenda === "primary") return [];

  const [tous, { data: reglages }] = await Promise.all([
    diagnosticsAConfier(admin, org, lireOccupe),
    admin.from("reservation_reglages").select("preavis_minutes").eq("organization_id", org).maybeSingle(),
  ]);
  const preavis = reglages?.preavis_minutes ?? 120;
  const sansPersonne = tous.filter((r) => r.candidates.length === 0);
  if (!sansPersonne.length) return [];

  const { data: rdvs } = await admin
    .from("radar_bookings")
    .select("id, scheduled_start, scheduled_end, closeuse_id, status, invitee_first_name")
    .in(
      "id",
      sansPersonne.map((r) => r.bookingId),
    )
    .order("scheduled_start");

  // Son agenda Google et ses diagnostics, lus une fois sur toute la période.
  const liste = (rdvs ?? []).filter(
    (r) => r.status === "confirme" && !r.closeuse_id && Date.parse(r.scheduled_start) >= Date.now() + preavis * 60_000,
  );
  if (!liste.length) return [];
  const de = Date.parse(liste[0].scheduled_start);
  const a = Math.max(...liste.map((r) => Date.parse(r.scheduled_end)));
  let occupe: { debut: number; fin: number }[];
  try {
    occupe = await lireOccupe(personne.id, de, a);
  } catch {
    return [];
  }
  const { data: siens } = await admin
    .from("reservation_rendez_vous")
    .select("debut, bloque_jusqu_a")
    .eq("organization_id", org)
    .eq("personne_id", personne.id)
    .eq("statut", "confirme")
    .gt("bloque_jusqu_a", new Date(de).toISOString());

  const retenus: APrendre[] = [];
  for (const rdv of liste) {
    if (retenus.length >= A_PRENDRE_MAX) break;
    const d = Date.parse(rdv.scheduled_start);
    const f = Date.parse(rdv.scheduled_end);
    if (occupe.some((o) => o.debut < f && o.fin > d)) continue;
    if ((siens ?? []).some((l) => Date.parse(l.debut) < f && Date.parse(l.bloque_jusqu_a) > d)) continue;
    retenus.push({
      bookingId: rdv.id,
      debut: rdv.scheduled_start,
      fin: rdv.scheduled_end,
      prenom: rdv.invitee_first_name || "Une cliente",
    });
  }
  return retenus;
}
