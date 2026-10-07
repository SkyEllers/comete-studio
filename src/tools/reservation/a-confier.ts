import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Les diagnostics à venir de la titulaire qu'une closeuse pourrait prendre :
 * dans ses horaires habituels (heure de Paris, 45 minutes comprises), hors de
 * ses absences, sous son maximum du jour, sans chevaucher un de ses rendez-vous,
 * et libre dans son agenda Google (Louis, 07/10/2026 : Marion se voyait
 * proposer un matin où elle avait deux rendez-vous « occupé »). Comme la page
 * de réservation, un agenda qu'on ne lit pas écarte la closeuse : on ne lui
 * propose rien plutôt que de risquer un double rendez-vous.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type ACandidate = { personneId: string; nom: string };

/** L'occupé de l'agenda Google d'une personne entre `de` et `a` (ms) ; lève si illisible. */
export type LireOccupe = (personneId: string, de: number, a: number) => Promise<{ debut: number; fin: number }[]>;
export type AConfier = {
  bookingId: string;
  debut: string;
  prenom: string;
  calendly: boolean;
  candidates: ACandidate[];
};

const PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const JOURS: Record<string, number> = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7 };

/** Jour de la semaine (1 = lundi), date « AAAA-MM-JJ » et minutes depuis minuit, à Paris. */
export function aParis(iso: string): { jour: number; date: string; minutes: number } {
  const p = Object.fromEntries(PARIS.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return {
    jour: JOURS[String(p.weekday).replace(".", "").slice(0, 3)] ?? 0,
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

const enMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export async function diagnosticsAConfier(admin: Admin, org: string, lireOccupe: LireOccupe | null): Promise<AConfier[]> {
  const maintenant = new Date().toISOString();
  const [{ data: rdvs }, { data: personnes }, { data: horaires }, { data: absences }, { data: pris }] =
    await Promise.all([
      admin
        .from("radar_bookings")
        .select("id, scheduled_start, scheduled_end, invitee_first_name")
        .eq("organization_id", org)
        .eq("status", "confirme")
        .is("closeuse_id", null)
        .gt("scheduled_start", maintenant)
        .ilike("event_type_name", "%diagnostic%")
        .order("scheduled_start"),
      admin
        .from("reservation_personnes")
        .select("id, max_par_jour, google_connecte_le, profiles(full_name)")
        .eq("organization_id", org)
        .eq("role", "closeuse"),
      admin.from("reservation_horaires").select("personne_id, jour, debut, fin").eq("organization_id", org),
      admin.from("reservation_absences").select("personne_id, du, au").eq("organization_id", org),
      admin
        .from("reservation_rendez_vous")
        .select("id, personne_id, debut, bloque_jusqu_a, radar_booking_id")
        .eq("organization_id", org)
        .eq("statut", "confirme")
        .gt("debut", maintenant),
    ]);

  const closeuses = (personnes ?? []).map((p) => ({
    id: p.id,
    max: p.max_par_jour,
    google: Boolean(p.google_connecte_le),
    nom: (p.profiles as { full_name: string | null } | null)?.full_name ?? "Closeuse",
  }));

  // L'occupé Google de chacune, lu une fois sur toute la période des diagnostics.
  const liste = rdvs ?? [];
  const occupes = new Map<string, { debut: number; fin: number }[]>();
  if (lireOccupe && liste.length) {
    const de = Date.parse(liste[0].scheduled_start);
    const a = Math.max(...liste.map((r) => Date.parse(r.scheduled_end)));
    await Promise.all(
      closeuses
        .filter((c) => c.google)
        .map(async (c) => {
          try {
            occupes.set(c.id, await lireOccupe(c.id, de, a));
          } catch {
            // Agenda illisible : pas d'entrée, donc écartée plus bas.
          }
        }),
    );
  }
  const parId = new Set(closeuses.map((c) => c.id));
  const lignes = pris ?? [];
  const surOutil = new Set(lignes.map((l) => l.radar_booking_id).filter(Boolean));

  return liste.map((r) => {
    const p = aParis(r.scheduled_start);
    const fin = p.minutes + Math.round((Date.parse(r.scheduled_end) - Date.parse(r.scheduled_start)) / 60_000);
    const candidates = closeuses
      .filter((c) =>
        (horaires ?? []).some(
          (h) => h.personne_id === c.id && h.jour === p.jour && enMinutes(h.debut) <= p.minutes && fin <= enMinutes(h.fin),
        ),
      )
      .filter((c) => !(absences ?? []).some((a) => a.personne_id === c.id && a.du <= p.date && p.date <= a.au))
      .filter((c) => {
        if (!lireOccupe) return true;
        const occ = occupes.get(c.id);
        if (!occ) return false;
        const d = Date.parse(r.scheduled_start);
        const f = Date.parse(r.scheduled_end);
        return !occ.some((o) => o.debut < f && o.fin > d);
      })
      .filter((c) => {
        const siens = lignes.filter((l) => l.personne_id === c.id);
        const ceJour = siens.filter((l) => aParis(l.debut).date === p.date).length;
        const chevauche = siens.some((l) => l.debut < r.scheduled_end && l.bloque_jusqu_a > r.scheduled_start);
        return ceJour < c.max && !chevauche;
      })
      .map((c) => ({ personneId: c.id, nom: c.nom }));
    return {
      bookingId: r.id,
      debut: r.scheduled_start,
      prenom: r.invitee_first_name || "Une cliente",
      calendly: !surOutil.has(r.id),
      candidates: candidates.filter((c) => parId.has(c.personneId)),
    };
  }).filter((r) => r.candidates.length > 0);
}
