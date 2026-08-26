/**
 * Les échéances sont des jours de calendrier, pas des instants : la base les
 * stocke en `date` et l'application les manipule en `YYYY-MM-DD`.
 *
 * Comparer ces chaînes entre elles suffit et évite le piège du fuseau —
 * `toISOString()` sur une date locale bascule d'un jour selon l'heure.
 */

export function jourISO(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

export function aujourdhuiISO(): string {
  return jourISO(new Date());
}

/** Le jour tombant dans `n` jours, échéances « cette semaine » comprises. */
export function dansNJours(n: number, depuis = new Date()): string {
  const jour = new Date(depuis);
  jour.setDate(jour.getDate() + n);
  return jourISO(jour);
}

/** Une échéance du jour n'est pas encore dépassée. */
export function estDepassee(dueDate: string, aujourdhui = aujourdhuiISO()) {
  return dueDate < aujourdhui;
}
