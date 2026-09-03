import { z } from "zod";

/**
 * Ce que la route d'export sait faire sans toucher ni la base ni le réseau.
 *
 * Elles vivent ici pour la même raison que les défenses du point de collecte
 * vivent dans `collecte.ts` : ce sont les endroits où l'on peut se tromper en
 * silence — une plage de dates mal bornée qui laisse fuir treize mois, un
 * curseur forgé qui rentre dans une chaîne de filtre, un champ de trop dans la
 * liste blanche — et ils se déroulent en quelques microsecondes plutôt que de
 * demander un serveur, une base et un décor.
 *
 * La règle qui commande tout le fichier : **la liste blanche est construite
 * champ par champ**, jamais par soustraction. Ce flux sort de chez nous vers
 * un tiers ; ce qu'on n'a pas nommé ne part pas, y compris ce que la vue
 * gagnera demain.
 */

// ------------------------------ La plage ------------------------------------

/** Un jour de calendrier, tel que le consommateur l'écrit. */
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un an et un jour. La borne n'est pas là pour économiser des octets : c'est
 * la taille du plus gros rapport qu'on veuille servir d'un coup, et au-delà
 * c'est une pagination par année qu'on veut, pas une requête plus longue.
 */
export const PLAGE_MAX_JOURS = 366;

export const plageSchema = z
  .object({
    depuis: z.string().regex(JOUR, { error: "depuis doit être une date AAAA-MM-JJ." }),
    jusqua: z.string().regex(JOUR, { error: "jusqua doit être une date AAAA-MM-JJ." }),
  })
  .refine((p) => estUnJour(p.depuis) && estUnJour(p.jusqua), {
    error: "depuis et jusqua doivent être des dates qui existent.",
  })
  .refine((p) => p.depuis <= p.jusqua, {
    error: "depuis doit précéder jusqua.",
  })
  .refine((p) => joursEntre(p.depuis, p.jusqua) <= PLAGE_MAX_JOURS, {
    error: `La plage ne peut pas dépasser ${PLAGE_MAX_JOURS} jours.`,
  });

