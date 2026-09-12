/**
 * L'adresse depuis laquelle le script de Sonde se sert vraiment.
 *
 * Le hub se sert sur `app.cometestudio.fr`. `www.cometestudio.fr` sert encore,
 * le temps que les balises posées avant la bascule soient migrées, et le
 * domaine nu, lui, redirige. Une balise qui porte le domaine nu se charge quand
 * même — le navigateur suit la redirection pour un `<script>` — mais chaque
 * mesure qu'elle envoie meurt sur cette même redirection, sans bruit : ni
 * `sendBeacon` ni `fetch` ne suivent une redirection qui change d'origine en
 * CORS. Une landing entière peut ainsi ne rien mesurer pendant des jours en
 * ayant l'air installée.
 *
 * `sonde.js` sait se rattraper tout seul, et c'est sa dernière ligne de
 * défense — celle qui répare les balises déjà posées, chez des clients dont on
 * ne relira jamais le code. Ce n'est pas une raison pour en distribuer de
 * nouvelles qu'il faille rattraper.
 *
 * D'où cette normalisation au point unique où la balise s'écrit, plutôt qu'en
 * face de chaque `NEXT_PUBLIC_SITE_URL` : cette variable sert aussi aux liens
 * des courriels et au webhook de Radar, où le domaine nu ne gêne personne.
 *
 * Fonction pure, dans son propre module : `balise.tsx` est un composant
 * client, et `node --test` ne déroule pas du JSX.
 */
export function origineDuScript(origine: string): string {
  try {
    const url = new URL(origine);
    /* Le domaine nu part sur `app`, pas sur `www` : `www` est en sursis, et une
       balise qu'on distribue aujourd'hui doit survivre au jour où il s'éteint. */
    if (url.hostname === "cometestudio.fr") url.hostname = `app.${url.hostname}`;
    return url.origin;
  } catch {
    /* Une origine illisible n'est pas une raison de n'afficher aucune balise :
       celle qu'on affiche alors est fausse, mais elle est visible, et une
       balise visiblement fausse se corrige — une balise absente laisse croire
       que l'outil n'est pas prêt. */
    return origine.replace(/\/+$/, "");
  }
}
