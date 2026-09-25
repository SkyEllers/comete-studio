import { z } from "zod";

import type { Profil } from "./profil.ts";
import { heureEnMots, jourEnMots } from "./temps.ts";

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
};

/** Le bloc qui change à chaque appel : jamais mis en cache. */
export function contexteDuMoment(
  c: EtatConversation,
  maintenant: number,
  tarifs: string | null,
): string {
  const formulaire = c.reponses.map((r) => `- ${r.question}\n  ${r.answer || "(vide)"}`).join("\n");
  return `# Aujourd'hui

Nous sommes ${jourEnMots(maintenant, c.fuseau)}, il est ${heureEnMots(maintenant, c.fuseau)} pour elle.

# Elle et son rendez-vous

- Prénom : ${c.prenom}
- Diagnostic : ${jourEnMots(c.rdv_debut, c.fuseau)} à ${heureEnMots(c.rdv_debut, c.fuseau)}, sur Zoom, 45 minutes
- A confirmé sa venue : ${c.confirme_le ? "oui" : "pas encore"}
- Façon de décider : ${c.facon_de_decider ? FACONS_EN_MOTS[c.facon_de_decider] : "inconnue"}
- Rendez-vous déjà déplacés par toi : ${c.reports_agent}
- Un article déjà proposé : ${c.contenu_propose_le ? "oui" : "non"}

# Ses réponses au formulaire de réservation

${formulaire || "(aucune)"}

# La page Tarifs, lue à l'instant

${tarifs ?? "(page illisible pour l'instant : ne donne aucun prix, dis que tu vérifies)"}`;
}

export type LigneFil = { sens: string; genre: string; modele: string | null; texte: string; created_at: string };

/** Le fil, du plus ancien au plus récent, tel que l'IA le lit. */
export function transcrire(fil: LigneFil[], fuseau: string): string {
  const lignes = fil.map((m) => {
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
