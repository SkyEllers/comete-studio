/**
 * La forme imposée aux réponses de Claude (structured outputs), et leur
 * relecture par zod. Module pur.
 *
 * Deux réponses : l'analyse d'un appel, et la synthèse de tous les appels.
 * Pas de champ nullable : une chaîne vide veut dire « pas dit dans l'appel »,
 * comme dans le schéma de l'agent (agent/prompt.ts).
 */

import { z } from "zod";

import { CLES_ALERTES, CLES_MOMENTS, CLES_POINTS, REPERES, type ClePoint, type Repere } from "./grille.ts";

// ------------------------------------------------------------ La fiche

export const TRANCHES_AGE = ["moins_35", "35_44", "45_54", "55_64", "65_plus", "inconnu"] as const;
export const MENOPAUSE = ["oui", "peri", "non", "inconnu"] as const;
export const COUPLE = ["en_couple", "seule", "inconnu"] as const;
export const ENFANTS = ["oui", "non", "inconnu"] as const;
export const DECLENCHEURS = [
  "evenement_familial",
  "sante",
  "medecin",
  "image_de_soi",
  "vetements",
  "ras_le_bol",
  "autre",
  "inconnu",
] as const;
export const ESSAIS = [
  "ww",
  "dukan",
  "jeune",
  "shakes",
  "sport",
  "nutritionniste",
  "medicaments",
  "chirurgie",
  "autre_regime",
] as const;
export const SOUFFRANCES = [
  "fatigue",
  "sucre",
  "grignotage",
  "digestion",
  "sommeil",
  "image_de_soi",
  "sante",
  "douleurs",
  "emotions",
  "menopause",
] as const;
export const FREINS = ["argent", "conjoint", "confiance", "temps", "peur_echec", "deja_essaye", "autre"] as const;
export const DECIDE = ["seule", "avec_conjoint", "inconnu"] as const;
export const SOURCES = ["pub", "instagram", "youtube", "bouche_a_oreille", "autre", "inconnu"] as const;
export const CERTITUDES = ["sure", "a_verifier"] as const;

export const LIBELLES_FICHE: Record<string, string> = {
  moins_35: "moins de 35 ans",
  "35_44": "35-44 ans",
  "45_54": "45-54 ans",
  "55_64": "55-64 ans",
  "65_plus": "65 ans et plus",
  inconnu: "pas dit",
  oui: "oui",
  peri: "périménopause",
  non: "non",
  en_couple: "en couple",
  seule: "seule",
  evenement_familial: "un événement familial",
  sante: "la santé",
  medecin: "son médecin",
  image_de_soi: "l'image de soi",
  vetements: "les vêtements",
  ras_le_bol: "le ras-le-bol",
  autre: "autre",
  ww: "WW",
  dukan: "Dukan",
  jeune: "le jeûne",
  shakes: "les shakes",
  sport: "le sport",
  nutritionniste: "un nutritionniste",
  medicaments: "des médicaments",
  chirurgie: "la chirurgie",
  autre_regime: "un autre régime",
  fatigue: "la fatigue",
  sucre: "le sucre",
  grignotage: "le grignotage",
  digestion: "la digestion",
  sommeil: "le sommeil",
  douleurs: "des douleurs",
  emotions: "les émotions",
  menopause: "la ménopause",
  argent: "l'argent",
  conjoint: "le conjoint",
  confiance: "la confiance",
  temps: "le temps",
  peur_echec: "la peur d'échouer",
  deja_essaye: "« j'ai déjà tout essayé »",
  avec_conjoint: "avec son conjoint",
  pub: "une publicité",
  instagram: "Instagram",
  youtube: "YouTube",
  bouche_a_oreille: "le bouche-à-oreille",
};

const chaine = (description: string) => ({ type: "string", description });
const liste = (items: object, description: string) => ({ type: "array", items, description });
const choix = (valeurs: readonly string[], description: string) => ({ type: "string", enum: [...valeurs], description });

