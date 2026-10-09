import { z } from "zod";

import { creneauEnMots } from "./creneaux.ts";
import type { Profil } from "./profil.ts";
import { heureDuRdv, heureEnMots, jourEnMots } from "./temps.ts";

/**
 * Ce que l'IA reçoit, et ce qu'elle doit rendre.
 *
 * Deux blocs de consignes. Le premier ne bouge presque jamais (la voix, les
 * règles, le catalogue, les réponses décidées par Louis) : il est mis en
 * cache et coûte dix fois moins à la relecture. Le second change à chaque
 * appel (l'heure, l'état du rendez-vous, la page Tarifs) : il vient après,
 * pour ne pas casser le cache.
 *
 * La conversation part en un seul message, transcrite ligne par ligne : c'est
 * une décision à prendre sur un fil, pas un dialogue à continuer.
 */

export const FACONS_EN_MOTS: Record<string, string> = {
  fonce: "elle fonce",
  analyse: "elle analyse tout avant",
  pas_a_pas: "elle avance pas à pas",
  accompagnee: "elle a besoin d'être accompagnée",
};

/**
 * Pourquoi elle annule, rangé (0048). La catégorie reste dans les bilans
 * après l'effacement de la conversation ; ses mots, eux, partent avec elle.
 */
export const CATEGORIES_ANNULATION = [
  "empechement",
  "pas_le_moment",
  "budget",
  "plus_interessee",
  "ailleurs",
  "autre",
] as const;
export type CategorieAnnulation = (typeof CATEGORIES_ANNULATION)[number];

/** Le libellé de chaque catégorie, tel que Radar l'affiche. */
export const LIBELLES_ANNULATION: Record<CategorieAnnulation, string> = {
  empechement: "un empêchement",
  pas_le_moment: "pas le bon moment",
  budget: "le budget",
  plus_interessee: "plus intéressée",
  ailleurs: "une autre solution",
  autre: "autre raison",
};

/**
 * Les boutons-liens qu'un message libre peut porter (Louis, 28/09/2026) : le
 * lien part sous le message, jamais l'adresse dans le texte. 20 caractères au
 * plus (Meta).
 */
export const BOUTONS = {
  changer: "Changer mon créneau",
  reprendre: "Choisir un créneau",
} as const;
export type Bouton = keyof typeof BOUTONS;

/**
 * Le message tel qu'il part : le bouton demandé par l'IA, avec son lien, et
 * le texte sans l'adresse si elle l'a écrite quand même. Sans lien connu, pas
 * de bouton (la consigne dit « sur » à false quand le lien manque).
 */
