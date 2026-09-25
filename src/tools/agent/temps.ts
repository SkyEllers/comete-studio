/**
 * Les dates telles que la cliente les lit, dans son fuseau à elle.
 */

/** « jeudi 8 octobre » */
export function jourEnMots(instant: string | Date, fuseau: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: fuseau,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(instant));
}

/** « 14h », « 9h30 » */
export function heureEnMots(instant: string | Date, fuseau: string): string {
  const parties = new Intl.DateTimeFormat("fr-FR", {
    timeZone: fuseau,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const heure = Number(parties.find((p) => p.type === "hour")?.value ?? "0");
  const minute = parties.find((p) => p.type === "minute")?.value ?? "00";
  return minute === "00" ? `${heure}h` : `${heure}h${minute}`;
}

/** Un `interval` Postgres (« 24:00:00 », « 1 day 02:00:00 ») en millisecondes. */
export function intervalleMs(valeur: string): number {
  const jours = /(-?\d+)\s*days?/.exec(valeur);
  const heures = /(-?\d+):(\d+):(\d+)/.exec(valeur);
  const j = jours ? Number(jours[1]) : 0;
  const s = heures
    ? Math.sign(Number(heures[1]) || 1) *
      (Math.abs(Number(heures[1])) * 3600 + Number(heures[2]) * 60 + Number(heures[3]))
    : 0;
  return (j * 86400 + s) * 1000;
}

// ----------------------------- Jours locaux --------------------------------

/** « 2026-10-08 » : le jour civil de cet instant, dans ce fuseau. */
export function jourLocal(instant: string | Date | number, fuseau: string): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function decoupe(jour: string): [number, number, number] {
  const [a, m, j] = jour.split("-").map(Number);
  return [a, m, j];
}

/** Nombre de jours civils de `de` à `a` (négatif si `a` est avant). */
export function joursEntre(de: string, a: string): number {
  const [a1, m1, j1] = decoupe(de);
  const [a2, m2, j2] = decoupe(a);
  return Math.round((Date.UTC(a2, m2 - 1, j2) - Date.UTC(a1, m1 - 1, j1)) / 86_400_000);
}

export function ajouterJours(jour: string, n: number): string {
  const [a, m, j] = decoupe(jour);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Décalage du fuseau à cet instant, en millisecondes (Paris l'été : +2 h). */
function decalageFuseau(instant: number, fuseau: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: fuseau,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value]),
  );
  const commeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return commeUtc - Math.floor(instant / 1000) * 1000;
}

/** L'instant où il est `heure`:`minute` ce jour-là, dans ce fuseau. */
export function instantLocal(jour: string, heure: number, minute: number, fuseau: string): number {
  const [a, m, j] = decoupe(jour);
  const naif = Date.UTC(a, m - 1, j, heure, minute);
  const essai = naif - decalageFuseau(naif, fuseau);
  // Un changement d'heure entre les deux lectures : on relit au bon endroit.
  return naif - decalageFuseau(essai, fuseau);
}