const SCHEMA_FICHE = {
  type: "object",
  additionalProperties: false,
  required: [
    "tranche_age",
    "age",
    "menopause",
    "couple",
    "enfants",
    "metier",
    "declencheur",
    "declencheur_mots",
    "essais",
    "depense",
    "souffrances",
    "veut_retrouver",
    "freins",
    "decide",
    "source",
    "phrases",
  ],
  properties: {
    tranche_age: choix(TRANCHES_AGE, "Sa tranche d'âge, si elle est dite ou dans le questionnaire."),
    age: chaine("Son âge en chiffres (« 52 »), ou vide."),
    menopause: choix(MENOPAUSE, "Ménopausée, en périménopause, non, ou pas dit."),
    couple: choix(COUPLE, "En couple ou seule, si c'est dit."),
    enfants: choix(ENFANTS, "A-t-elle des enfants, si c'est dit."),
    metier: chaine("Son métier ou sa situation (retraitée, infirmière…), ou vide."),
    declencheur: choix(DECLENCHEURS, "Ce qui l'a fait réserver maintenant."),
    declencheur_mots: chaine("Le déclencheur avec ses mots, en une phrase, sans nom propre."),
    essais: liste({ type: "string", enum: [...ESSAIS] }, "Ce qu'elle a déjà essayé."),
    depense: chaine("Ce qu'elle dit avoir dépensé en régimes ou programmes (« 600 € »), ou vide."),
    souffrances: liste({ type: "string", enum: [...SOUFFRANCES] }, "Ce qui la fait le plus souffrir, du plus fort au moins fort."),
    veut_retrouver: chaine("Ce qu'elle veut retrouver, avec ses mots, en une phrase."),
    freins: liste({ type: "string", enum: [...FREINS] }, "Ses freins exprimés ou visibles."),
    decide: choix(DECIDE, "Qui décide : elle seule, avec son conjoint, ou pas dit."),
    source: choix(SOURCES, "Comment elle a connu Peggy."),
    phrases: liste(
      { type: "string" },
      "De 2 à 5 phrases de la cliente, mot pour mot, qui disent ce qu'elle vit ou veut. Sans nom ni prénom.",
    ),
  },
} as const;

const fiche = z.object({
  tranche_age: z.enum(TRANCHES_AGE),
  age: z.string().max(10),
  menopause: z.enum(MENOPAUSE),
  couple: z.enum(COUPLE),
  enfants: z.enum(ENFANTS),
  metier: z.string().max(200),
  declencheur: z.enum(DECLENCHEURS),
  declencheur_mots: z.string().max(600),
  essais: z.array(z.enum(ESSAIS)).max(12),
  depense: z.string().max(100),
  souffrances: z.array(z.enum(SOUFFRANCES)).max(12),
  veut_retrouver: z.string().max(600),
  freins: z.array(z.enum(FREINS)).max(8),
  decide: z.enum(DECIDE),
  source: z.enum(SOURCES),
  phrases: z.array(z.string().max(400)).max(8),
});

export type Fiche = z.infer<typeof fiche>;

// ------------------------------------------------------------ L'analyse d'un appel

const MINUTE = chaine("L'horodatage de la transcription (« 12:05 »), ou vide.");

