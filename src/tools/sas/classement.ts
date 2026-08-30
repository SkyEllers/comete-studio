import { z } from "zod";

import {
  LIMITE_IDEE,
  LIMITE_NOM_BOITE,
  type Boite,
  type Destination,
  type IdeeProposee,
} from "./types.ts";

/**
 * Ce qu'on accepte de l'IA, et ce qu'on en fait.
 *
 * Toute la défiance de l'outil vit ici. La réponse du modèle n'est pas une
 * source de vérité : c'est une proposition, qui traverse un schéma, puis une
 * réconciliation avec la réalité de la base, avant d'aller préremplir un
 * écran que Louis valide. Rien de ce fichier n'écrit quoi que ce soit.
 *
 * Trois règles décident du sort d'une réponse :
 *
 * 1. Une boîte que le modèle nomme mais qui n'existe pas devient une
 *    proposition de nouvelle boîte. Il ne peut pas ranger dans un tiroir qui
 *    n'est pas là, et se tromper de tiroir serait pire que de demander.
 * 2. Une idée « perso » perd toute boîte, quoi qu'ait répondu le modèle. La
 *    base refuserait la ligne de toute façon ; autant ne pas la proposer.
 * 3. Une réponse qui rallonge nettement le texte d'origine est rejetée en
 *    bloc : le modèle a reformulé ou inventé, et on repart en manuel plutôt
 *    que de faire relire à Louis des idées qu'il n'a pas écrites.
 */

/**
 * Le schéma de la réponse. Les champs qu'on lit sont contraints ; ceux qu'on
 * ne connaît pas sont ignorés plutôt que rejetés — un champ de plus un jour
 * ferait perdre le classement de la journée pour rien, alors que rien de ce
 * qui passe ici n'atteint la base sans validation humaine.
 */
const nomBoite = z.string().trim().min(1).max(LIMITE_NOM_BOITE);

export const reponseSchema = z.object({
  idees: z
    .array(
      z.object({
        texte: z.string().min(1),
        univers: z.enum(["pro", "perso"]),
        boite: nomBoite.nullish(),
        nouvelle_boite: nomBoite.nullish(),
        certitude: z.enum(["haute", "basse"]),
      }),
    )
    .min(1)
    .max(200),
});

export type ReponseIA = z.infer<typeof reponseSchema>;

/**
 * Marge tolérée entre le texte tapé et la somme des idées rendues.
 *
 * Un vrai découpage raccourcit (il jette les sauts de ligne et les tirets) ou
 * laisse égal. Au-delà de la moitié en plus, le modèle a écrit à la place de
 * Louis : c'est le signe d'une réponse à jeter, pas d'une idée à corriger.
 */
const EXPANSION_MAX = 1.5;
const MARGE_FIXE = 50;

/** Comparaison de noms de boîtes : la casse et les accents ne comptent pas. */
export function cleNom(nom: string): string {
  return nom
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** La boîte de ce nom, ou `null` — comparaison souple, pas une recherche. */
export function trouverBoite(nom: string, boites: Boite[]): Boite | null {
  const cible = cleNom(nom);
  return boites.find((boite) => cleNom(boite.name) === cible) ?? null;
}

/**
 * La réponse du modèle, confrontée aux boîtes réelles.
 *
 * Renvoie `null` quand la réponse est inexploitable : à l'appelant de
 * basculer en mode manuel. Ne lève jamais.
 */
export function reconcilier(
  brut: unknown,
  boites: Boite[],
  texteSource: string,
): IdeeProposee[] | null {
  const parsed = reponseSchema.safeParse(brut);
  if (!parsed.success) return null;

  const idees: IdeeProposee[] = [];

  for (const [index, entree] of parsed.data.idees.entries()) {
    const texte = entree.texte.trim().slice(0, LIMITE_IDEE);
    if (texte.length === 0) continue;

    let destination: Destination;
    let incertain = entree.certitude === "basse";

    if (entree.univers === "perso") {
      // Règle 2 : une perso n'a pas de boîte, même si le modèle en propose une.
      destination = { type: "perso" };
    } else {
      const existante = entree.boite ? trouverBoite(entree.boite, boites) : null;

      if (existante) {
        destination = { type: "boite", boiteId: existante.id };
      } else {
        // Règle 1 : une boîte nommée mais absente redevient une proposition.
        const propose = entree.boite ?? entree.nouvelle_boite ?? null;
        const dejaLa = propose ? trouverBoite(propose, boites) : null;

        if (dejaLa) {
          destination = { type: "boite", boiteId: dejaLa.id };
        } else if (propose) {
          destination = { type: "nouvelle", nom: propose };
          incertain = true;
        } else {
          destination = { type: "aranger" };
        }
      }
    }

    idees.push({ cle: `ia-${index}`, texte, destination, incertain });
  }

  if (idees.length === 0) return null;

  // Règle 3 : le modèle a-t-il écrit à la place de Louis ?
  const rendu = idees.reduce((total, idee) => total + idee.texte.length, 0);
  if (rendu > texteSource.trim().length * EXPANSION_MAX + MARGE_FIXE) return null;

  return idees;
}
