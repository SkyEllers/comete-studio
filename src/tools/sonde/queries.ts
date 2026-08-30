import "server-only";

import { jourParis, tempsRelatif } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import {
  agregerBruts,
  depuisQuandRelire,
  mesurer,
  type EvenementBrut,
  type LigneJour,
  type Mesure,
  type Periode,
} from "./mesure";

/**
 * Ce que Sonde lit.
 *
 * Tout passe par la session : la RLS décide, et `can_access_sonde` rend tout
 * vide dès que l'outil est coupé.
 *
 * Deux sources pour une seule courbe. L'agrégat quotidien porte l'histoire et
 * survit à la purge des bruts ; les événements bruts portent le jour en cours,
 * qui n'est jamais agrégé, et les nuits que la tâche aurait ratées. La couture
 * se calcule (`depuisQuandRelire`) plutôt qu'elle ne se suppose, et l'écran ne
 * doit pas pouvoir dire où elle passe.
 */

const PLAFOND_SITES = 50;
/** Le jour courant et le rattrapage d'une nuit ou deux : jamais un mois. */
const PLAFOND_BRUTS = 20_000;
/** Les répartitions par page et par référent, qui balaient toute la période. */
const PLAFOND_DETAILS = 5_000;

export type Site = {
  id: string;
  name: string;
  token: string;
  domains: string[];
  is_active: boolean;
  last_event_at: string | null;
};

export type SiteResume = Site & { dernierLabel: string | null };

export async function getSites(organizationId: string): Promise<SiteResume[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("sonde_sites")
    .select("id, name, token, domains, is_active, last_event_at")
    .eq("organization_id", organizationId)
    .order("created_at")
    .limit(PLAFOND_SITES);

  const maintenant = new Date();

  return (data ?? []).map((site) => ({
    ...site,
    domains: site.domains ?? [],
    dernierLabel: site.last_event_at
      ? tempsRelatif(site.last_event_at, maintenant)
      : null,
  }));
}

/** Les jours qui portent quelque chose : ils décident des puces de période. */
export async function getJoursConnus(organizationId: string): Promise<string[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("sonde_daily")
    .select("day")
    .eq("organization_id", organizationId)
    .order("day", { ascending: false })
    .limit(500);

  return (data ?? []).map((ligne) => ligne.day);
}

export type Canal = { id: string; label: string; is_comete: boolean };

export async function getCanaux(organizationId: string): Promise<Canal[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("radar_channels")
    .select("id, label, is_comete")
    .eq("organization_id", organizationId);

  return data ?? [];
}

/**
 * Une fenêtre UTC large autour d'une plage de jours parisiens.
 *
 * Paris est en avance d'une ou deux heures sur UTC selon la saison. Plutôt que
 * de refaire cette arithmétique en SQL — et de se tromper deux fois par an —
 * on demande un jour de marge de chaque côté et on découpe précisément en
 * mémoire, avec la même fonction que partout ailleurs dans le hub.
 */
function fenetre(debut: string, fin: string) {
  const veille = new Date(`${debut}T00:00:00Z`);
  veille.setUTCDate(veille.getUTCDate() - 1);

  const lendemain = new Date(`${fin}T00:00:00Z`);
  lendemain.setUTCDate(lendemain.getUTCDate() + 2);

  return { depuis: veille.toISOString(), jusqua: lendemain.toISOString() };
}

export type Mesures = {
  mesure: Mesure;
  /** Vrai si la lecture des bruts a été coupée au plafond. */
  tronquee: boolean;
};

/**
 * La mesure d'une période : l'agrégat pour ce qui est figé, les bruts pour ce
 * qui bouge encore.
 */