export const SCHEMA_ANALYSE = {
  type: "object",
  additionalProperties: false,
  required: ["voix_closeuse", "resume", "points", "alertes", "pas_su", "pourquoi", "a_retenir", "passages", "fiche"],
  properties: {
    voix_closeuse: chaine("La voix (A, B…) de celle qui mène le rendez-vous."),
    resume: chaine("Le rendez-vous en deux ou trois phrases, sans nom de famille."),
    points: liste(
      {
        type: "object",
        additionalProperties: false,
        required: ["cle", "repere", "constat", "moments"],
        properties: {
          cle: choix(CLES_POINTS, "Le repère."),
          repere: choix(REPERES, "Acquis, en progrès, à travailler, ou sans objet si l'appel ne permet pas d'en juger."),
          constat: chaine(
            "Ce qu'elle a fait sur ce point, en une ou deux phrases, adressé à elle (« tu »). Et, si ce n'est pas acquis, ce qu'elle peut faire autrement.",
          ),
          moments: liste(
            {
              type: "object",
              additionalProperties: false,
              required: ["minute", "extrait"],
              properties: { minute: MINUTE, extrait: chaine("Ses mots à elle, courts (une ou deux phrases).") },
            },
            "Un ou deux moments de l'appel qui le montrent.",
          ),
        },
      },
      "Les douze repères, chacun une fois, dans l'ordre de la grille.",
    ),
    alertes: liste(
      {
        type: "object",
        additionalProperties: false,
        required: ["cle", "certitude", "minute", "extrait", "explication"],
        properties: {
          cle: choix(CLES_ALERTES, "La règle touchée."),
          certitude: choix(
            CERTITUDES,
            "« sure » : la règle est touchée d'après les informations fournies. « a_verifier » : cela dépend d'un fait que les informations fournies ne disent pas (un délai, un résultat de cliente, une procédure).",
          ),
          minute: MINUTE,
          extrait: chaine("La phrase exacte."),
          explication: chaine("Pourquoi c'est un problème, et ce qu'il fallait dire, en une ou deux phrases."),
        },
      },
      "Chaque fois qu'une règle qu'on ne discute pas est touchée. Liste vide sinon.",
    ),
    pas_su: liste(
      {
        type: "object",
        additionalProperties: false,
        required: ["question", "minute", "reponse_donnee", "bonne_reponse"],
        properties: {
          question: chaine("La question de la cliente, reformulée sans donnée personnelle."),
          minute: MINUTE,
          reponse_donnee: chaine("Ce qu'elle a répondu."),
          bonne_reponse: chaine(
            "La bonne réponse si les informations fournies la donnent, ou « à trancher par Louis ou Peggy ».",
          ),
        },
      },
      "Les questions de la cliente restées sans bonne réponse (elle ne savait pas, a hésité, a dit faux). Liste vide sinon.",
    ),
    pourquoi: {
      type: "object",
      additionalProperties: false,
      required: ["bascule", "minute_bascule", "raison_donnee", "vraie_raison", "aurait_pu_changer"],
      properties: {
        bascule: chaine(
          "Pour une vente : ce qui a fait dire oui. Sinon : ce qui a fait que ce n'était pas oui. Avec le moment de l'appel, deux ou trois phrases.",
        ),
        minute_bascule: MINUTE,
        raison_donnee: chaine("La raison que la cliente donne elle-même (« je dois réfléchir »), ou vide."),
        vraie_raison: chaine("La raison qui se lit dans l'appel, si elle diffère de celle donnée, ou vide."),
        aurait_pu_changer: chaine("Ce qui aurait pu changer l'issue, ou ce qui a fait la vente et qu'il faut refaire."),
      },
    },
    a_retenir: liste(
      { type: "string" },
      "De 2 à 4 phrases pour elle (« tu »), les plus utiles pour son prochain appel. Bienveillantes et précises.",
    ),
    passages: liste(
      {
        type: "object",
        additionalProperties: false,
        required: ["moment", "texte", "pourquoi"],
        properties: {
          moment: choix(CLES_MOMENTS, "Le moment de l'appel."),
          texte: chaine(
            "Ce qu'elle a dit, réécrit pour servir d'exemple à une autre closeuse : sans prénom, sans nom, sans âge ni détail de santé de la cliente. Au besoin, « la cliente ».",
          ),
          pourquoi: chaine("Pourquoi ça marche, en une phrase."),
        },
      },
      "De 0 à 3 passages vraiment réussis, dignes d'être montrés aux autres. Liste vide si aucun ne l'est.",
    ),
    fiche: SCHEMA_FICHE,
  },
} as const;

const minute = z.string().max(12);

const point = z.object({
  cle: z.enum(CLES_POINTS as [ClePoint, ...ClePoint[]]),
  repere: z.enum(REPERES),
  constat: z.string().max(1200),
  moments: z.array(z.object({ minute, extrait: z.string().max(600) })).max(4),
});

