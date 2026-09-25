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
