/**
 * Une date et une heure dites à Paris (« 2026-10-09 », « 19:15 ») en instant
 * ISO, heure d'été comprise. Null si la date n'existe pas. Sans dépendance au
 * serveur : testable seul (08/10/2026, bouton « Déplacer » des closeuses).
 */

const PARIS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Ce que l'horloge de Paris affiche à cet instant, lu comme s'il était UTC. */
function lueAParis(instant: number): number {
  const p = Object.fromEntries(PARIS.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
}

export function parisVersIso(date: string, heure: string): string | null {
  const [a, m, j] = date.split("-").map(Number);
  const [h, mi] = heure.split(":").map(Number);
  if ([a, m, j, h, mi].some((x) => !Number.isInteger(x)) || h > 23 || mi > 59) return null;
  const voulu = Date.UTC(a, m - 1, j, h, mi);
  const verif = new Date(voulu);
  if (verif.getUTCFullYear() !== a || verif.getUTCMonth() !== m - 1 || verif.getUTCDate() !== j) return null;
  // Deux passes : l'écart de Paris dépend de l'instant (heure d'été).
  let instant = voulu - (lueAParis(voulu) - voulu);
  instant = voulu - (lueAParis(instant) - instant);
  return new Date(instant).toISOString();
}

/** Les heures proposées : de 7h à 21h45, tous les quarts d'heure. */
export const HEURES_POSSIBLES = Array.from({ length: (22 - 7) * 4 }, (_, i) => {
  const minutes = 7 * 60 + i * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
