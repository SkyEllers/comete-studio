/**
 * Le rapport d'entonnoir de la landing de Jonathan, à part de ses appels réseau.
 *
 * Fonctions pures : une réponse de l'API Data de GA4 entre, des nombres et des
 * tableaux en texte sortent. Elles se déroulent sous `node --test` sans jeton
 * ni propriété — c'est tout l'intérêt de les tenir loin du script qui appelle
 * Google.
 */

/** Les sept événements que la landing pousse et que GTM relaie à GA4. */
export const EVENEMENTS = [
  "lp_view",
  "lp_cta_click",
  "calendly_event_type_viewed",
  "calendly_date_and_time_selected",
  "calendly_event_scheduled",
  "video_start",
  "video_progress",
];

/** L'entonnoir, dans l'ordre où un visiteur le descend. */
export const ETAPES = [
  { evenement: "lp_view", libelle: "Vue de la landing" },
  { evenement: "video_start", libelle: "VSL lancée" },
  { evenement: "lp_cta_click", libelle: "Clic réserver" },
  { evenement: "calendly_event_type_viewed", libelle: "Calendrier affiché" },
  { evenement: "calendly_date_and_time_selected", libelle: "Date et heure choisies" },
  { evenement: "calendly_event_scheduled", libelle: "Rendez-vous réservé" },
];

/** Les paliers que la landing envoie avec `video_progress`. */
export const PALIERS = ["25", "50", "75", "95"];

/**
 * Le jour où GA4 a commencé à recevoir l'entonnoir : publication de la
 * version 10 du conteneur GTM-NZCNQF9R. Avant, ces événements partaient dans
 * le `dataLayer` et nulle part ailleurs.
 */
export const DEBUT_MESURE = "2026-09-11";

const DIMENSION_PALIER = "customEvent:video_percent";

// ------------------------------- Les options --------------------------------

/** Une date `AAAA-MM-JJ` qui existe au calendrier : le 30 février ne passe pas. */
function dateValide(valeur) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur ?? "")) return false;
  const date = new Date(`${valeur}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valeur;
}

/**
 * `--du=AAAA-MM-JJ`, `--au=AAAA-MM-JJ`, `--propriete=123`, le reste par défaut.
 *
 * Tout ce qui est mal formé arrête le script : un rapport sur une période
 * devinée ressemble exactement à un rapport juste.
 */
export function lireOptions(argv, defauts) {
  const options = { ...defauts };

  for (const argument of argv) {
    const coupure = argument.indexOf("=");
    const cle = argument.slice(2, coupure === -1 ? undefined : coupure);

    if (!argument.startsWith("--") || !["du", "au", "propriete"].includes(cle)) {
      throw new Error(`Option inconnue : ${argument}`);
    }
    options[cle] = coupure === -1 ? "" : argument.slice(coupure + 1);
  }

  for (const cle of ["du", "au"]) {
    if (!dateValide(options[cle])) {
      throw new Error(`Date invalide pour --${cle} : « ${options[cle]} ».`);
    }
  }
  if (options.du > options.au) {
    throw new Error(`Période à l'envers : du ${options.du} au ${options.au}.`);
  }
  if (!/^\d+$/.test(options.propriete ?? "")) {
    throw new Error(`Identifiant de propriété invalide : « ${options.propriete} ».`);
  }

  return options;
}

// ------------------------------- Les requêtes -------------------------------

/**
 * Les requêtes `runReport`, en deux lots.
 *
 * Le premier ne peut échouer que pour une raison d'accès. Le second lit la
 * dimension `video_percent`, que GA4 refuse tant qu'elle n'est pas déclarée
 * dans la propriété — et un refus emporte tout le lot. Les séparer, c'est
 * garder l'entonnoir lisible le jour où les paliers ne le sont pas.
 *
 * Les personnes (`totalUsers`) ne se demandent que sans découpage par source :
 * elles ne s'additionnent pas d'une source à l'autre.
 */
