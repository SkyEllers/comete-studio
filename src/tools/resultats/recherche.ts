/**
 * Ce qu'on accepte de chercher.
 *
 * La recherche par nom est la raison d'être du nom : sans elle, on aurait fait
 * entrer une donnée nominative en base pour décorer une liste. Mais elle est
 * aussi le seul endroit du hub où du texte tapé par un client se retrouve dans
 * la grammaire de filtre de PostgREST, via un `or=(…ilike…)`.
 *
 * Cette grammaire a des caractères qui comptent : la virgule sépare deux
 * conditions, les parenthèses ouvrent un groupe, le point sépare la colonne de
 * l'opérateur. Un terme qui en contient ne peut ni sortir de l'organisation
 * — le `eq` sur `organization_id` et la RLS sont ailleurs dans la requête —
 * ni lire la clientèle du voisin, mais il ferait au mieux une erreur, au pire
 * une condition qu'on n'a pas écrite. Et `%` comme `_` sont les jokers de
 * `like` : les laisser passer, c'est offrir « tout afficher » à qui tape `%`.
 *
 * D'où une liste blanche plutôt qu'une liste d'échappements. On sait à quoi
 * ressemble un nom — des lettres, des espaces, des traits d'union, des
 * apostrophes, parfois un point d'abréviation — et on ne saura jamais énumérer
 * ce qu'on refuse. C'est la même règle que pour les `utm_*` de Calendly.
 */

/** Au-delà, ce n'est plus un nom : c'est quelqu'un qui essaie quelque chose. */
const LONGUEUR_MAX = 60;

/**
 * Le terme retenu, ou `null` s'il ne reste rien de cherchable.
 *
 * `null` plutôt qu'une chaîne vide : l'appelant doit décider entre « chercher »
 * et « tout afficher », et un `if (terme)` sur une chaîne vide se lit mal.
 */
export function nettoyerRecherche(brut: string | null | undefined): string | null {
  if (typeof brut !== "string") return null;

  const propre = brut
    .normalize("NFC")
    // Les lettres de toutes les écritures, les chiffres, et la ponctuation
    // qu'un nom porte vraiment. Le reste tombe.
    .replace(/[^\p{L}\p{N} '’.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LONGUEUR_MAX)
    .trim();

  return propre.length > 0 ? propre : null;
}
