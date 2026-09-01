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
  /** Vides pour tout rendez-vous reçu avant la phase 7. */
  invitee_first_name: string;
  invitee_last_name: string;
  /** « Camille D. », ou « Invité·e ». Calculé par la vue, jamais ici. */
  invitee_display: string;
  channel_id: string | null;
  attribution: string;
  attribution_note: string | null;
  /** Les `utm_*` retenus de la réservation : la fiche y lit le nom de campagne. */
  utm: Record<string, string>;
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
  /** Nuls tant qu'aucune vente n'est déclarée ; jamais l'un sans l'autre. */
  sale_amount_cents: number | null;
  sale_date: string | null;
  sale_note: string | null;
  has_sale: boolean;
  commission_basis: "encaissement" | "ventes";
  /** Le mois qui facturera cette ligne. Nul en mode « ventes » sans vente. */
  commission_month: string | null;
};

export type Canal = { id: string; label: string; is_comete: boolean };

const COLONNES =
  "id, scheduled_start, scheduled_end, event_type_name, invitee_first_name, invitee_last_name, invitee_display, channel_id, attribution, attribution_note, utm, declared_source, status, status_origin, status_note, effective_status, counts_for_commission, amount_cents, currency, payment_ref, payment_ok, rescheduled_from, attribution_source_id, mois, sale_amount_cents, sale_date, sale_note, has_sale, commission_basis, commission_month";

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

/**
 * Chercher quelqu'un, dans toute l'histoire du client.
 *
 * Volontairement hors du mois affiché, archives comprises : on cherche un nom
 * parce qu'on ne sait plus quand la personne est venue. Une recherche bornée
 * au mois courant obligerait à deviner d'abord la réponse, et ne servirait à
 * rien — or c'est cette recherche qui justifie que le nom soit en base.
 *
 * Le terme est passé par `nettoyerRecherche()` avant d'arriver ici. Les deux
 * remparts qui comptent restent ailleurs et ne dépendent pas de lui : le `eq`
 * sur l'organisation, et la RLS derrière la vue.
 */
export async function chercherRendezVous(
  organizationId: string,
  terme: string,
): Promise<RendezVous[]> {
  const supabase = await createClient();
  const motif = `%${terme}%`;

  const { data } = await supabase
    .from("radar_bookings_effective")
    .select(COLONNES)
    .eq("organization_id", organizationId)
    .or(`invitee_first_name.ilike.${motif},invitee_last_name.ilike.${motif}`)
    .order("scheduled_start", { ascending: false })
    .limit(PLAFOND);

  return (data ?? []) as RendezVous[];
}

/**
 * Les ventes d'un mois — celles dont la *date de vente* tombe dedans.
 *
 * C'est la décision 5 de la phase 7, en une requête : un diagnostic du 28 août
 * vendu le 3 septembre est une vente de septembre. Elle ne se confond donc pas
 * avec `getRendezVous`, qui range les séances par leur propre mois, et les
 * deux cohabitent sur le même tableau de bord — les séances d'un côté,
 * l'argent de l'autre.
 *
 * Sans effet en mode `encaissement`, où `commission_month` vaut le mois de la
 * séance : l'appelant ne s'en sert qu'en mode `ventes`.
 */
export async function getVentesDuMois(
  organizationId: string,
  mois: string,
): Promise<RendezVous[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_bookings_effective")
    .select(COLONNES)
    .eq("organization_id", organizationId)
    .eq("commission_month", mois)
    .not("sale_amount_cents", "is", null)
    .order("sale_date", { ascending: false })
    .limit(PLAFOND);

  return (data ?? []) as RendezVous[];
}

/**
 * Les rendez-vous dont quelqu'un a déjà dit « pas de vente ».
 *
 * La décision ne touche aucune colonne — elle vit dans les activités — parce
 * qu'un montant nul serait une vente à zéro euro, pas une absence de vente.
 * On la relit donc là où elle est écrite.
 */
export async function getVentesRefusees(bookingIds: string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();

  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_booking_activities")
    .select("booking_id")
    .in("booking_id", bookingIds)
    .eq("type", "sale.declined")
    .limit(1000);

  return new Set((data ?? []).map((ligne) => ligne.booking_id));
}

/**
 * Les mois dont le relevé est clôturé.
 *
 * La liste d'un mois n'en avait besoin que d'un ; une recherche traverse les
 * mois, et chaque ligne doit savoir si le sien est fermé aux corrections.
 */
