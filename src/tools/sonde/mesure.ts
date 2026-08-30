import { jourParis } from "../../lib/dates.ts";

/**
 * Ce que Sonde compte, et sur quelle période.
 *
 * Fonctions pures : l'appelant fournit les lignes, elles rendent des nombres.
 * C'est ce qui permet de dérouler ici les cas qui ne se présentent jamais
 * quand on regarde l'écran — un mois à cheval sur l'agrégation, une nuit
 * ratée, un jour à zéro au milieu d'une série.
 *
 * Une chose à savoir avant de lire le reste. Sonde ne garde aucune clé de
 * visiteur au-delà de treize mois, et l'agrégat quotidien n'en garde aucune du
 * tout : le nombre de visiteurs d'une période est donc la **somme des
 * visiteurs de chaque jour**. Quelqu'un qui revient trois jours de suite
 * compte trois fois. Ce n'est pas une approximation qu'on corrigera plus tard,
 * c'est la contrepartie exacte de l'absence de cookie — et l'écran doit le
 * dire plutôt que de laisser croire à un décompte de personnes.
 */

export type Seau = "direct" | "canal" | "referent";

/** Une ligne d'agrégat, ou son équivalent calculé sur les bruts du jour. */
export type LigneJour = {
  day: string;
  channel_id: string | null;
  channel_bucket: Seau;
  pageviews: number;
  visitors: number;
  cta_clicks: number;
};

export type Compte = { visiteurs: number; pagesVues: number; clics: number };

export type Mesure = Compte & {
  /** Un point par jour de la période, y compris les jours sans rien. */
  jours: (Compte & { jour: string })[];
  /** Par canal, la clé étant l'identifiant du canal ou le seau à défaut. */
  parCanal: (Compte & { cle: string; channelId: string | null; seau: Seau })[];
};

// -------------------------------- Les jours ---------------------------------

const JOUR_MS = 86_400_000;

/** Le jour suivant, en arithmétique de calendrier pure. */
export function jourSuivant(jour: string): string {
  return jourParis(new Date(`${jour}T12:00:00Z`).getTime() + JOUR_MS);
}

/** Tous les jours de `debut` à `fin`, bornes comprises. */
export function joursDe(debut: string, fin: string, limite = 400): string[] {
  const serie: string[] = [];
  let curseur = debut;

  while (curseur <= fin && serie.length < limite) {
    serie.push(curseur);
    curseur = jourSuivant(curseur);
  }

  return serie;
}

// ------------------------------- Les périodes -------------------------------

export type Periode = {
  /** Ce qui voyage dans l'URL : `7j` ou un premier du mois. */
  cle: string;
  libelle: string;
  debut: string;
  fin: string;
};

const NOM_DU_MOIS = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** « 2026-08-01 » → « août 2026 ». */
export function libelleMois(mois: string): string {
  return NOM_DU_MOIS.format(new Date(`${mois}T00:00:00Z`));
}

/** Le dernier jour du mois, en calendrier. */
function finDuMois(mois: string): string {
  const [annee, numero] = mois.split("-").map(Number);
  const suivant =
    numero === 12 ? `${annee + 1}-01-01` : `${annee}-${String(numero + 1).padStart(2, "0")}-01`;
  return jourParis(new Date(`${suivant}T12:00:00Z`).getTime() - JOUR_MS);
}

/**
 * La période demandée, ou le mois en cours.
 *
 * Ce qui vient de l'URL ne se croit pas : `7j` ou un premier du mois, rien
 * d'autre. La fin est bornée à aujourd'hui — afficher les vingt jours à venir
 * d'un mois en cours dessinerait vingt colonnes vides que personne ne saurait
 * lire.
 */
export function periodeDemandee(
  valeur: string | string[] | undefined,
  aujourdhui = jourParis(),
): Periode {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur;
  const moisCourant = `${aujourdhui.slice(0, 7)}-01`;

  if (brut === "7j") {
    const debut = joursDe(
      jourParis(new Date(`${aujourdhui}T12:00:00Z`).getTime() - 6 * JOUR_MS),
      aujourdhui,
    )[0];
    return { cle: "7j", libelle: "7 derniers jours", debut, fin: aujourdhui };
  }

  /* Un mois à venir retombe sur le mois en cours : sans ce garde-fou,
     `?periode=2030-01-01` donnerait un début après la fin, donc une série de
     jours vide sous un titre qui promet janvier 2030. */
  const demande = brut && /^\d{4}-\d{2}-01$/.test(brut) ? brut : moisCourant;
  const mois = demande > moisCourant ? moisCourant : demande;
  const fin = finDuMois(mois);

  return {
    cle: mois,
    libelle: libelleMois(mois),
    debut: mois,
    fin: fin > aujourdhui ? aujourdhui : fin,
  };
}

/**
 * Les puces : les sept derniers jours, puis les mois, du plus récent au plus
 * ancien. Le mois en cours y est toujours, même sans une seule visite : un
 * écran vide qui ne propose rien à cliquer ressemble à une panne.
 */
export function periodesAOffrir(joursConnus: string[], aujourdhui = jourParis(), limite = 12) {
  const moisCourant = `${aujourdhui.slice(0, 7)}-01`;
  const mois = new Set([moisCourant, ...joursConnus.map((jour) => `${jour.slice(0, 7)}-01`)]);

  const ordonnes = [...mois].sort().reverse().slice(0, limite);

  return [
    { cle: "7j", libelle: "7 derniers jours" },
    ...ordonnes.map((valeur) => ({ cle: valeur, libelle: libelleMois(valeur) })),
  ];
}