export const analyseLue = z.object({
  voix_closeuse: z.string().max(10),
  resume: z.string().max(1200),
  points: z.array(point).max(20),
  alertes: z
    .array(
      z.object({
        cle: z.enum(CLES_ALERTES as [string, ...string[]]),
        // Une analyse rangée avant le 08/10/2026 n'a pas de certitude : elle
        // reste chez Louis, à vérifier, plutôt que d'aller chez la closeuse.
        certitude: z.enum(CERTITUDES).default("a_verifier"),
        minute,
        extrait: z.string().max(600),
        explication: z.string().max(800),
      }),
    )
    .max(20),
  pas_su: z
    .array(
      z.object({
        question: z.string().max(500),
        minute,
        reponse_donnee: z.string().max(600),
        bonne_reponse: z.string().max(800),
      }),
    )
    .max(20),
  pourquoi: z.object({
    bascule: z.string().max(1200),
    minute_bascule: minute,
    raison_donnee: z.string().max(600),
    vraie_raison: z.string().max(600),
    aurait_pu_changer: z.string().max(1000),
  }),
  a_retenir: z.array(z.string().max(500)).max(6),
  passages: z
    .array(
      z.object({
        moment: z.enum(CLES_MOMENTS as [string, ...string[]]),
        texte: z.string().min(1).max(1500),
        pourquoi: z.string().max(600),
      }),
    )
    .max(5),
  fiche,
});

export type AnalyseLue = z.infer<typeof analyseLue>;

/** Ce qui est rangé dans `radar_analyses.analyse` : tout sauf la fiche et les passages. */
export type AnalyseRangee = Omit<AnalyseLue, "fiche" | "passages">;

/**
 * Les douze repères, chacun une fois et dans l'ordre de la grille : un repère
 * oublié par l'IA devient « sans objet », un doublon est écarté.
 */
export function pointsComplets(points: AnalyseLue["points"]): AnalyseLue["points"] {
  return CLES_POINTS.map(
    (cle) => points.find((p) => p.cle === cle) ?? { cle, repere: "sans_objet" as Repere, constat: "", moments: [] },
  );
}

export function versRangee(a: AnalyseLue): AnalyseRangee {
  return {
    voix_closeuse: a.voix_closeuse,
    resume: a.resume,
    points: pointsComplets(a.points),
    alertes: a.alertes,
    pas_su: a.pas_su,
    pourquoi: a.pourquoi,
    a_retenir: a.a_retenir,
  };
}

/** Relit une analyse rangée en base ; null si elle ne tient plus au schéma. */
export function lireRangee(valeur: unknown): AnalyseRangee | null {
  const lu = analyseLue.omit({ fiche: true, passages: true }).safeParse(valeur);
  return lu.success ? { ...lu.data, points: pointsComplets(lu.data.points) } : null;
}

// ------------------------------------------------------------ Les alertes à vérifier

export type Alerte = AnalyseRangee["alertes"][number];

/**
 * L'étiquette qui relie une alerte « à vérifier » à la décision de Louis
 * (rangée dans la `note` de la leçon de correction) : une alerte tranchée
 * sort de sa liste.
 */
export function etiquetteAlerte(a: Pick<Alerte, "minute" | "cle">): string {
  return `alerte ${a.minute || "?"} ${a.cle}`;
}

/** Les alertes que voit la closeuse : les sûres seulement (Louis, 08/10/2026). */
export function alertesSures(alertes: Alerte[]): Alerte[] {
  return alertes.filter((a) => a.certitude === "sure");
}

/** Les alertes que Louis doit trancher : à vérifier, et pas encore tranchées. */
export function alertesATrancher(alertes: Alerte[], tranchees: ReadonlySet<string>): Alerte[] {
  return alertes.filter((a) => a.certitude === "a_verifier" && !tranchees.has(etiquetteAlerte(a)));
}

export function lireFiche(valeur: unknown): Fiche | null {
  const lu = fiche.safeParse(valeur);
  return lu.success ? lu.data : null;
}

// ------------------------------------------------------------ La synthèse

const POINTS_ET_GENERAL = [...CLES_POINTS, "general"];

