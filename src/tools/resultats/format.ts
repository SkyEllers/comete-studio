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

/**
 * « 90 € », « 1 234,50 € » : les centimes ne s'affichent que s'il y en a.
 *
 * La clé du cache porte les décimales autant que la devise, et ce n'est pas un
 * détail d'optimisation. Avec une clé sur la seule devise — ce qu'elle était
 * jusqu'à la phase 7 — le premier montant formaté par une instance décidait du
 * format de tous les suivants, pour toute sa vie : après un « 90 € », une
 * vente de 2 450,50 € s'affichait « 2 451 € ». Des centimes disparaissaient
 * d'un écran de commission, sans rien dans les logs.
 *
 * Le défaut est resté invisible tant que Radar n'affichait que des séances,
 * presque toujours rondes. Les ventes sont saisies à la main, et ne le sont
 * pas.
 */
export function montant(centimes: number, devise = "EUR"): string {
  const decimales = Number.isInteger(centimes / 100) ? 0 : 2;
  const cle = `${devise}|${decimales}`;

  let format = monnaies.get(cle);
  if (!format) {
    format = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: devise,
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    });
    monnaies.set(cle, format);
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

const heureSeule = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: PARIS,
});

export const dateHeure = (iso: string) => jourEtHeure.format(new Date(iso));
export const heure = (iso: string) => heureSeule.format(new Date(iso));
export const jour = (iso: string) => jourSeul.format(new Date(iso));
export const mois = (iso: string) => moisEtAnnee.format(new Date(iso));

/*
 * Une date de vente n'est pas un instant : c'est une date de calendrier, sans
 * heure et sans fuseau, telle que la base la range. On la lit donc en UTC —
 * la convertir à Paris déplacerait « le 1er septembre » au 31 août.
 */
const jourEnLettres = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
});

/** « 2026-09-03 » → « 3 septembre ». La phrase porte déjà l'année. */
export const dateDeVente = (jourCalendaire: string) =>
  jourEnLettres.format(new Date(`${jourCalendaire}T00:00:00Z`));

const jourISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARIS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Aujourd'hui à Paris, en « 2026-09-03 ».
 *
 * Le même jour que celui dont `radar_set_sale` se sert pour refuser une vente
 * datée dans le futur. Les faire diverger donnerait un champ dont la valeur
 * par défaut est refusée par la base entre minuit et deux heures du matin.
 */
export const aujourdhuiAParis = () => jourISO.format(new Date());

/** Le jour de calendrier d'un instant, à Paris : la borne basse d'une vente. */
export const jourCalendaire = (iso: string) => jourISO.format(new Date(iso));

/**
 * Le mois d'une vente, « 2026-09-03 » → « 2026-09-01 ».
 *
 * Découpage de chaîne et non arithmétique de date : `sale_date` est une date
 * de calendrier, et la faire passer par un `Date` lui inventerait un fuseau —
 * exactement l'erreur que la vue évite en base avec `date_trunc`.
 */
export const moisDeLaVente = (jourCalendaire: string) => `${jourCalendaire.slice(0, 7)}-01`;

/** « il y a 3 jours », pour dire l'âge du dernier webhook sans faire compter. */
export function depuis(iso: string | null): string {
  if (!iso) return "jamais";

  const jours = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "hier";
  return `il y a ${jours} jours`;
}

/**
 * Cet agenda s'est-il tu depuis trop longtemps ?
 *
 * Ici plutôt que dans la page : `Date.now()` appelé pendant le rendu est une
 * impureté que le compilateur React refuse — à raison, puisque deux rendus du
 * même composant donneraient deux résultats.
 */