export async function getMoisClotures(organizationId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_statements")
    .select("month")
    .eq("organization_id", organizationId)
    .limit(PLAFOND);

  return (data ?? []).map((ligne) => ligne.month);
}

export type Bilan = {
  rendezVous: number;
  honores: number;
  /**
   * Séparés, et non réunis sous « perdus ».
   *
   * Ce sont deux échecs différents, avec deux réponses différentes : une
   * annulation se voit venir et se remplace, une personne qui ne vient pas
   * laisse un créneau perdu et coûte le double. Les additionner donnait un
   * chiffre sur lequel il n'y avait rien à décider.
   */
  annules: number;
  noShows: number;
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
export function bilan(
  lignes: RendezVous[],
  taux: number,
  devise: string,
  /**
   * En mode « ventes » : les rendez-vous dont la vente tombe ce mois-ci. Les
   * compteurs de séances restent ceux de `lignes` — ils parlent d'un agenda —
   * mais la base de commission vient d'ici, parce qu'une vente appartient au
   * mois où elle a été conclue et non à celui de la séance qui l'a amenée.
   */
  ventes?: RendezVous[],
): Bilan {
  const chiffreAffaires = ventes
    ? ventes
        .filter((ligne) => ligne.counts_for_commission)
        .reduce((total, ligne) => total + (ligne.sale_amount_cents ?? 0), 0)
    : lignes
        .filter((ligne) => ligne.counts_for_commission)
        .reduce((total, ligne) => total + ligne.amount_cents, 0);

  return {
    rendezVous: lignes.length,
    honores: lignes.filter((ligne) => ligne.effective_status === "honore").length,
    annules: lignes.filter((ligne) => ligne.effective_status === "annule").length,
    noShows: lignes.filter((ligne) => ligne.effective_status === "no_show").length,
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

/**
 * Les séances honorées récentes dont on ne sait pas encore si elles ont vendu.
 *
 * Uniquement en mode `ventes`, où c'est la question qui décide de la
 * commission : une séance honorée sans réponse est un trou dans le relevé du
 * mois. Quatorze jours plutôt que sept — une vente se conclut souvent dans les
 * jours qui suivent le rendez-vous, et demander trop tôt ferait répondre
 * « non » à quelqu'un qui n'a pas encore fini d'en parler.
 *
 * « Sans décision » compte autant que « sans vente » : un « pas de vente » est
 * une réponse, et une réponse ne se redemande pas.
 */
export function aVendre(
  lignes: RendezVous[],
  refusees: Set<string>,
): RendezVous[] {
  const ilYADeuxSemaines = Date.now() - 14 * 86_400_000;

  return lignes
    .filter(
      (ligne) =>
        ligne.effective_status === "honore" &&
        !ligne.has_sale &&
        !refusees.has(ligne.id) &&
        Date.parse(ligne.scheduled_end) < Date.now() &&
        Date.parse(ligne.scheduled_end) > ilYADeuxSemaines,
    )
    .sort((a, b) => Date.parse(b.scheduled_start) - Date.parse(a.scheduled_start));
}

export type Reglages = {
  commission_rate: number;
  window_days: number;
  currency: string;
  connected_at: string | null;
  last_webhook_at: string | null;
  commission_basis: "encaissement" | "ventes";
};

export async function getReglages(organizationId: string): Promise<Reglages> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("radar_settings")
    .select(
      "commission_rate, window_days, currency, connected_at, last_webhook_at, commission_basis",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  return {
    commission_rate: Number(data?.commission_rate ?? 20),
    window_days: data?.window_days ?? 90,
    currency: data?.currency ?? "EUR",
    connected_at: data?.connected_at ?? null,
    last_webhook_at: data?.last_webhook_at ?? null,
    // Le défaut suit celui de la base : un client sans ligne de réglages est
    // en `encaissement`, comme tous ceux d'avant la phase 7.
    commission_basis: data?.commission_basis ?? "encaissement",
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
  /** Le mode du client : en « ventes », la base du mois d'avant vient des ventes. */
  base: "encaissement" | "ventes" = "encaissement",
): Promise<Bilan> {
  const avant = moisPrecedent(mois);
  const [lignes, ventes] = await Promise.all([
    getRendezVous(organizationId, avant),
    base === "ventes" ? getVentesDuMois(organizationId, avant) : Promise.resolve(undefined),
  ]);

  return bilan(lignes, taux, devise, ventes);
}
