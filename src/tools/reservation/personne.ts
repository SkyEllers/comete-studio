import "server-only";

import { getOrgBySlug } from "@/lib/access";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { jourLocal } from "@/tools/agent/temps";

/**
 * La fiche de réservation de la personne connectée chez ce client, lue avec
 * sa propre session (la RLS ne lui montre que la sienne). Louis n'en a pas
 * chez Peggy : il ne connecte jamais l'agenda de quelqu'un d'autre.
 */
export async function maFiche(orgSlug: string) {
  const session = await getUser();
  if (!session) return null;

  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("reservation_personnes")
    .select("id, role, actif, fuseau, max_par_jour, visio, lien_visio, google_email, google_agenda, google_connecte_le")
    .eq("organization_id", org.id)
    .eq("user_id", session.userId)
    .maybeSingle();

  return data ? { session, org, fiche: data } : null;
}

export type Fiche = NonNullable<Awaited<ReturnType<typeof maFiche>>>["fiche"];

/**
 * Tout ce que « Mon agenda » affiche, lu avec sa session : ses horaires, ses
 * absences pas encore finies, ses prochains rendez-vous.
 */
export async function monAgenda(personneId: string, fuseau: string) {
  const aujourdhui = jourLocal(Date.now(), fuseau);
  const supabase = await createClient();
  const [horaires, absences, rdv] = await Promise.all([
    supabase.from("reservation_horaires").select("jour, debut, fin").eq("personne_id", personneId).order("jour").order("debut"),
    supabase
      .from("reservation_absences")
      .select("id, du, au")
      .eq("personne_id", personneId)
      .gte("au", aujourdhui)
      .order("du"),
    supabase
      .from("reservation_rendez_vous")
      .select("id, debut, prenom, nom, email, telephone, reponses, lien_visio")
      .eq("personne_id", personneId)
      .eq("statut", "confirme")
      .gte("fin", new Date().toISOString())
      .order("debut")
      .limit(30),
  ]);
  return {
    aujourdhui,
    horaires: (horaires.data ?? []).map((h) => ({ jour: h.jour, debut: h.debut.slice(0, 5), fin: h.fin.slice(0, 5) })),
    absences: absences.data ?? [],
    rendezVous: rdv.data ?? [],
  };
}