export function requetes({ du, au }) {
  const dateRanges = [{ startDate: du, endDate: au }];
  const source = [{ name: "sessionSource" }, { name: "sessionMedium" }];
  const septEvenements = {
    filter: { fieldName: "eventName", inListFilter: { values: EVENEMENTS } },
  };
  const progression = {
    filter: {
      fieldName: "eventName",
      stringFilter: { matchType: "EXACT", value: "video_progress" },
    },
  };

  return {
    evenements: [
      {
        dateRanges,
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: septEvenements,
        limit: 100,
      },
      {
        dateRanges,
        dimensions: [{ name: "eventName" }, ...source],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: septEvenements,
        limit: 10000,
      },
    ],
    paliers: [
      {
        dateRanges,
        dimensions: [{ name: DIMENSION_PALIER }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: progression,
        limit: 100,
      },
      {
        dateRanges,
        dimensions: [{ name: DIMENSION_PALIER }, ...source],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: progression,
        limit: 10000,
      },
    ],
  };
}

// ------------------------------- La lecture ---------------------------------

/** Les lignes d'une réponse `runReport`, en objets nommés par en-tête. */
export function lignes(reponse) {
  const dimensions = (reponse?.dimensionHeaders ?? []).map((entete) => entete.name);
  const metriques = (reponse?.metricHeaders ?? []).map((entete) => entete.name);

  return (reponse?.rows ?? []).map((rangee) => {
    const ligne = {};
    dimensions.forEach((nom, i) => {
      ligne[nom] = rangee.dimensionValues?.[i]?.value ?? "";
    });
    metriques.forEach((nom, i) => {
      ligne[nom] = Number(rangee.metricValues?.[i]?.value ?? 0);
    });
    return ligne;
  });
}

/** « 25 », « 25.0 » ou 25 → « 25 » ; le reste tel quel, « (not set) » compris. */
export function palier(valeur) {
  const nombre = Number(valeur);
  return valeur !== "" && Number.isFinite(nombre) ? String(nombre) : String(valeur);
}

/** La campagne Google Ads, telle que GA4 l'attribue à la session. */
export const estGoogleCpc = (ligne) =>
  ligne.sessionSource === "google" && ligne.sessionMedium === "cpc";

/** « 33,3 % », ou « — » quand il n'y a rien à diviser. */
export function taux(nombre, base) {
  if (!(base > 0)) return "—";
  return `${(Math.round((nombre / base) * 1000) / 10).toLocaleString("fr-FR")} %`;
}

// ------------------------------- Le calcul ----------------------------------

const ajouter = (carte, cle, nombre) => carte.set(cle, (carte.get(cle) ?? 0) + nombre);

const compteurs = () => ({ total: new Map(), cpc: new Map(), personnes: new Map() });

function rangee(libelle, comptes, cle, base) {
  const total = comptes.total.get(cle) ?? 0;
  const googleCpc = comptes.cpc.get(cle) ?? 0;

  return {
    libelle,
    total,
    googleCpc,
    autres: total - googleCpc,
    personnes: comptes.personnes.get(cle) ?? 0,
    taux: taux(total, base.total),
    tauxCpc: taux(googleCpc, base.cpc),
  };
}

/**
 * Les chiffres du rapport.
 *
 * Les totaux et les personnes viennent des requêtes sans découpage ; la part
 * google / cpc, des requêtes découpées par source. « Autres » est la
 * différence plutôt que la somme des autres sources : GA4 regroupe parfois les
 * petites lignes, et une somme raterait ce qu'il a regroupé.
 *
 * `paliers` à `null` : la dimension `video_percent` n'existe pas encore, la
 * rétention de la VSL n'est pas lisible, le reste de l'entonnoir si.
 */
export function calculer({
  evenements,
  parSourceEvenements,
  paliers = null,
  parSourcePaliers = null,
}) {
  const ev = compteurs();
  for (const ligne of evenements) {
    ajouter(ev.total, ligne.eventName, ligne.eventCount);
    ajouter(ev.personnes, ligne.eventName, ligne.totalUsers ?? 0);
  }
  for (const ligne of parSourceEvenements) {
    if (estGoogleCpc(ligne)) ajouter(ev.cpc, ligne.eventName, ligne.eventCount);
  }

  const base = (cle) => ({ total: ev.total.get(cle) ?? 0, cpc: ev.cpc.get(cle) ?? 0 });
  const entonnoir = ETAPES.map((etape) =>
    rangee(etape.libelle, ev, etape.evenement, base("lp_view")),
  );
  const totalProgression = ev.total.get("video_progress") ?? 0;

  if (!paliers) return { entonnoir, vsl: null, sansPalier: 0, totalProgression };

  const vp = compteurs();
  for (const ligne of paliers) {
    const cle = palier(ligne[DIMENSION_PALIER]);
    ajouter(vp.total, cle, ligne.eventCount);
    ajouter(vp.personnes, cle, ligne.totalUsers ?? 0);
  }
  for (const ligne of parSourcePaliers ?? []) {
    if (estGoogleCpc(ligne)) ajouter(vp.cpc, palier(ligne[DIMENSION_PALIER]), ligne.eventCount);
  }

  /* La rétention se lit sur les lancements, pas sur les vues de la landing :
     « 40 % à mi-parcours » veut dire 40 % de ceux qui ont appuyé sur lecture. */
  const lancements = base("video_start");
  const vsl = [
    rangee("VSL lancée", ev, "video_start", lancements),
    ...PALIERS.map((p) => rangee(`VSL ${p} %`, vp, p, lancements)),
  ];

  // Les video_progress reçus avant la création de la dimension n'ont pas de palier.
  const lisibles = PALIERS.reduce((somme, p) => somme + (vp.total.get(p) ?? 0), 0);

  return {
    entonnoir,
    vsl,
    sansPalier: Math.max(0, totalProgression - lisibles),
    totalProgression,
  };
}

/** Les événements par source / support de session, les plus gros apporteurs de vues d'abord. */
export function parSource(lignesSource, limite = 10) {
  const groupes = new Map();

  for (const ligne of lignesSource) {
    const cle = `${ligne.sessionSource} / ${ligne.sessionMedium}`;
    const groupe = groupes.get(cle) ?? { cle, comptes: {} };
    groupe.comptes[ligne.eventName] = (groupe.comptes[ligne.eventName] ?? 0) + ligne.eventCount;
    groupes.set(cle, groupe);
  }

  return [...groupes.values()]
    .sort((a, b) => (b.comptes.lp_view ?? 0) - (a.comptes.lp_view ?? 0) || a.cle.localeCompare(b.cle))
    .slice(0, limite);
}

// ------------------------------- La sortie ----------------------------------

/** Un tableau en texte : première colonne à gauche, nombres à droite. */
export function tableau(entetes, rangees) {
  const cellules = [entetes, ...rangees].map((r) =>
    r.map((c) => (c === null || c === undefined ? "—" : String(c))),
  );
  const largeurs = entetes.map((_, i) => Math.max(...cellules.map((r) => r[i].length)));
  const aligner = (r) =>
    r.map((c, i) => (i === 0 ? c.padEnd(largeurs[i]) : c.padStart(largeurs[i]))).join("  ");

  return [
    aligner(cellules[0]),
    largeurs.map((largeur) => "-".repeat(largeur)).join("  "),
    ...cellules.slice(1).map(aligner),
  ].join("\n");
}

const jourFr = (jour) => jour.split("-").reverse().join("/");

const COLONNES = ["Total", "google / cpc", "Autres", "Personnes", "Taux", "Taux cpc"];

const enCellules = (r) => [r.libelle, r.total, r.googleCpc, r.autres, r.personnes, r.taux, r.tauxCpc];

/** Le rapport complet, prêt à lire dans un terminal. */
export function rediger({ du, au, propriete, entonnoir, vsl, sansPalier, totalProgression, sources }) {
  const blocs = [
    `Entonnoir de la landing — propriété GA4 ${propriete} — du ${jourFr(du)} au ${jourFr(au)}`,
    `ENTONNOIR (taux = part des vues de la landing)\n${tableau(["Étape", ...COLONNES], entonnoir.map(enCellules))}`,
  ];

  if (vsl) {
    blocs.push(
      `RÉTENTION VSL (taux = part des lancements)\n${tableau(["Palier", ...COLONNES], vsl.map(enCellules))}`,
    );
  }

  blocs.push(
    `PAR SOURCE / SUPPORT DE SESSION (nombre d'événements)\n${tableau(
      ["Source / support", "Vues LP", "VSL", "Clic réserver", "Calendrier", "Créneau", "Réservé"],
      sources.map((s) => [s.cle, ...ETAPES.map((etape) => s.comptes[etape.evenement] ?? 0)]),
    )}`,
  );

  const notes = [];
  if (du < DEBUT_MESURE) {
    notes.push(
      `Avant le ${jourFr(DEBUT_MESURE)}, GTM n'envoyait pas ces événements à GA4 : les jours précédents sont vides, pas nuls.`,
    );
  }
  if (!vsl) {
    notes.push(
      `Paliers de la VSL indisponibles : la dimension personnalisée video_percent n'existe pas dans la propriété. Seul le total de video_progress est lisible : ${totalProgression}.`,
    );
  }
  if (sansPalier > 0) {
    notes.push(
      `${sansPalier} video_progress sans palier lisible : reçus avant la création de la dimension video_percent, que GA4 ne remplit pas après coup.`,
    );
  }
  notes.push(
    "Personnes = utilisateurs GA4 distincts ; ils ne s'additionnent pas d'une ligne à l'autre. GA4 ne voit que les visiteurs qui le laissent charger (bloqueurs, consentement) : pour le volume de visites, la référence reste Sonde.",
  );

  blocs.push(notes.map((note) => `· ${note}`).join("\n"));
  return blocs.join("\n\n");
}
