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
