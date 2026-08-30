import "server-only";

import { LIMITE_NOM_BOITE, type Boite } from "./types.ts";

/**
 * Le seul endroit du dépôt qui parle à une IA.
 *
 * `fetch` natif, sans SDK : un appel, trois en-têtes, un corps JSON. Le paquet
 * officiel apporterait un client, des types et une surface de dépendance pour
 * une requête qu'on écrit en vingt lignes — et celle-ci porte une clé qui ne
 * doit jamais quitter le serveur. `import 'server-only'` en tête : si ce
 * module se retrouvait un jour dans un bundle client, la compilation casse
 * avant la mise en ligne, pas après.
 *
 * Ce qui sort d'ici : le texte que Louis vient de taper, et les noms de ses
 * boîtes. Rien d'autre du hub — pas d'identifiant, pas d'organisation, pas de
 * client, pas de rendez-vous. Ce qui rentre : du texte, qui n'est cru par
 * personne avant d'être passé au crible de `reconcilier`.
 *
 * La fonction ne lève jamais et ne journalise jamais le contenu : une panne
 * rend `null`, et l'appelant bascule en classement manuel.
 */

/** Le plus récent des Haiku : c'est du tri de texte court, pas du raisonnement. */
const MODELE = "claude-haiku-4-5";

/**
 * Quinze secondes, et on passe à la main.
 *
 * Ce n'est pas la patience de l'API qu'on mesure, c'est celle de quelqu'un
 * debout dans la rue avec son téléphone. Au-delà, ranger soi-même est plus
 * rapide qu'attendre.
 */
const DELAI_MS = 15_000;

const SYSTEME = `Tu ranges des notes jetées en vrac dans un vide-tête. Tu ne réponds qu'en JSON.

Découpe le texte en idées distinctes.
- Un saut de ligne sépare toujours deux idées.
- « et », « + », « / » ne séparent que si les deux morceaux sont manifestement deux idées différentes. Dans le doute, ne coupe pas.
- Recopie chaque idée telle quelle : pas de reformulation, pas de correction d'orthographe, pas de ponctuation ajoutée. Tu ne réécris rien.
- N'invente aucune idée absente du texte, et n'en oublie aucune.

Pour chaque idée :
- « univers » : « pro » si ça touche au travail, à un client, à un projet, à de la prospection ; « perso » sinon.
- « boite » : le nom d'une boîte de la liste fournie, recopié exactement, si l'idée s'y rattache clairement — un prénom, un nom de client, un sujet récurrent. Sinon, omets le champ.
- « nouvelle_boite » : un nom court, le plus souvent le nom propre lui-même, quand l'idée est pro, qu'un nom propre apparaît, et qu'aucune boîte de la liste ne convient. Sinon, omets le champ.
- Une idée « perso » n'a jamais de boîte : ni « boite », ni « nouvelle_boite ».
- « certitude » : « haute » si tu es sûr de l'univers et de la destination, « basse » sinon. Dans le doute sur l'univers, réponds « pro » et « basse ».

Réponds uniquement par ce JSON, sans un mot avant ni après, sans bloc de code :
{"idees":[{"texte":"...","univers":"pro","boite":"...","nouvelle_boite":"...","certitude":"haute"}]}`;

/** Le message : les boîtes d'abord, le texte ensuite, délimité. */
function message(texte: string, boites: Boite[]): string {
  const noms = boites
    .map((boite) => boite.name.trim().slice(0, LIMITE_NOM_BOITE))
    .filter((nom) => nom.length > 0);

  const liste = noms.length > 0 ? noms.join(" · ") : "aucune pour l'instant";

  return `Boîtes existantes : ${liste}\n\nTexte :\n"""\n${texte}\n"""`;
}

/**
 * Le JSON contenu dans la réponse, ou `null`.
 *
 * On demande du JSON nu, et on accepte quand même un bloc de code ou une
 * phrase autour : refuser une bonne réponse mal emballée coûterait un
 * classement à Louis sans rien lui garantir de plus.
 */
function extraireJson(texte: string): unknown | null {
  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return null;

  try {
    return JSON.parse(texte.slice(debut, fin + 1));
  } catch {
    return null;
  }
}

type ContenuTexte = { type: string; text?: string };

export async function demanderClassement(
  texte: string,
  boites: Boite[],
): Promise<unknown | null> {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    console.error("[sas] ANTHROPIC_API_KEY absente : classement manuel.");
    return null;
  }

  let reponse: Response;
  try {
    reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 2000,
        temperature: 0,
        system: SYSTEME,
        messages: [{ role: "user", content: message(texte, boites) }],
      }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (erreur) {
    // Délai dépassé ou réseau coupé. Le nom de l'erreur suffit : le corps de
    // la requête, lui, ne se journalise pas.
    console.error(
      "[sas] appel Anthropic impossible :",
      erreur instanceof Error ? erreur.name : "inconnue",
    );
    return null;
  }

  if (!reponse.ok) {
    console.error("[sas] Anthropic a répondu", reponse.status);
    return null;
  }

  let corps: { content?: ContenuTexte[]; stop_reason?: string };
  try {
    corps = await reponse.json();
  } catch {
    console.error("[sas] réponse Anthropic illisible.");
    return null;
  }

  // Réponse coupée par `max_tokens` : le JSON est tronqué, donc invalide.
  // On le dit ici plutôt que de laisser l'analyse échouer sans raison lisible.
  if (corps.stop_reason === "max_tokens") {
    console.error("[sas] réponse tronquée : trop d'idées d'un coup.");
    return null;
  }

  const texteRendu = (corps.content ?? [])
    .filter((bloc) => bloc.type === "text" && typeof bloc.text === "string")
    .map((bloc) => bloc.text as string)
    .join("");

  return extraireJson(texteRendu);
}