export function messageAvecBouton(
  texte: string,
  bouton: "" | Bouton,
  liens: { changer: string | null; reprendre: string | null },
): { texte: string; lien?: { texte: string; url: string } } {
  const url = bouton ? liens[bouton] : null;
  if (!bouton || !url) return { texte };
  const sans = texte
    .split(url)
    .join("")
    .replace(/[ \t]*:[ \t]*(\n|$)/g, ".$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { texte: sans, lien: { texte: BOUTONS[bouton], url } };
}

/**
 * Sa réponse lui promet le silence (« je te laisse tranquille », « je ne
 * t'écris plus », « je te redonne signe juste avant ») : la consigne 20 le
 * lui interdit, mais si ça passe quand même, le système tient au moins ce
 * qu'il peut tenir et coupe les articles. 07/10/2026 : Coralie avait reçu
 * cette promesse, et l'article planifié était parti le 09/10.
 */
export function prometLeSilence(texte: string): boolean {
  const t = texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'");
  return /\blaiss\w* (?:\w+ )?tranquille|\bne t'ecri\w* plus|\bne plus t'ecrire|\bredonne\w* signe|\bme fais discret/.test(t);
}

/** La forme imposée à la réponse de l'IA (structured outputs). */
export const SCHEMA_DECISION = {
  type: "object",
  additionalProperties: false,
  required: [
    "reponse",
    "sur",
    "question_pour_louis",
    "confirme",
    "veut_changer",
    "detresse",
    "contenu_propose",
    "contenu_envoye",
    "note_pour_peggy",
    "creneaux_proposes",
    "creneau_choisi",
    "veut_annuler",
    "annulation_confirmee",
    "raison_annulation",
    "raison_categorie",
    "bouton",
    "arret",
  ],
  properties: {
    reponse: { type: "string", description: "Le message exact à lui envoyer, ou une chaîne vide." },
    sur: { type: "boolean", description: "Faux dès que les consignes ne tranchent pas clairement." },
    question_pour_louis: { type: "string", description: "Ce que Louis doit trancher, ou vide." },
    confirme: { type: "boolean", description: "Elle confirme qu'elle viendra." },
    veut_changer: { type: "boolean", description: "Elle a un empêchement ou veut un autre créneau." },
    detresse: { type: "boolean", description: "Idées noires, détresse." },
    contenu_propose: { type: "string", description: "Adresse de l'article proposé dans ce message, ou vide." },
    contenu_envoye: { type: "string", description: "Adresse de l'article envoyé dans ce message, ou vide." },
    note_pour_peggy: {
      type: "string",
      description: "Ce qui doit figurer dans le résumé du matin (santé, prix, ce qu'elle veut avoir compris), ou vide.",
    },
    creneaux_proposes: {
      type: "array",
      items: { type: "string" },
      description: "Les valeurs exactes (entre parenthèses) des créneaux proposés dans ce message, ou une liste vide.",
    },
    creneau_choisi: {
      type: "string",
      description: "La valeur exacte du créneau qu'elle vient de choisir parmi ceux proposés, ou vide.",
    },
    veut_annuler: { type: "boolean", description: "Elle demande à annuler son rendez-vous." },
    annulation_confirmee: {
      type: "boolean",
      description: "Tu lui as proposé de décaler et elle maintient qu'elle veut annuler.",
    },
    raison_annulation: {
      type: "string",
      description: "Pourquoi elle annule, avec ses mots, en une phrase courte, ou vide.",
    },
    raison_categorie: {
      type: "string",
      enum: ["", ...CATEGORIES_ANNULATION],
      description: "La raison rangée, ou vide si elle n'en a pas donné.",
    },
    bouton: {
      type: "string",
      enum: ["", "changer", "reprendre"],
      description: "Le bouton-lien à mettre sous ce message, ou vide.",
    },
    arret: {
      type: "string",
      enum: ["", "articles", "tout"],
      description:
        "« tout » si elle demande clairement à ne plus recevoir aucun message ; « articles » si elle ne veut plus d'articles, ou se plaint de recevoir trop de messages ; vide sinon.",
    },
  },
} as const;

export const decision = z.object({
  reponse: z.string().max(1500),
  sur: z.boolean(),
  question_pour_louis: z.string().max(1000),
  confirme: z.boolean(),
  veut_changer: z.boolean(),
  detresse: z.boolean(),
  contenu_propose: z.string().max(300),
  contenu_envoye: z.string().max(300),
  note_pour_peggy: z.string().max(1000),
  creneaux_proposes: z.array(z.string().max(40)).max(6),
  creneau_choisi: z.string().max(40),
  veut_annuler: z.boolean(),
  annulation_confirmee: z.boolean(),
  raison_annulation: z.string().max(500),
  raison_categorie: z.enum(["", ...CATEGORIES_ANNULATION]),
  bouton: z.enum(["", "changer", "reprendre"]),
  arret: z.enum(["", "articles", "tout"]),
});
export type Decision = z.infer<typeof decision>;

export type ReponseFixe = { question: string; reponse: string };

/** Le bloc stable : mis en cache. */
export function consignesStables(profil: Profil, fixes: ReponseFixe[]): string {
  const catalogue = profil.catalogue
    .map((c) => `- ${c.titre} (${c.theme}) : ${c.url}\n  ${c.resume}`)
    .join("\n");
  const decidees =
    fixes.length === 0
      ? "Aucune pour l'instant."
      : fixes.map((f) => `- Question : ${f.question}\n  Réponse : ${f.reponse}`).join("\n");

  return `${profil.consignes}

# Le catalogue (les seuls contenus que tu peux proposer)

${catalogue}

# Les réponses que Louis a déjà tranchées

Quand la question y ressemble, reprends le fond de la réponse, dans ta voix, et tu es sûre.

${decidees}`;
}

export type EtatConversation = {
  prenom: string;
  rdv_debut: string;
  fuseau: string;
  confirme_le: string | null;
  facon_de_decider: string | null;
  reports_agent: number;
  contenu_propose_le: string | null;
  reponses: { question: string; answer: string }[];
  report_demande_le: string | null;
  creneaux_proposes: string[];
  lien_report: string | null;
  annulation_demandee_le?: string | null;
  annulee_par_agent_le?: string | null;
  raison_annulation?: string | null;
  /** La page pour reprendre un rendez-vous plus tard (profil). */
  lien_reservation?: string | null;
  /** Elle a touché « Ne plus recevoir » : plus d'articles. */
  sans_contenus?: boolean;
};

/** Ce que le système a lu dans Calendly pour un report en cours. */
export type CreneauxDuMoment = { memeJour: string[]; plusProches: string[] } | "illisibles" | null;

/** Le bloc qui change à chaque appel : jamais mis en cache. */
export function contexteDuMoment(
  c: EtatConversation,
  maintenant: number,
  tarifs: string | null,
  creneaux: CreneauxDuMoment = null,
): string {
  const formulaire = c.reponses.map((r) => `- ${r.question}\n  ${r.answer || "(vide)"}`).join("\n");
  return `# Aujourd'hui

Nous sommes ${jourEnMots(maintenant, c.fuseau)}, il est ${heureEnMots(maintenant, c.fuseau)} pour elle.

# Elle et son rendez-vous

- Prénom : ${c.prenom}
- Diagnostic : ${jourEnMots(c.rdv_debut, c.fuseau)} à ${heureDuRdv(c.rdv_debut, c.fuseau)}, sur Zoom, 45 minutes
- Son fuseau (celui de son téléphone quand elle a réservé, pas forcément celui où elle sera) : ${c.fuseau}. Quand tu lui donnes l'heure du rendez-vous et que ce fuseau n'est pas celui de Paris, donne les deux heures, comme ci-dessus.
- A confirmé sa venue : ${c.confirme_le ? "oui" : "pas encore"}
- Façon de décider : ${c.facon_de_decider ? FACONS_EN_MOTS[c.facon_de_decider] : "inconnue"}
- Rendez-vous déjà déplacés par toi : ${c.reports_agent}
- Un article déjà proposé : ${c.contenu_propose_le ? "oui" : "non"}${c.sans_contenus ? "\n- Elle a demandé à ne plus recevoir d'articles : n'en propose aucun, et n'envoie aucun lien d'article." : ""}

# Ses réponses au formulaire de réservation

${formulaire || "(aucune)"}

# La page Tarifs, lue à l'instant

${tarifs ?? "(page illisible pour l'instant : ne donne aucun prix, dis que tu vérifies)"}${sectionAnnulation(c) || sectionReport(c, creneaux)}`;
}

/**
 * Elle veut annuler (Louis, 28/09/2026) : d'abord lui proposer de décaler ;
 * si elle maintient, le système annule et elle dit pourquoi, si elle veut.
 */
function sectionAnnulation(c: EtatConversation): string {
  if (c.annulee_par_agent_le) {
    const reprendre = c.lien_reservation
      ? `Si elle veut reprendre un rendez-vous plus tard, mets "bouton" à "reprendre" : un bouton « ${BOUTONS.reprendre} » part sous ton message, avec le lien de la page de réservation. N'écris jamais l'adresse.`
      : "Si elle veut reprendre un rendez-vous plus tard, dis-lui qu'elle peut le faire depuis le site de Peggy.";
    return `

# Son rendez-vous est annulé

Tu l'as annulé à sa demande. Ne propose aucun créneau, ne relance pas.
${
  c.raison_annulation
    ? "Elle t'a déjà dit pourquoi : ne redemande rien. Réponds simplement à son message."
    : `Tu lui as demandé pourquoi. Si elle répond, remercie-la en une ligne, sans insister ni discuter sa raison ; mets ses mots dans "raison_annulation" (une phrase courte) et range-les dans "raison_categorie" :
- empechement : un imprévu, son travail, sa santé, un voyage, un souci d'organisation ;
- pas_le_moment : pas prête, pas maintenant, plus tard ;
- budget : l'argent, le prix, ses moyens ;
- plus_interessee : elle a changé d'avis, ça ne l'intéresse plus ;
- ailleurs : elle a trouvé une autre solution, ou elle est déjà suivie ;
- autre : tout le reste.
Si elle ne veut pas le dire, c'est très bien : laisse ces deux champs vides. Ne lui dis jamais que sa réponse « reste entre vous » : l'équipe la lit.`
}
${reprendre}`;
  }

  if (c.annulation_demandee_le && !c.report_demande_le && c.creneaux_proposes.length === 0) {
    return `

# Elle veut annuler

Tu lui as proposé de décaler son rendez-vous plutôt que de l'annuler.
- Si elle préfère décaler : mets "veut_changer" à true, et suis la règle des changements de créneau.
- Si elle maintient qu'elle veut annuler : mets "annulation_confirmee" à true. Le système annule le rendez-vous au moment où ton message part. Dis-lui que c'est annulé, puis demande-lui en une question, avec douceur, ce qui l'a décidée (elle peut ne pas répondre). Ne lui dis jamais que sa réponse « reste entre vous » : l'équipe la lit. Si elle a déjà donné sa raison dans ce message, remplis "raison_annulation" et "raison_categorie" et ne redemande rien.`;
  }

  return "";
}

function sectionReport(c: EtatConversation, creneaux: CreneauxDuMoment): string {
  const liste = (valeurs: string[]) =>
    valeurs.length === 0 ? "(aucun)" : valeurs.map((v) => `- ${creneauEnMots(v, c.fuseau)}`).join("\n");

  if (c.reports_agent >= 1) {
    return `

# Changer de créneau

Tu as déjà déplacé son rendez-vous une fois. Si elle doit encore changer, ne propose aucun créneau : dis-lui qu'elle peut choisir elle-même un autre moment quand elle sera prête, laisse "creneaux_proposes" et "creneau_choisi" vides, et ${c.lien_report ? `mets "bouton" à "changer" : un bouton « ${BOUTONS.changer} » part sous ton message, avec son lien. N'écris jamais l'adresse.` : "(son lien est introuvable : mets \"sur\" à false)"}`;
  }

  if (c.creneaux_proposes.length > 0) {
    return `

# Changer de créneau

Tu lui as proposé ces créneaux :
${liste(c.creneaux_proposes)}
Si elle en choisit un, recopie sa valeur exacte (entre parenthèses) dans "creneau_choisi" et dis-lui que tu le réserves. Si aucun ne lui va, dis-lui qu'elle peut choisir elle-même un autre moment dans l'agenda (son rendez-vous actuel tient tant qu'elle n'en a pas choisi un autre), laisse "creneau_choisi" vide, et ${c.lien_report ? `mets "bouton" à "changer" : un bouton « ${BOUTONS.changer} » part sous ton message, avec son lien. N'écris jamais l'adresse.` : "(son lien est introuvable : mets \"sur\" à false)"}`;
  }

  if (!c.report_demande_le) return "";

  if (creneaux === "illisibles" || creneaux === null) {
    return `

# Changer de créneau

Elle doit changer, mais l'agenda est illisible pour l'instant : ne propose rien, dis que tu regardes et mets "sur" à false.`;
  }

  return `

# Changer de créneau

Elle doit changer de créneau. Voici ce qui est libre, lu à l'instant dans l'agenda :

Le même jour que son rendez-vous :
${liste(creneaux.memeJour)}

Les plus proches :
${liste(creneaux.plusProches)}

Si elle garde sa journée, propose ceux du même jour ; sinon, ou s'il n'y en a pas, les plus proches. Trois au plus, en mots (jour et heure), jamais un créneau qui n'est pas dans ces listes. Recopie leurs valeurs exactes (entre parenthèses) dans "creneaux_proposes". Si rien n'est libre, dis-le et mets "sur" à false.`;
}

export type LigneFil = {
  sens: string;
  genre: string;
  modele: string | null;
  texte: string;
  created_at: string;
  statut?: string | null;
};

/**
 * Le fil, du plus ancien au plus récent, tel que l'IA le lit. Ce qui n'est
 * pas parti (refusé par WhatsApp, ou rien envoyé exprès) n'y est pas : elle
 * ne l'a jamais reçu.
 */
export function transcrire(fil: LigneFil[], fuseau: string): string {
  const lignes = fil.filter((m) => !(m.sens === "sortant" && m.statut === "echec")).map((m) => {
    const quand = `${jourEnMots(m.created_at, fuseau)} ${heureEnMots(m.created_at, fuseau)}`;
    const qui =
      m.sens === "sortant"
        ? m.genre === "modele"
          ? `Toi (message automatique « ${m.modele} »)`
          : "Toi"
        : "Elle";
    return `[${quand}] ${qui} : ${m.texte}`;
  });
  return `Voici toute la conversation WhatsApp. Son dernier message attend ta réponse.

${lignes.join("\n\n")}`;
}

/**
 * Le texte utile d'une page HTML : sans scripts, styles ni balises, espaces
 * resserrés. Assez pour qu'un prix se lise, jamais de quoi exécuter quoi
 * que ce soit.
 */
export function texteDePage(html: string, limite = 12000): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div|section|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&euro;/g, "€")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, limite);
}