export function silencieuxDepuis(iso: string | null, jours: number): boolean {
  if (!iso) return false;
  return Date.now() - Date.parse(iso) >= jours * 86_400_000;
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

/**
 * L'attribution à écrire à côté du canal — ou rien, si elle le répète.
 *
 * Un canal « Direct » attribué en `direct` donnait « Direct · direct » : le
 * même mot deux fois, en deux graphies, ce qui donne à croire à deux
 * informations. Quand l'attribution n'apprend rien de plus que le badge, elle
 * se tait ; « Google Ads · campagne », lui, dit bien deux choses.
 *
 * La comparaison ignore la casse et les accents : c'est la même information
 * pour un lecteur, et c'est lui qu'on sert.
 */
export function attributionADire(
  attribution: string,
  libelleCanal: string | null | undefined,
): string | null {
  const lisible = attributionLisible(attribution);
  if (!libelleCanal) return lisible;

  const pareil = (valeur: string) =>
    valeur
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim()
      .toLowerCase();

  return pareil(lisible) === pareil(libelleCanal) ? null : lisible;
}

/**
 * Une vente peut-elle déjà être déclarée sur cette séance ?
 *
 * Non tant que la séance n'a pas eu lieu, au jour près. C'est exactement la
 * règle que `radar_set_sale` fait respecter en base — une vente ne précède pas
 * le rendez-vous qui l'a amenée, et ne se date pas dans le futur — et c'est ce
 * qui rendait le formulaire impossible à remplir sur une séance à venir : sa
 * date minimale (le jour de la séance) tombait après sa date maximale
 * (aujourd'hui), et le navigateur refusait la saisie par un message que
 * personne ne pouvait comprendre.
 *
 * Le jour, et non l'instant : une séance de cet après-midi se vend déjà, comme
 * la base l'autorise.
 *
 * `Date.now()` vit ici plutôt que dans le composant : appelé pendant le rendu,
 * il est une impureté que le compilateur React refuse — la même raison qui a
 * fait descendre `silencieuxDepuis` juste au-dessus.
 */
export function venteEncoreImpossible(scheduledStart: string): boolean {
  return jourCalendaire(scheduledStart) > aujourdhuiAParis();
}

/**
 * Un montant tapé à la main, en euros, vers des centimes.
 *
 * La saisie est française : « 1 200,50 ». Mais un clavier de téléphone met un
 * point sur sa touche décimale, et un copier-coller depuis un tableur peut
 * apporter des espaces insécables ou fines. Refuser ces formes obligerait la
 * personne à deviner celle qu'on attend, pour un chiffre qu'elle a déjà.
 *
 * La règle de lecture, quand les deux séparateurs sont là : la virgule décide.
 * « 1.200,50 » vaut mille deux cents euros et cinquante centimes, les points
 * étant des milliers. Sans virgule, un point est décimal — c'est ce que fait
 * le clavier numérique, et « 1200.50 » ne veut rien dire d'autre.
 *
 * Rend `null` sur tout ce qui n'est pas un montant lisible : à l'écran de dire
 * quoi faire d'une saisie vide ou fautive.
 */
export function centimesSaisis(brut: string | null | undefined): number | null {
  if (typeof brut !== "string") return null;

  // Toutes les espaces, y compris insécable (U+00A0) et fine (U+202F), et le
  // symbole que certains recopient avec le montant.
  const sansBruit = brut.replace(/[\s  ]/g, "").replace(/€/g, "");
  if (sansBruit.length === 0) return null;

  const normalise = sansBruit.includes(",")
    ? sansBruit.replace(/\./g, "").replace(",", ".")
    : sansBruit;

  if (!/^\d+(\.\d{1,2})?$/.test(normalise)) return null;

  // `Math.round` et non une multiplication sèche : 12,29 × 100 vaut
  // 1228.9999999999998 en virgule flottante, et un centime perdu sur une
  // facture est un centime que quelqu'un devra expliquer.
  return Math.round(Number(normalise) * 100);
}

/**
 * Le nom entier, pour la fiche — ou `null` quand il n'y en a pas.
 *
 * La liste se contente de `invitee_display` (« Camille D. »), calculé par la
 * vue. La fiche, elle, montre le nom complet : c'est là qu'on vérifie qu'on
 * parle bien de la bonne personne avant de la marquer « non venue ».
 *
 * `null` plutôt que « Invité·e » : c'est à l'écran de décider comment nommer
 * une absence, et il en dit plus que cette fonction ne pourrait — il ajoute
 * « reçu avant l'identité ».
 */
export function nomComplet(
  prenom: string | null | undefined,
  nom: string | null | undefined,
): string | null {
  const entier = [prenom, nom]
    .map((morceau) => (morceau ?? "").trim())
    .filter(Boolean)
    .join(" ");

  return entier.length > 0 ? entier : null;
}
