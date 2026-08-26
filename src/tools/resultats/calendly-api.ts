import "server-only";

/**
 * Le peu qu'on demande à Calendly.
 *
 * Trois appels : qui es-tu, abonne-moi, désabonne-moi. En `fetch` natif, sans
 * paquet — une dépendance de plus pour trois requêtes ne se justifierait pas,
 * et celle-ci porterait un jeton d'accès au calendrier d'un client.
 *
 * Rien ici ne lève : chaque fonction rend un résultat lisible, que la Server
 * Action traduit en message français. Un jeton refusé n'est pas un incident,
 * c'est une faute de frappe.
 */

const RACINE = "https://api.calendly.com";

/** Les deux seuls événements auxquels Radar s'abonne. */
export const EVENEMENTS = ["invitee.created", "invitee.canceled"] as const;

export type Resultat<T> = { ok: true; data: T } | { ok: false; error: string };

async function appel<T>(
  jeton: string,
  chemin: string,
  options: { methode?: string; corps?: unknown } = {},
): Promise<Resultat<T>> {
  let reponse: Response;

  try {
    reponse = await fetch(chemin.startsWith("http") ? chemin : `${RACINE}${chemin}`, {
      method: options.methode ?? "GET",
      headers: {
        Authorization: `Bearer ${jeton}`,
        "Content-Type": "application/json",
      },
      body: options.corps ? JSON.stringify(options.corps) : undefined,
      // Le formulaire attend : mieux vaut un message clair qu'une page qui
      // tourne pendant une minute.
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, error: "Calendly n'a pas répondu. Réessaie dans un instant." };
  }

  if (reponse.status === 401 || reponse.status === 403) {
    return { ok: false, error: "Calendly refuse ce jeton. Vérifie qu'il est complet et toujours valide." };
  }

  if (reponse.status === 204) return { ok: true, data: null as T };

  const texte = await reponse.text();
  let corps: unknown = null;
  try {
    corps = texte ? JSON.parse(texte) : null;
  } catch {
    corps = null;
  }

  if (!reponse.ok) {
    const message =
      corps && typeof corps === "object" && "message" in corps
        ? String((corps as { message: unknown }).message)
        : `Calendly a répondu ${reponse.status}.`;
    return { ok: false, error: message };
  }

  return { ok: true, data: corps as T };
}

// ------------------------------- Qui es-tu ---------------------------------

export type Identite = { utilisateur: string; organisation: string };

/**
 * Le jeton est vérifié en même temps qu'il livre les deux URI dont
 * l'abonnement a besoin : un seul aller-retour pour les deux questions.
 */
export async function identite(jeton: string): Promise<Resultat<Identite>> {
  const reponse = await appel<{
    resource?: { uri?: string; current_organization?: string };
  }>(jeton, "/users/me");

  if (!reponse.ok) return reponse;

  const utilisateur = reponse.data?.resource?.uri;
  const organisation = reponse.data?.resource?.current_organization;

  if (!utilisateur || !organisation) {
    return {
      ok: false,
      error: "Calendly n'a pas renvoyé l'organisation de ce compte. Le plan est-il bien payant ?",
    };
  }

  return { ok: true, data: { utilisateur, organisation } };
}

// ------------------------------ Abonnements --------------------------------

export type Abonnement = {
  uri: string;
  callback_url: string;
  state?: string;
  events?: string[];
};

export async function creerAbonnement({
  jeton,
  organisation,
  url,
  cleSignature,
}: {
  jeton: string;
  organisation: string;
  url: string;
  cleSignature: string;
}): Promise<Resultat<Abonnement>> {
  const reponse = await appel<{ resource?: Abonnement }>(jeton, "/webhook_subscriptions", {
    methode: "POST",
    corps: {
      url,
      events: [...EVENEMENTS],
      organization: organisation,
      scope: "organization",
      signing_key: cleSignature,
    },
  });

  if (!reponse.ok) return reponse;
  if (!reponse.data?.resource?.uri) {
    return { ok: false, error: "Calendly a accepté l'abonnement sans le renvoyer." };
  }

  return { ok: true, data: reponse.data.resource };
}

export async function listerAbonnements({
  jeton,
  organisation,
}: {
  jeton: string;
  organisation: string;
}): Promise<Resultat<Abonnement[]>> {
  const reponse = await appel<{ collection?: Abonnement[] }>(
    jeton,
    `/webhook_subscriptions?organization=${encodeURIComponent(organisation)}&scope=organization&count=100`,
  );

  if (!reponse.ok) return reponse;
  return { ok: true, data: reponse.data?.collection ?? [] };
}

/** L'URI de l'abonnement est une adresse complète : on l'appelle telle quelle. */
export async function supprimerAbonnement(
  jeton: string,
  uri: string,
): Promise<Resultat<null>> {
  return appel<null>(jeton, uri, { methode: "DELETE" });
}
