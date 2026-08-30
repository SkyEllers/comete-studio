const JOUR_PARIS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Le jour d'un instant, en heure de Paris : « 2026-08-30 ».
 *
 * Le hub découpe ses journées ici et nulle part ailleurs. Une idée notée à
 * 00 h 30, une visite à 23 h 50, un rendez-vous du 1er du mois : tous
 * tomberaient dans le mauvais jour si on les lisait en UTC, et chaque outil
 * qui referait ce calcul chez lui finirait par le refaire un peu autrement.
 */
export function jourParis(instant: string | number | Date = new Date()): string {
  return JOUR_PARIS.format(
    instant instanceof Date ? instant : new Date(instant),
  );
}

const relative = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

const PALIERS: {
  limite: number;
  unite: Intl.RelativeTimeFormatUnit;
  pas: number;
}[] = [
  { limite: 3600, unite: "minute", pas: 60 },
  { limite: 86400, unite: "hour", pas: 3600 },
  { limite: 604800, unite: "day", pas: 86400 },
  { limite: 2629800, unite: "week", pas: 604800 },
  { limite: 31557600, unite: "month", pas: 2629800 },
  { limite: Infinity, unite: "year", pas: 31557600 },
];

/**
 * « il y a 3 heures », « hier », « à l'instant ».
 *
 * À calculer côté serveur et à passer en texte aux composants clients : sinon
 * le rendu diverge entre le serveur et le navigateur.
 */
export function tempsRelatif(iso: string, maintenant = new Date()): string {
  const secondes = (new Date(iso).getTime() - maintenant.getTime()) / 1000;

  if (Math.abs(secondes) < 60) return "à l'instant";

  const palier =
    PALIERS.find((p) => Math.abs(secondes) < p.limite) ?? PALIERS.at(-1)!;
  return relative.format(Math.round(secondes / palier.pas), palier.unite);
}
