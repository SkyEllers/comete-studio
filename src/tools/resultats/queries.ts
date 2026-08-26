import "server-only";

import { createClient } from "@/lib/supabase/server";

import { moisPrecedent } from "./mois";

/**
 * Ce que le client lit de Radar.
 *
 * Tout passe par `radar_bookings_effective` : c'est elle qui calcule le statut
 * réel d'une séance passée et ce qui entre dans la commission, et c'est elle
 * qui porte le mois. Interroger `radar_bookings` directement rouvrirait la
 * porte à deux découpages divergents.
 *
 * Les agrégats se font ici, en mémoire, sur les lignes du mois : un praticien
 * fait quelques dizaines de séances par mois, et une requête d'agrégation par
 * tuile coûterait plus cher que de compter cette poignée de lignes.
 */

const PLAFOND = 500;

export type RendezVous = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  event_type_name: string;
  channel_id: string | null;
  attribution: string;
  attribution_note: string | null;
  declared_source: string | null;
  status: string;
  status_origin: string;
  status_note: string | null;
  effective_status: string;
  counts_for_commission: boolean;
  amount_cents: number;
  currency: string;
  payment_ok: boolean;
  payment_ref: string | null;
  rescheduled_from: string | null;
  attribution_source_id: string | null;
  mois: string;
};

export type Canal = { id: string; label: string; is_comete: boolean };

const COLONNES =
  "id, scheduled_start, scheduled_end, event_type_name, channel_id, attribution, attribution_note, declared_source, status, status_origin, status_note, effective_status, counts_for_commission, amount_cents, currency, payment_ref, payment_ok, rescheduled_from, attribution_source_id, mois";

export async function getCanaux(organizationId: string): Promise<Canal[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_channels")
    .select("id, label, is_comete")
    .eq("organization_id", organizationId)
    .order("sort_order");

  return data ?? [];
}

/** Les mois qui portent quelque chose, pour ne proposer que des puces utiles. */
export async function getMoisConnus(organizationId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_bookings_effective")
    .select("mois")
    .eq("organization_id", organizationId)
    .order("mois", { ascending: false })
    .limit(PLAFOND);

  return [...new Set((data ?? []).map((ligne) => ligne.mois).filter(Boolean) as string[])];
}

export async function getRendezVous(
  organizationId: string,
  mois: string,
): Promise<RendezVous[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_bookings_effective")
    .select(COLONNES)
    .eq("organization_id", organizationId)
    .eq("mois", mois)
    .order("scheduled_start", { ascending: false })
    .limit(PLAFOND);

  return (data ?? []) as RendezVous[];
}

export type Bilan = {
  rendezVous: number;
  honores: number;
  perdus: number;
  chiffreAffaires: number;
  commission: number;
  devise: string;
};

/**
 * Le bilan d'un mois.
 *
 * « Perdus » réunit les annulations et les non-venus : de l'endroit du client,
 * ce sont deux façons pour une séance de ne pas avoir eu lieu, et les séparer
 * en deux tuiles ferait deux petits chiffres au lieu d'un qui parle.
 */
export function bilan(lignes: RendezVous[], taux: number, devise: string): Bilan {
  const comptees = lignes.filter((ligne) => ligne.counts_for_commission);
  const chiffreAffaires = comptees.reduce((total, ligne) => total + ligne.amount_cents, 0);

  return {
    rendezVous: lignes.length,
    honores: lignes.filter((ligne) => ligne.effective_status === "honore").length,
    perdus: lignes.filter(
      (ligne) => ligne.effective_status === "annule" || ligne.effective_status === "no_show",
    ).length,
    chiffreAffaires,
    // Arrondi au centime, une seule fois, à la fin : arrondir ligne à ligne
    // ferait diverger le brouillon du relevé.
    commission: Math.round((chiffreAffaires * taux) / 100),
    devise,
  };
}

export type PartCanal = {
  canal: Canal | null;
  rendezVous: number;
  honores: number;
  montant: number;
};

/** La répartition par canal, du plus gros au plus petit. */
export function parCanal(lignes: RendezVous[], canaux: Canal[]): PartCanal[] {
  const index = new Map(canaux.map((canal) => [canal.id, canal]));
  const parts = new Map<string, PartCanal>();

  for (const ligne of lignes) {
    const cle = ligne.channel_id ?? "aucun";
    const part =
      parts.get(cle) ??
      ({
        canal: ligne.channel_id ? (index.get(ligne.channel_id) ?? null) : null,
        rendezVous: 0,
        honores: 0,
        montant: 0,
      } satisfies PartCanal);

    part.rendezVous += 1;
    if (ligne.effective_status === "honore") part.honores += 1;
    if (ligne.counts_for_commission) part.montant += ligne.amount_cents;

    parts.set(cle, part);
  }

  return [...parts.values()].sort(
    (a, b) => b.montant - a.montant || b.rendezVous - a.rendezVous,
  );
}

