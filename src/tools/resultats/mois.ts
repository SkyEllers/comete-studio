/**
 * Les mois, tels que Radar les compte.
 *
 * Un mois est une date : le premier jour, en heure de Paris. C'est la base qui
 * tranche — `radar_mois()` et la colonne `mois` de la vue — et ce fichier ne
 * fait que nommer et enchaîner ces dates, sans jamais refaire d'arithmétique
 * de fuseau. Une séance du 1er novembre à 00 h 30 est en octobre pour qui
 * calcule en UTC, et c'est le genre d'erreur qui finit sur une facture.
 */

const AUJOURD_HUI_PARIS = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const NOM_DU_MOIS = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Le mois en cours à Paris, sous la forme « 2026-08-01 ». */
export function moisCourant(): string {
  // « 2026-08-26 » → on ne garde que l'année et le mois.
  return `${AUJOURD_HUI_PARIS.format(new Date()).slice(0, 7)}-01`;
}

/** « 2026-08-01 » → « août 2026 ». */
export function libelleMois(mois: string): string {
  // Lu en UTC : la chaîne est déjà un premier du mois parisien, la relire dans
  // un fuseau la ferait reculer d'un jour.
  return NOM_DU_MOIS.format(new Date(`${mois}T00:00:00Z`));
}

/**
 * « 2026-09-01 » → « septembre », sans l'année.
 *
 * Pour les phrases où l'année serait du bruit : on parle du mois d'à côté,
 * dans un relevé qui porte déjà le sien en titre.
 */
export function nomDuMois(mois: string): string {
  return libelleMois(mois).split(" ")[0]!;
}

/** Le mois d'avant, en arithmétique de calendrier pure. */
export function moisPrecedent(mois: string): string {
  const [annee, numero] = mois.split("-").map(Number);
  return numero === 1
    ? `${annee - 1}-12-01`
    : `${annee}-${String(numero - 1).padStart(2, "0")}-01`;
}

export function moisSuivant(mois: string): string {
  const [annee, numero] = mois.split("-").map(Number);
  return numero === 12
    ? `${annee + 1}-01-01`
    : `${annee}-${String(numero + 1).padStart(2, "0")}-01`;
}

/** Un mois valide, ou celui en cours : ce qui arrive de l'URL ne se croit pas. */
export function moisDemande(valeur: string | string[] | undefined): string {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur;
  return brut && /^\d{4}-\d{2}-01$/.test(brut) ? brut : moisCourant();
}

/**
 * Les puces de mois : ceux qui portent des rendez-vous, plus le mois en cours,
 * du plus récent au plus ancien. Un client qui n'a rien reçu voit quand même
 * son mois, et un mois vide au milieu n'ouvre pas de trou dans la série.
 */
export function moisAOffrir(moisDesRendezVous: string[], limite = 12): string[] {
  const courant = moisCourant();
  const connus = new Set([courant, ...moisDesRendezVous.filter(Boolean)]);

  const plusAncien = [...connus].sort()[0] ?? courant;
  const serie: string[] = [];

  let curseur = courant;
  while (curseur >= plusAncien && serie.length < limite) {
    serie.push(curseur);
    curseur = moisPrecedent(curseur);
  }

  return serie;
}