// ------------------------------- La couture ---------------------------------

/**
 * Le premier jour qu'il faut relire sur les événements bruts.
 *
 * L'agrégat s'arrête à la dernière nuit passée ; le jour en cours n'y est
 * jamais, et une nuit ratée y laisse un trou. Plutôt que de supposer que
 * l'agrégation a tourné, on repart du lendemain de ce qu'elle a réellement
 * écrit — ce qui rattrape le jour courant et les nuits manquées du même geste.
 *
 * Les lignes d'agrégat portant le jour courant sont ignorées : elles ne
 * peuvent venir que d'un recalcul manuel, et le jour en cours doit se lire sur
 * les bruts, qui bougent encore.
 */
export function depuisQuandRelire(
  lignes: LigneJour[],
  debut: string,
  aujourdhui = jourParis(),
): string {
  const agreges = lignes
    .map((ligne) => ligne.day)
    .filter((jour) => jour < aujourdhui)
    .sort();

  const dernier = agreges.at(-1);
  if (!dernier) return debut;

  const lendemain = jourSuivant(dernier);
  return lendemain > debut ? lendemain : debut;
}

/** Un événement brut, réduit à ce que le comptage demande. */
export type EvenementBrut = {
  occurred_at: string;
  kind: "pageview" | "cta";
  channel_id: string | null;
  channel_bucket: Seau;
  visitor_key: string;
};

/**
 * Les jours récents, comptés sur les bruts comme la base le ferait.
 *
 * Même découpage que `sonde_agreger_jour` : par jour parisien, par canal, et
 * les visiteurs en distincts. La couture entre l'agrégat et le direct doit
 * être invisible à l'écran, ce qui suppose que les deux comptent pareil.
 */
export function agregerBruts(evenements: EvenementBrut[]): LigneJour[] {
  const groupes = new Map<string, LigneJour & { cles: Set<string> }>();

  for (const evenement of evenements) {
    const day = jourParis(evenement.occurred_at);
    const cle = `${day}|${evenement.channel_bucket}|${evenement.channel_id ?? ""}`;

    let ligne = groupes.get(cle);
    if (!ligne) {
      ligne = {
        day,
        channel_id: evenement.channel_id,
        channel_bucket: evenement.channel_bucket,
        pageviews: 0,
        visitors: 0,
        cta_clicks: 0,
        cles: new Set(),
      };
      groupes.set(cle, ligne);
    }

    if (evenement.kind === "pageview") ligne.pageviews += 1;
    else ligne.cta_clicks += 1;
    ligne.cles.add(evenement.visitor_key);
  }

  return [...groupes.values()].map(({ cles, ...ligne }) => ({
    ...ligne,
    visitors: cles.size,
  }));
}

// ------------------------------- Le total -----------------------------------

const vide = (): Compte => ({ visiteurs: 0, pagesVues: 0, clics: 0 });

const ajouter = (compte: Compte, ligne: LigneJour): Compte => ({
  visiteurs: compte.visiteurs + ligne.visitors,
  pagesVues: compte.pagesVues + ligne.pageviews,
  clics: compte.clics + ligne.cta_clicks,
});

/**
 * La mesure d'une période : les totaux, la courbe, la répartition par canal.
 *
 * Les jours sans rien sont présents et à zéro. Un graphique qui sauterait les
 * jours creux raconterait une fréquentation régulière là où il y a eu un
 * week-end mort.
 */
export function mesurer(lignes: LigneJour[], periode: Periode): Mesure {
  const dansLaPeriode = lignes.filter(
    (ligne) => ligne.day >= periode.debut && ligne.day <= periode.fin,
  );

  const parJour = new Map<string, Compte>();
  for (const jour of joursDe(periode.debut, periode.fin)) parJour.set(jour, vide());

  const parCanal = new Map<string, Compte & { channelId: string | null; seau: Seau }>();
  let total = vide();

  for (const ligne of dansLaPeriode) {
    total = ajouter(total, ligne);

    const jour = parJour.get(ligne.day);
    if (jour) parJour.set(ligne.day, ajouter(jour, ligne));

    const cle = ligne.channel_id ?? ligne.channel_bucket;
    const canal = parCanal.get(cle) ?? {
      ...vide(),
      channelId: ligne.channel_id,
      seau: ligne.channel_bucket,
    };
    parCanal.set(cle, { ...canal, ...ajouter(canal, ligne) });
  }

  return {
    ...total,
    jours: [...parJour.entries()].map(([jour, compte]) => ({ jour, ...compte })),
    parCanal: [...parCanal.entries()]
      .map(([cle, canal]) => ({ cle, ...canal }))
      .sort((a, b) => b.visiteurs - a.visiteurs || a.cle.localeCompare(b.cle)),
  };
}

/** « 13,7 % », ou « — » quand il n'y a rien à diviser. */
export function taux(numerateur: number, denominateur: number): string {
  if (denominateur <= 0) return "—";
  return `${((numerateur / denominateur) * 100).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} %`;
}

/** « 3 visiteurs », « 1 visiteur », « Aucun visiteur ». */
export function compte(nombre: number, singulier: string, pluriel = `${singulier}s`): string {
  if (nombre === 0) return `Aucun ${singulier}`;
  return `${nombre.toLocaleString("fr-FR")} ${nombre > 1 ? pluriel : singulier}`;
}
