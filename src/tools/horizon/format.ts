/**
 * Les montants d'Horizon : « 1 650 € », sans centimes quand il n'y en a pas.
 *
 * Formatés côté serveur et envoyés en texte, comme ceux de Radar : un relevé
 * d'argent n'a pas le droit d'afficher deux chiffres selon l'écran.
 */
const sansCentimes = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const avecCentimes = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function eur(centimes: number): string {
  return Number.isInteger(centimes / 100)
    ? sansCentimes.format(centimes / 100)
    : avecCentimes.format(centimes / 100);
}

/** « + 380 € », « − 120 € » : le signe se lit, il ne se devine pas. */
export function eurSigne(centimes: number): string {
  if (centimes === 0) return eur(0);
  return `${centimes > 0 ? "+" : "−"} ${eur(Math.abs(centimes))}`;
}
