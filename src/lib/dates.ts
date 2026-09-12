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

  const nom =
    parties.find((partie) => partie.type === "timeZoneName")?.value ?? "GMT+01:00";
  const decalage = nom.replace("GMT", "");
  return decalage.length === 0 ? "+00:00" : decalage;
}

/**
 * Les deux instants qui bornent la plage, en heure de Paris.
 *
 * Celui qui lit pense en jours de calendrier français ; la base range des
 * instants. Sans cette conversion, un rendez-vous du 1er à 00 h 30 tomberait
 * dans la veille, et celui du 30 à 23 h 30 dans le lendemain.
 *
 * Écrite pour l'export de Radar, elle a servi ensuite aux semaines de Pulsar :
 * elle vit ici, avec le reste du découpage du temps, plutôt que dans l'outil
 * qui l'a demandée en premier.
 */
export function bornesParis(
  depuis: string,
  jusqua: string,
): { debut: string; fin: string } {
  return {
    debut: `${depuis}T00:00:00.000${decalageParis(depuis)}`,
    fin: `${jusqua}T23:59:59.999${decalageParis(jusqua)}`,
  };
}

/**
 * Midi, ce jour-là, à Paris.
 *
 * L'ancre des saisies qui n'ont pas d'heure — une demi-journée rattrapée le
 * lendemain, par exemple. Midi plutôt que minuit parce qu'aucune heure d'été
 * ne le déplace d'un jour, et parce qu'une entrée de deux heures posée à midi
 * ne déborde jamais sur le lendemain.
 */
export function midiParis(jour: string): string {
  return `${jour}T12:00:00.000${decalageParis(jour)}`;
}

/**
 * Le jour qui suit celui-ci de `nombre` jours, en arithmétique de calendrier.
 *
 * Menée en UTC sur une date sans heure : il n'y a pas de fuseau à ce stade,
 * le jour parisien a déjà été décidé par `jourParis`. Ajouter 86 400 000
 * millisecondes à un instant, en revanche, se trompe deux fois par an.
 */
export function ajouterJours(jour: string, nombre: number): string {
  const date = new Date(`${jour}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + nombre);
  return date.toISOString().slice(0, 10);
}

/**
 * Le lundi de la semaine d'un jour donné. « 2026-09-12 » → « 2026-09-07 ».
 *
 * La semaine commence le lundi — c'est la semaine de travail — et `getUTCDay`
 * compte à partir du dimanche, d'où le décalage.
 */
export function lundiDeLaSemaine(jour: string): string {
  const date = new Date(`${jour}T00:00:00Z`);
  return ajouterJours(jour, -((date.getUTCDay() + 6) % 7));
}

/** Le dimanche qui ferme cette semaine-là. */
export function dimancheDeLaSemaine(jour: string): string {
  return ajouterJours(lundiDeLaSemaine(jour), 6);
}

const HEURE_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * L'heure d'un instant, à Paris : « 14:07 ».
 *
 * À calculer côté serveur et à passer en texte aux composants clients : sinon
 * le rendu diverge entre le serveur et le navigateur.
 */
export function heureParis(instant: string | number | Date): string {
  return HEURE_PARIS.format(instant instanceof Date ? instant : new Date(instant));
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