export const SCHEMA_SYNTHESE = {
  type: "object",
  additionalProperties: false,
  required: ["lecons_nouvelles", "lecons_renforcees", "lecons_a_retirer", "portrait", "recrutement", "equipe"],
  properties: {
    lecons_nouvelles: liste(
      {
        type: "object",
        additionalProperties: false,
        required: ["texte", "point", "sens", "appuis"],
        properties: {
          texte: chaine(
            "La leçon, en une ou deux phrases concrètes, utilisable dans un prochain appel. Sans nom de cliente ni de closeuse.",
          ),
          point: choix(POINTS_ET_GENERAL, "Le repère qu'elle concerne, ou « general »."),
          sens: choix(["vend", "perd", "conseil"], "Ce qui fait vendre, ce qui fait perdre, ou une consigne de lecture."),
          appuis: liste({ type: "string" }, "Les codes des appels (« R12 ») qui la montrent, tous ceux qui la montrent."),
        },
      },
      "Les leçons nouvelles, qui ne redisent pas une leçon déjà au carnet.",
    ),
    lecons_renforcees: liste(
      {
        type: "object",
        additionalProperties: false,
        required: ["id", "appuis"],
        properties: {
          id: chaine("L'identifiant de la leçon du carnet."),
          appuis: liste({ type: "string" }, "Tous les codes d'appels qui la montrent, anciens et nouveaux."),
        },
      },
      "Les leçons déjà au carnet que les appels confirment.",
    ),
    lecons_a_retirer: liste(
      {
        type: "object",
        additionalProperties: false,
        required: ["id", "raison"],
        properties: { id: chaine("L'identifiant de la leçon."), raison: chaine("Pourquoi les appels la contredisent.") },
      },
      "Les leçons du carnet que les appels contredisent nettement. Liste vide le plus souvent.",
    ),
    portrait: {
      type: "object",
      additionalProperties: false,
      required: ["qui_achete", "qui_n_achete_pas", "mots", "questionnaire", "a_creuser"],
      properties: {
        qui_achete: chaine("Qui achète : âge, situation, déclencheur, essais, ce qui la décide. Avec le nombre d'appels."),
        qui_n_achete_pas: chaine("Qui n'achète pas, et pourquoi, de la même façon."),
        mots: liste({ type: "string" }, "De 5 à 15 phrases de clientes qui reviennent, mot pour mot, utiles pour les pubs et les pages."),
        questionnaire: chaine(
          "Ce que les réponses au questionnaire de réservation disent vraiment (budget coché, façon de changer), comparé à l'issue.",
        ),
        a_creuser: chaine("Ce qu'il faudrait savoir et que les appels ne disent pas encore."),
      },
    },
    recrutement: liste(
      { type: "string" },
      "Ce qu'il faut regarder chez une future closeuse, d'après ce qui distingue les appels qui vendent.",
    ),
    equipe: chaine("Pour Louis : où en est l'équipe, ce qui progresse, ce qui bloque, en quelques phrases, avec les prénoms des closeuses."),
  },
} as const;

export const syntheseLue = z.object({
  lecons_nouvelles: z
    .array(
      z.object({
        texte: z.string().min(1).max(1000),
        point: z.string().max(40),
        sens: z.enum(["vend", "perd", "conseil"]),
        appuis: z.array(z.string().max(12)).max(500),
      }),
    )
    .max(30),
  lecons_renforcees: z.array(z.object({ id: z.string().max(40), appuis: z.array(z.string().max(12)).max(500) })).max(100),
  lecons_a_retirer: z.array(z.object({ id: z.string().max(40), raison: z.string().max(600) })).max(30),
  portrait: z.object({
    qui_achete: z.string().max(3000),
    qui_n_achete_pas: z.string().max(3000),
    mots: z.array(z.string().max(400)).max(30),
    questionnaire: z.string().max(3000),
    a_creuser: z.string().max(2000),
  }),
  recrutement: z.array(z.string().max(600)).max(15),
  equipe: z.string().max(3000),
});

export type SyntheseLue = z.infer<typeof syntheseLue>;

/** Ce que la base garde d'une synthèse : tout sauf les mouvements du carnet, déjà appliqués. */
export type SyntheseRangee = Pick<SyntheseLue, "portrait" | "recrutement" | "equipe">;

export function lireSynthese(valeur: unknown): SyntheseRangee | null {
  const lu = syntheseLue.pick({ portrait: true, recrutement: true, equipe: true }).safeParse(valeur);
  return lu.success ? lu.data : null;
}