/** « 2026-02-30 » a la bonne forme et n'existe pas. */
function estUnJour(jour: string): boolean {
  const date = new Date(`${jour}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === jour;
}

/** Bornes comprises : du 1er au 1er fait un jour. */
export function joursEntre(depuis: string, jusqua: string): number {
  const debut = Date.parse(`${depuis}T00:00:00Z`);
  const fin = Date.parse(`${jusqua}T00:00:00Z`);
  return Math.round((fin - debut) / 86_400_000) + 1;
}

/**
 * Le décalage de Paris ce jour-là, « +01:00 » ou « +02:00 ».
 *
 * Sondé à midi UTC : à cette heure-là, aucune date n'est à cheval sur un
 * changement d'heure, quel que soit le sens du basculement. Sonder à minuit
 * donnerait le décalage de la veille deux dimanches par an.
 */
function decalageParis(jour: string): string {
  const parties = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(`${jour}T12:00:00Z`));

  const nom = parties.find((partie) => partie.type === "timeZoneName")?.value ?? "GMT+01:00";
  const decalage = nom.replace("GMT", "");
  return decalage.length === 0 ? "+00:00" : decalage;
}

/**
 * Les deux instants qui bornent la plage, en heure de Paris.
 *
 * Le consommateur demande « du 1er au 30 septembre » et pense en jours de
 * calendrier français ; la base range des instants. Sans cette conversion, un
 * rendez-vous du 1er à 00 h 30 tomberait dans la veille, et celui du 30 à
 * 23 h 30 dans le lendemain — deux erreurs qu'un rapport publicitaire
 * imputerait à des campagnes.
 */
export function bornesParis(depuis: string, jusqua: string): { debut: string; fin: string } {
  return {
    debut: `${depuis}T00:00:00.000${decalageParis(depuis)}`,
    fin: `${jusqua}T23:59:59.999${decalageParis(jusqua)}`,
  };
}

// ------------------------------ Le curseur ----------------------------------

/**
 * Le tri est `(scheduled_start, id)` et le curseur porte les deux.
 *
 * Deux rendez-vous peuvent commencer à la même seconde ; sans l'identifiant en
 * second, la pagination sauterait l'un et servirait l'autre deux fois. C'est
 * aussi ce qui rend la pagination stable quand une ligne s'insère entre deux
 * pages : elle est avant ou après le curseur, jamais « quelque part ».
 */
export type Curseur = { s: string; i: string };

const HORODATAGE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encoderCurseur(curseur: Curseur): string {
  return Buffer.from(JSON.stringify(curseur), "utf8").toString("base64url");
}

/**
 * `null` sur tout ce qui n'est pas un curseur qu'on a nous-même écrit.
 *
 * Les deux valeurs finissent dans une chaîne de filtre PostgREST, où le
 * guillemet et la virgule sont de la grammaire. Les vérifier par expression
 * régulière n'est donc pas de la politesse : sans ça, un curseur forgé
 * réécrirait la condition. La route refuse en 400 plutôt que de deviner.
 */
export function decoderCurseur(brut: string | null | undefined): Curseur | null {
  if (typeof brut !== "string" || brut.length === 0 || brut.length > 200) return null;

  try {
    const lu: unknown = JSON.parse(Buffer.from(brut, "base64url").toString("utf8"));
    if (!lu || typeof lu !== "object") return null;

    const { s, i } = lu as Record<string, unknown>;
    if (typeof s !== "string" || typeof i !== "string") return null;
    if (!HORODATAGE.test(s) || !UUID.test(i)) return null;

    return { s, i };
  } catch {
    return null;
  }
}

// ------------------------------ Les lignes ----------------------------------

/** La page servie d'un coup. */
export const LIGNES_PAR_PAGE = 500;

/**
 * Les colonnes lues, nommées une à une.
 *
 * `id` et `channel_id` sont lus sans être servis : le premier fait le curseur,
 * le second retrouve le canal. `utm` est lu sans être servi non plus — ce
 * qui en sort, ce sont les quatre champs à plat de `ligneExport`, jamais
 * l'objet. Tout le reste est la liste convenue avec le consommateur. Ce qui
 * n'est pas ici ne sort pas, et surtout : `select *` ne doit jamais
 * apparaître dans cette route, sous peine de servir demain un champ ajouté à
 * la vue par un chantier qui ne pensait pas à l'export.
 */
export const COLONNES_EXPORT = [
  "id",
  "channel_id",
  "event_uri",
  "invitee_uri",
  "scheduled_start",
  "scheduled_end",
  "canceled_at",
  "event_type_name",
  "attribution",
  "utm",
  "status",
  "effective_status",
  "sale_amount_cents",
  "sale_date",
  "sale_recorded_at",
  "currency",
  "updated_at",
].join(", ");

/** Ce qu'un tiers reçoit d'un rendez-vous, et rien d'autre. */
export type LigneExport = {
  event_uri: string | null;
  invitee_uri: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  canceled_at: string | null;
  event_type_name: string | null;
  channel: string | null;
  channel_label: string | null;
  attribution: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  status: string | null;
  effective_status: string | null;
  sale_amount_cents: number | null;
  sale_date: string | null;
  sale_recorded_at: string | null;
  currency: string | null;
  updated_at: string | null;
};

export type CanalLisible = { key: string; label: string };

/**
 * Une ligne de la vue vers une ligne d'export.
 *
 * Écrite en toutes lettres plutôt qu'en `...ligne` privé de deux champs : une
 * omission se lit ici, une soustraction se prouve ailleurs. C'est la même
 * raison qui fait qu'on liste `COLONNES_EXPORT` au lieu d'un `select *`, et
 * les deux se contrôlent mutuellement — un champ qu'on lirait sans le servir
 * ne sortirait pas, un champ qu'on servirait sans le lire vaudrait `null`.
 *
 * Le canal sort par sa clé (`google_ads`) plutôt que par son UUID : un rapport
 * publicitaire regroupe par canal, et un identifiant technique l'obligerait à
 * tenir une table de correspondance qui vieillirait mal.
 *
 * Les quatre `utm_*` sortent **à plat et nommés un à un**, jamais l'objet
 * `utm`. C'est la même règle qu'ailleurs dans ce fichier, appliquée là où elle
 * compte le plus : cette colonne est libre, elle porte ce que la landing a
 * transmis — un `utm_term`, un `gclid`, un paramètre qu'une campagne aura
 * collé au lien un mardi. Servir l'objet reviendrait à publier d'avance des
 * champs que personne n'a relus. Les quatre retenus sont ceux qu'un rapport
 * publicitaire recoupe avec ses campagnes ; le reste ne quitte pas la maison.
 * Absent vaut `null` : c'est ce qui distingue « la campagne n'était pas
 * taguée » de « la valeur est vide ».
 */
export function ligneExport(
  ligne: Record<string, unknown>,
  canal: CanalLisible | null,
): LigneExport {
  const texte = (valeur: unknown) => (typeof valeur === "string" ? valeur : null);
  const nombre = (valeur: unknown) => (typeof valeur === "number" ? valeur : null);

  // `utm` est un `jsonb not null default '{}'` ; un tableau ou un scalaire n'y
  // a jamais sa place, et s'il en arrivait un, ce serait quatre `null`.
  const utm: Record<string, unknown> =
    typeof ligne.utm === "object" && ligne.utm !== null && !Array.isArray(ligne.utm)
      ? (ligne.utm as Record<string, unknown>)
      : {};

  return {
    event_uri: texte(ligne.event_uri),
    invitee_uri: texte(ligne.invitee_uri),
    scheduled_start: texte(ligne.scheduled_start),
    scheduled_end: texte(ligne.scheduled_end),
    canceled_at: texte(ligne.canceled_at),
    event_type_name: texte(ligne.event_type_name),
    channel: canal?.key ?? null,
    channel_label: canal?.label ?? null,
    attribution: texte(ligne.attribution),
    utm_source: texte(utm.utm_source),
    utm_medium: texte(utm.utm_medium),
    utm_campaign: texte(utm.utm_campaign),
    utm_content: texte(utm.utm_content),
    status: texte(ligne.status),
    effective_status: texte(ligne.effective_status),
    sale_amount_cents: nombre(ligne.sale_amount_cents),
    sale_date: texte(ligne.sale_date),
    sale_recorded_at: texte(ligne.sale_recorded_at),
    currency: texte(ligne.currency),
    updated_at: texte(ligne.updated_at),
  };
}

/**
 * Le préambule de chaque réponse.
 *
 * Il dit trois choses que le consommateur devrait sinon deviner : dans quel
 * fuseau lire les jours, sous quelle forme arrivent les horodatages, et
 * surtout ce que ce flux n'est pas. La purge y est écrite plutôt qu'annoncée
 * une fois dans un courriel — un rapport qui tourne pendant deux ans sera lu
 * par quelqu'un qui n'était pas là au branchement.
 */
export const PURGE = [
  "identité jamais servie ; lignes supprimées 13 mois après clôture du relevé",
  "— ce flux n'est pas une archive, copiez ce que vous lisez",
].join(" ");

export function meta(suivant: string | null) {
  return {
    fuseau_de_reference: "Europe/Paris",
    horodatages: "ISO 8601 avec décalage",
    purge: PURGE,
    suivant,
  };
}
