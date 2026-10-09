/**
 * Les règles de la file qui se testent sans base : le mail à Louis, la
 * fenêtre de 24 h, la réponse fixe sans prénom.
 */

const FENETRE_MS = 24 * 60 * 60 * 1000;

/** Les caractères qui casseraient le HTML du mail. */
function echapper(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Le mail à Louis, pour une question de la file. */
export function mailDeLaFile(q: {
  genre: "incertain" | "detresse";
  client: string;
  simulation: boolean;
  lien: string;
}) {
  const prefixe = q.simulation ? "[Simulation] " : "";
  const sujet =
    q.genre === "detresse"
      ? `${prefixe}[Agent ${q.client}] Détresse : le 3114 est parti`
      : `${prefixe}[Agent ${q.client}] Une question t'attend`;
  const phrase =
    q.genre === "detresse"
      ? "Une cliente a écrit quelque chose qui ressemble à de la détresse. L'agent lui a donné le 3114 tout de suite. Rien à faire de ton côté : c'est pour qu'un humain le sache."
      : "L'agent n'est pas sûr de sa réponse. Elle a reçu « je vérifie et je reviens ». Corrige son brouillon dans le hub, il l'envoie à ta place.";
  const texte = `${phrase}\n\n${q.lien}\n`;
  const html = `<p>${echapper(phrase)}</p><p><a href="${echapper(q.lien)}">Ouvrir la file</a></p>`;
  return { sujet, texte, html };
}

/**
 * Le mail à Louis quand WhatsApp refuse un envoi pour de bon. Sans prénom ni
 * numéro : la raison de Meta, et où lire la conversation.
 */
export function mailEchecEnvoi(q: { client: string; erreur: string; lien: string }) {
  const sujet = `[Agent ${q.client}] Un message n'est pas parti`;
  const phrase =
    "WhatsApp a refusé un message de l'agent, et il ne le retentera pas : la même demande échouerait encore. Voici la raison donnée par Meta.";
  const texte = `${phrase}\n\n${q.erreur}\n\n${q.lien}\n`;
  const html = `<p>${echapper(phrase)}</p><p><code>${echapper(q.erreur)}</code></p><p><a href="${echapper(q.lien)}">Ouvrir la conversation</a></p>`;
  return { sujet, texte, html };
}

/** Jusqu'à quand l'agent peut encore lui écrire librement (null : jamais ouverte). */
export function finDeFenetre(derniereEntree: string | null): number | null {
  return derniereEntree ? Date.parse(derniereEntree) + FENETRE_MS : null;
}

/**
 * Une réponse fixe se garde sans prénom : elle survit à la purge des
 * conversations et resservira pour d'autres.
 */
export function sansPrenom(texte: string, prenom: string): string {
  const p = prenom.trim();
  if (p.length < 2) return texte;
  const echappe = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return texte.replace(new RegExp(`(?<![\\p{L}])${echappe}(?![\\p{L}])`, "giu"), "[prénom]");
}

const LONGUEUR_QUESTION = 2000;

/**
 * Une nouvelle question alors qu'une autre de la même conversation attend
 * déjà Louis : elle la rejoint, au lieu d'ouvrir une deuxième ligne et de
 * renvoyer « je vérifie et je reviens » (Christiane, 08/10/2026 : deux
 * messages d'attente à une minute d'écart, comme le 28/09).
 *
 * Le brouillon le plus récent l'emporte : l'IA l'a écrit en lisant toute la
 * conversation, la première question comprise. Trop longue, la question
 * garde son début (ce qui a ouvert la file) et sa fin (le dernier ajout).
 */
export function questionJointe(
  ouverte: { question: string; brouillon: string | null },
  nouvelle: { question: string; brouillon: string | null },
  quand: string,
): { question: string; brouillon: string | null } {
  const ajout = `\n\nPuis, ${quand} : ${nouvelle.question.trim()}`;
  const garde = Math.max(0, LONGUEUR_QUESTION - ajout.length - 1);
  const debut = ouverte.question.length > garde ? `${ouverte.question.slice(0, garde)}…` : ouverte.question;
  return {
    question: `${debut}${ajout}`.slice(0, LONGUEUR_QUESTION),
    brouillon: nouvelle.brouillon?.trim() ? nouvelle.brouillon : ouverte.brouillon,
  };
}
