import "server-only";

import { getMembership } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

/**
 * Le rendez-vous est-il à portée de la personne connectée ? Exactement ceux
 * qui peuvent saisir dessus (`radar_peut_saisir`, 0036) : le client qui a
 * Radar, Louis, et la closeuse à qui il est attribué. Lu avec la session de
 * la personne ; ensuite, le serveur lit le reste.
 */
export async function rendezVousAccessible(orgSlug: string, bookingId: string) {
  const acces = await getMembership(orgSlug);
  if (!acces) return null;
  const supabase = await createClient();
  const { data: rdv } = await supabase
    .from("radar_bookings")
    .select("id, organization_id, closeuse_id, invitee_first_name, invitee_last_name, status")
    .eq("id", bookingId)
    .eq("organization_id", acces.org.id)
    .maybeSingle();
  if (!rdv) return null;
  const { data: peut } = await supabase.rpc(
    "radar_peut_saisir",
    { org: rdv.organization_id, closeuse: rdv.closeuse_id ?? undefined } as never,
  );
  if (peut !== true) return null;
  return { acces, rdv };
}
