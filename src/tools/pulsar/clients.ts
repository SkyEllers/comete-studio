import type { ClientPulsar, Entree } from "./types.ts";

/**
 * L'ordre des puces de client, au démarrage d'un chronomètre.
 *
 * Deux taps, dit le brief : le premier doit donc tomber juste presque à tous
 * les coups. L'ordre est celui de la probabilité, pas celui de l'alphabet —
 * un carnet trié de A à Z oblige à lire huit noms pour en trouver un.
 *
 * 1. « Comète » en tête. C'est le seul qu'on cherche sans savoir qu'on le
 *    cherche : la prospection et l'administratif arrivent entre deux choses,
 *    et c'est précisément ce temps-là qu'on ne note jamais.
 * 2. Puis les clients utilisés récemment, du plus récent au plus ancien.
 * 3. Puis les autres, par ordre alphabétique — ceux qu'on vient de créer, ou
 *    qu'on n'a pas touchés cette semaine.
 *
 * Les clients terminés ne sont pas ici : ils sortent des listes en amont, et
 * l'appelant ne leur passe que des clients actifs.
 */
export function ordonnerClients(
  clients: ClientPulsar[],
  entrees: Pick<Entree, "client_id" | "started_at">[],
): ClientPulsar[] {
  const recence = new Map<string, string>();

  for (const entree of entrees) {
    const connu = recence.get(entree.client_id);
    if (!connu || entree.started_at > connu) {
      recence.set(entree.client_id, entree.started_at);
    }
  }

  return [...clients].sort((a, b) => {
    if (a.is_internal !== b.is_internal) return a.is_internal ? -1 : 1;

    const vuA = recence.get(a.id);
    const vuB = recence.get(b.id);

    if (vuA && vuB) return vuA > vuB ? -1 : vuA < vuB ? 1 : 0;
    if (vuA) return -1;
    if (vuB) return 1;

    return a.name.localeCompare(b.name, "fr");
  });
}

/** Ceux qu'on peut encore chronométrer : les terminés sont archivés. */
export function clientsActifs(clients: ClientPulsar[]): ClientPulsar[] {
  return clients.filter((client) => client.statut !== "termine");
}