export async function getMesure(
  organizationId: string,
  periode: Periode,
): Promise<Mesures> {
  const supabase = await createClient();

  const { data: quotidien } = await supabase
    .from("sonde_daily")
    .select("day, channel_id, channel_bucket, pageviews, visitors, cta_clicks")
    .eq("organization_id", organizationId)
    .gte("day", periode.debut)
    .lte("day", periode.fin);

  const agreges = (quotidien ?? []) as LigneJour[];
  const depuis = depuisQuandRelire(agreges, periode.debut);

  // Rien à relire : la période est entièrement derrière l'agrégation.
  if (depuis > periode.fin) {
    return { mesure: mesurer(agreges, periode), tronquee: false };
  }

  const bornes = fenetre(depuis, periode.fin);

  const { data: bruts } = await supabase
    .from("sonde_events")
    .select("occurred_at, kind, channel_id, channel_bucket, visitor_key")
    .eq("organization_id", organizationId)
    .gte("occurred_at", bornes.depuis)
    .lte("occurred_at", bornes.jusqua)
    .order("occurred_at")
    .limit(PLAFOND_BRUTS);

  /* `channel_bucket` est une colonne texte contrainte par un `check` : la base
     garantit les trois valeurs, les types générés n'en savent rien. La
     conversion se fait ici, à la frontière, et nulle part ailleurs. */
  const recents = ((bruts ?? []) as EvenementBrut[]).filter((evenement) => {
    const jour = jourParis(evenement.occurred_at);
    return jour >= depuis && jour <= periode.fin;
  });

  return {
    mesure: mesurer([...agreges, ...agregerBruts(recents)], periode),
    tronquee: (bruts ?? []).length === PLAFOND_BRUTS,
  };
}

export type Part = { label: string; visiteurs: number; clics: number };

export type Details = {
  pages: Part[];
  referents: Part[];
  /** Vrai si la période dépasse la rétention des bruts : les détails manquent. */
  horsRetention: boolean;
};

/**
 * Les répartitions par page et par référent.
 *
 * Elles ne se lisent que sur les bruts : l'agrégat quotidien ne porte ni le
 * chemin ni le référent, et c'est ce qui lui permet de tenir en une ligne par
 * canal et de rester quand les bruts sont purgés. Au-delà de treize mois, ces
 * deux listes sont donc vides — l'écran le dit plutôt que d'afficher un blanc.
 */
export async function getDetails(
  organizationId: string,
  periode: Periode,
): Promise<Details> {
  const supabase = await createClient();
  const bornes = fenetre(periode.debut, periode.fin);

  const { data } = await supabase
    .from("sonde_events")
    .select("occurred_at, kind, path, referrer_host")
    .eq("organization_id", organizationId)
    .gte("occurred_at", bornes.depuis)
    .lte("occurred_at", bornes.jusqua)
    .order("occurred_at", { ascending: false })
    .limit(PLAFOND_DETAILS);

  const dansLaPeriode = (data ?? []).filter((evenement) => {
    const jour = jourParis(evenement.occurred_at);
    return jour >= periode.debut && jour <= periode.fin;
  });

  const compter = (cle: (ligne: (typeof dansLaPeriode)[number]) => string | null) => {
    const parts = new Map<string, Part>();

    for (const ligne of dansLaPeriode) {
      const label = cle(ligne);
      if (!label) continue;

      const part = parts.get(label) ?? { label, visiteurs: 0, clics: 0 };
      if (ligne.kind === "pageview") part.visiteurs += 1;
      else part.clics += 1;
      parts.set(label, part);
    }

    return [...parts.values()]
      .sort((a, b) => b.visiteurs - a.visiteurs || a.label.localeCompare(b.label))
      .slice(0, 12);
  };

  const treizeMois = new Date();
  treizeMois.setMonth(treizeMois.getMonth() - 13);

  return {
    pages: compter((ligne) => ligne.path),
    referents: compter((ligne) => ligne.referrer_host),
    horsRetention: dansLaPeriode.length === 0 && periode.fin < jourParis(treizeMois),
  };
}

/**
 * Les réservations du mois, quand Radar est actif.
 *
 * C'est ce qui referme l'entonnoir : 300 visiteurs, 41 clics, 9 réservations.
 * Sans Radar, la ligne s'arrête aux clics — et c'est ce que Sonde sait, elle
 * ne devine pas ce qui se passe après le départ vers Calendly.
 */
export async function getReservations(
  organizationId: string,
  periode: Periode,
): Promise<number | null> {
  const supabase = await createClient();

  const { data: actif } = await supabase.rpc("has_tool", {
    org: organizationId,
    tool_slug: "resultats",
  });

  if (actif !== true) return null;

  const bornes = fenetre(periode.debut, periode.fin);

  const { data } = await supabase
    .from("radar_bookings")
    .select("scheduled_start")
    .eq("organization_id", organizationId)
    .gte("scheduled_start", bornes.depuis)
    .lte("scheduled_start", bornes.jusqua)
    .limit(2000);

  return (data ?? []).filter((rdv) => {
    const jour = jourParis(rdv.scheduled_start);
    return jour >= periode.debut && jour <= periode.fin;
  }).length;
}
