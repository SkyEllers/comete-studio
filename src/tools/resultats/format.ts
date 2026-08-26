/**
 * Les formats de Radar.
 *
 * Tout se calcule côté serveur et voyage en texte : un montant ou une date
 * formatés dans le navigateur divergeraient de ceux du rendu serveur, selon la
 * langue et le fuseau de qui regarde. Et un relevé de commission n'a pas le
 * droit d'afficher deux chiffres différents selon l'écran.
 */

const PARIS = "Europe/Paris";

const monnaies = new Map<string, Intl.NumberFormat>();

/** « 90 € », « 1 234,50 € ». */
export function montant(centimes: number, devise = "EUR"): string {
  let format = monnaies.get(devise);
  if (!format) {
    format = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: devise,
      maximumFractionDigits: centimes % 100 === 0 ? 0 : 2,
    });
    monnaies.set(devise, format);
  }
  return format.format(centimes / 100);
}

const jourEtHeure = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: PARIS,
});

const jourSeul = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: PARIS,
});

const moisEtAnnee = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: PARIS,
});

export const dateHeure = (iso: string) => jourEtHeure.format(new Date(iso));
export const jour = (iso: string) => jourSeul.format(new Date(iso));
export const mois = (iso: string) => moisEtAnnee.format(new Date(iso));

/** « il y a 3 jours », pour dire l'âge du dernier webhook sans faire compter. */
export function depuis(iso: string | null): string {
  if (!iso) return "jamais";

  const jours = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "hier";
  return `il y a ${jours} jours`;
}

const STATUTS: Record<string, string> = {
  confirme: "Confirmé",
  honore: "Honoré",
  annule: "Annulé",
  no_show: "Non venu",
};

const ATTRIBUTIONS: Record<string, string> = {
  utm: "campagne",
  recurrence: "récurrence",
  direct: "direct",
  manuel: "corrigé par Louis",
};

export const statutLisible = (statut: string) => STATUTS[statut] ?? statut;
export const attributionLisible = (attribution: string) =>
  ATTRIBUTIONS[attribution] ?? attribution;
