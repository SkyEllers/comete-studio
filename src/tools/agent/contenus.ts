import type { Contenu } from "./profil.ts";

/**
 * Le contenu envoyé entre deux rappels (rythme du 27/09/2026) : celui du
 * catalogue qui parle le plus de ce qu'elle a écrit dans le formulaire, et
 * jamais deux fois le même. Sans IA : des mots en commun, comptés. Un
 * catalogue épuisé rend `null`.
 */

const MOTS_VIDES = new Set(
  "alors aussi avec avant avoir cela celle cette comme dans depuis donc elle elles encore être fait faire fois leur mais même moins peux plus pour quand quel quelle sans sont suis tout tous très trop une vous votre avec quoi déjà rien".split(
    " ",
  ),
);

function mots(texte: string): Set<string> {
  return new Set(
    texte
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z]+/)
      .filter((m) => m.length >= 4 && !MOTS_VIDES.has(m))
      // Une racine grossière : « régimes », « régime » se rejoignent.
      .map((m) => m.slice(0, 6)),
  );
}

export function choisirContenu(
  catalogue: Contenu[],
  reponses: { answer: string }[],
  dejaEnvoyes: Set<string>,
): Contenu | null {
  const siens = mots(reponses.map((r) => r.answer).join(" "));
  let meilleur: Contenu | null = null;
  let score = -1;
  for (const c of catalogue) {
    if (dejaEnvoyes.has(c.url)) continue;
    const communs = [...mots(`${c.titre} ${c.theme} ${c.resume}`)].filter((m) => siens.has(m)).length;
    if (communs > score) {
      meilleur = c;
      score = communs;
    }
  }
  return meilleur;
}

/** Les contenus déjà partis, retrouvés par leur adresse dans les messages envoyés. */
export function contenusDeja(catalogue: Contenu[], textesEnvoyes: string[]): Set<string> {
  const tout = textesEnvoyes.join("\n");
  return new Set(catalogue.filter((c) => tout.includes(c.url)).map((c) => c.url));
}