/**
 * Les séances passées des sept derniers jours encore « confirmées ».
 *
 * C'est le bloc « À vérifier » : elles comptent comme honorées tant que
 * personne ne dit le contraire, et c'est justement pour ça qu'il faut les
 * montrer plutôt que de les laisser glisser dans la commission en silence.
 */
export function aVerifier(lignes: RendezVous[]): RendezVous[] {
  const ilYAUneSemaine = Date.now() - 7 * 86_400_000;

  return lignes
    .filter(
      (ligne) =>
        ligne.status === "confirme" &&
        Date.parse(ligne.scheduled_end) < Date.now() &&
        Date.parse(ligne.scheduled_end) > ilYAUneSemaine,
    )
    .sort((a, b) => Date.parse(b.scheduled_start) - Date.parse(a.scheduled_start));
}

export type Reglages = {
  commission_rate: number;
  window_days: number;
  currency: string;
  connected_at: string | null;
  last_webhook_at: string | null;
};

export async function getReglages(organizationId: string): Promise<Reglages> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_settings")
    .select("commission_rate, window_days, currency, connected_at, last_webhook_at")
    .eq("organization_id", organizationId)
    .maybeSingle();

  return {
    commission_rate: Number(data?.commission_rate ?? 20),
    window_days: data?.window_days ?? 90,
    currency: data?.currency ?? "EUR",
    connected_at: data?.connected_at ?? null,
    last_webhook_at: data?.last_webhook_at ?? null,
  };
}

/** Le relevé d'un mois, s'il existe : c'est lui qui ferme les corrections. */
export async function getReleve(organizationId: string, mois: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_statements")
    .select("id, status, base_cents, commission_cents, commission_rate, paid_at")
    .eq("organization_id", organizationId)
    .eq("month", mois)
    .maybeSingle();

  return data;
}

/**
 * Les activités de tout un mois, groupées par rendez-vous.
 *
 * Une requête pour la page entière plutôt qu'une par fiche ouverte : quelques
 * dizaines de lignes, et la fiche s'ouvre sans attendre le réseau.
 */
export async function getActivitesDuMois(
  bookingIds: string[],
): Promise<Record<string, Activite[]>> {
  if (bookingIds.length === 0) return {};

  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_booking_activities")
    .select("id, booking_id, type, payload, created_at, profiles(full_name)")
    .in("booking_id", bookingIds)
    .order("created_at", { ascending: false })
    .limit(1000);

  const groupees: Record<string, Activite[]> = {};
  for (const ligne of data ?? []) {
    const cle = ligne.booking_id;
    groupees[cle] = [...(groupees[cle] ?? []), ligne as unknown as Activite];
  }
  return groupees;
}

export type Activite = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
  profiles: { full_name: string } | null;
};

/**
 * La date des séances qui ont transmis leur canal par récurrence.
 *
 * Elles sont souvent dans un mois précédent, donc absentes de la page : on va
 * les chercher pour que la fiche puisse dire « séance du 12 mars » plutôt que
 * de demander au client de croire sur parole.
 */
export async function getSourcesAttribution(
  lignes: RendezVous[],
): Promise<Record<string, string>> {
  const ids = [
    ...new Set(lignes.map((ligne) => ligne.attribution_source_id).filter(Boolean)),
  ] as string[];
  if (ids.length === 0) return {};

  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_bookings")
    .select("id, scheduled_start")
    .in("id", ids);

  return Object.fromEntries((data ?? []).map((l) => [l.id, l.scheduled_start]));
}

/** Le journal d'un rendez-vous, pour sa fiche. */
export async function getActivites(bookingId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_booking_activities")
    .select("id, type, payload, created_at, profiles(full_name)")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(50);

  return data ?? [];
}

/** Le mois d'avant, pour la comparaison sous chaque tuile. */
export async function getBilanPrecedent(
  organizationId: string,
  mois: string,
  taux: number,
  devise: string,
): Promise<Bilan> {
  const lignes = await getRendezVous(organizationId, moisPrecedent(mois));
  return bilan(lignes, taux, devise);
}
