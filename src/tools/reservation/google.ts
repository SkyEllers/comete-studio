/**
 * Google Agenda, en `fetch` natif, sans SDK (même choix que Calendly et
 * Anthropic, CLAUDE.md §2).
 *
 * Quatre gestes, et seulement ceux-là :
 * - connecter : l'écran de consentement de Google, puis l'échange du code
 *   contre un jeton de rafraîchissement (rangé dans le Vault, 0042) ;
 * - lire l'occupé : `freeBusy`, qui ne dit que « occupé de telle heure à
 *   telle heure », jamais le contenu des rendez-vous perso ;
 * - écrire le rendez-vous, avec un Google Meet créé tout seul ou le lien
 *   fixe de la personne ;
 * - effacer le rendez-vous (annulation, report).
 *
 * L'application Google est « Comète Studio », projet `comete-rapports`,
 * publiée en production le 27/09/2026. Identifiants dans Vercel :
 * `GOOGLE_RESERVATION_CLIENT_ID`, `GOOGLE_RESERVATION_CLIENT_SECRET`.
 */

export const DROITS = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

/** Les deux sans lesquels l'outil ne marche pas : la personne peut les décocher. */
export const DROITS_AGENDA = DROITS.slice(2);

export const CHEMIN_RETOUR = "/api/reservation/google/retour";

type Fetch = typeof fetch;

export type Identifiants = { clientId: string; clientSecret: string };

export function identifiants(): Identifiants | null {
  const clientId = process.env.GOOGLE_RESERVATION_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_RESERVATION_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export class ErreurGoogle extends Error {
  readonly statut: number;
  /** `invalid_grant` : l'accès a été retiré (par elle, ou par Google). */
  readonly accesRetire: boolean;

  constructor(message: string, statut: number, accesRetire = false) {
    super(message);
    this.name = "ErreurGoogle";
    this.statut = statut;
    this.accesRetire = accesRetire;
  }
}

async function lire(reponse: Response, geste: string): Promise<Record<string, unknown>> {
  const texte = await reponse.text();
  let corps: Record<string, unknown> = {};
  try {
    corps = texte ? (JSON.parse(texte) as Record<string, unknown>) : {};
  } catch {
    corps = {};
  }
  if (!reponse.ok) {
    // La raison donnée par Google, pas seulement le code (proposition 199).
    const e = corps.error;
    const raison =
      typeof e === "string"
        ? `${e}${typeof corps.error_description === "string" ? ` — ${corps.error_description}` : ""}`
        : typeof e === "object" && e && "message" in e
          ? String((e as { message: unknown }).message)
          : texte.slice(0, 200);
    throw new ErreurGoogle(`${geste} : ${reponse.status} ${raison}`, reponse.status, e === "invalid_grant");
  }
  return corps;
}

// ------------------------------- Connecter ---------------------------------

/** L'adresse de l'écran de consentement de Google. */
export function adresseConsentement(p: {
  clientId: string;
  retour: string;
  etat: string;
  email?: string | null;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.retour);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DROITS.join(" "));
  // Hors ligne : un jeton de rafraîchissement, pour lire son agenda quand
  // elle n'est pas là. `consent` : Google le redonne à chaque connexion.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", p.etat);
  if (p.email) url.searchParams.set("login_hint", p.email);
  return url.toString();
}

export type Connexion = {
  jetonRafraichissement: string;
  email: string | null;
  droitsManquants: string[];
};

/** L'adresse du compte, lue dans le jeton d'identité que Google vient de rendre. */
export function emailDuJeton(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const charge = idToken.split(".")[1];
  if (!charge) return null;
  try {
    const json = JSON.parse(Buffer.from(charge, "base64url").toString("utf8")) as { email?: unknown };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

/**
 * Le code rendu par Google contre les jetons. Le jeton d'identité arrive
 * directement de Google, en TLS, sur cet appel : pas besoin d'en vérifier
 * la signature pour en lire l'adresse.
 */
export async function echangerCode(
  code: string,
  retour: string,
  ids: Identifiants,
  f: Fetch = fetch,
): Promise<Connexion> {
  const reponse = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: ids.clientId,
      client_secret: ids.clientSecret,
      redirect_uri: retour,
      grant_type: "authorization_code",
    }),
  });
  const corps = await lire(reponse, "échange du code");
  const jeton = corps.refresh_token;
  if (typeof jeton !== "string" || jeton.length === 0) {
    throw new ErreurGoogle("échange du code : aucun jeton de rafraîchissement rendu", 200);
  }
  const accordes = new Set(String(corps.scope ?? "").split(" "));
  return {
    jetonRafraichissement: jeton,
    email: emailDuJeton(corps.id_token),
    droitsManquants: DROITS_AGENDA.filter((d) => !accordes.has(d)),
  };
}

/** Rendre l'accès à Google : le jeton ne sert plus à rien, nulle part. */
export async function revoquer(jeton: string, f: Fetch = fetch): Promise<void> {
  const reponse = await f("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: jeton }),
  });
  // Déjà révoqué ou expiré : c'est le résultat voulu.
  if (!reponse.ok && reponse.status !== 400) await lire(reponse, "révocation");
}

/** Un jeton d'accès d'une heure, à partir du jeton de rafraîchissement. */
export async function jetonAcces(jeton: string, ids: Identifiants, f: Fetch = fetch): Promise<string> {
  const reponse = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: jeton,
      client_id: ids.clientId,
      client_secret: ids.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const corps = await lire(reponse, "jeton d'accès");
  if (typeof corps.access_token !== "string") throw new ErreurGoogle("jeton d'accès : absent de la réponse", 200);
  return corps.access_token;
}

// ------------------------------ Lire l'occupé ------------------------------

const API = "https://www.googleapis.com/calendar/v3";

/** Les plages occupées de cet agenda entre `de` et `a`, en millisecondes. */
export async function occupe(
  acces: string,
  agenda: string,
  de: number,
  a: number,
  f: Fetch = fetch,
): Promise<{ debut: number; fin: number }[]> {
  const reponse = await f(`${API}/freeBusy`, {
    method: "POST",
    headers: { authorization: `Bearer ${acces}`, "content-type": "application/json" },
    body: JSON.stringify({
      timeMin: new Date(de).toISOString(),
      timeMax: new Date(a).toISOString(),
      items: [{ id: agenda }],
    }),
  });
  const corps = await lire(reponse, "lecture de l'occupé");
  const cal = (corps.calendars as Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }> | undefined)?.[agenda];
  // Google répond 200 même quand il n'a pas pu lire l'agenda : l'erreur est
  // dans l'agenda lui-même. Un occupé inconnu n'est pas un agenda libre.
  if (!cal || (cal.errors && cal.errors.length > 0)) {
    throw new ErreurGoogle(`lecture de l'occupé : ${cal?.errors?.map((e) => e.reason).join(", ") ?? "agenda absent de la réponse"}`, 200);
  }
  return (cal.busy ?? []).map((b) => ({ debut: Date.parse(b.start), fin: Date.parse(b.end) }));
}

// ---------------------------- Écrire, effacer ------------------------------

export type Evenement = {
  /**
   * Choisi par nous : l'identifiant du rendez-vous sans ses tirets (Google
   * accepte les chiffres et les lettres a à v). Écrire deux fois le même
   * rendez-vous ne crée donc jamais deux événements : le second essai reçoit
   * 409, et on relit le premier.
   */
  id: string;
  debut: string;
  fin: string;
  titre: string;
  description: string;
  /** « meet » : Google crée le lien. Sinon, le lien fixe de la personne. */
  visio: { type: "meet"; cle: string } | { type: "lien"; lien: string };
};

/** Le corps envoyé à Google, à part pour qu'on puisse le relire en test. */
export function corpsEvenement(e: Evenement): Record<string, unknown> {
  const corps: Record<string, unknown> = {
    id: e.id,
    summary: e.titre,
    description: e.visio.type === "lien" ? `${e.description}\n\nVisio : ${e.visio.lien}` : e.description,
    start: { dateTime: e.debut },
    end: { dateTime: e.fin },
    // Pas d'invitée dans l'événement : l'invitation part de l'adresse du
    // client (étape 5). Google n'écrit à personne, et l'adresse Gmail de la
    // closeuse n'est jamais montrée à la cliente.
    reminders: { useDefault: true },
    transparency: "opaque",
    extendedProperties: { private: { comete: "reservation" } },
  };
  if (e.visio.type === "meet") {
    corps.conferenceData = {
      createRequest: { requestId: e.visio.cle, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  } else {
    corps.location = e.visio.lien;
  }
  return corps;
}

function lienMeet(corps: Record<string, unknown>): string | null {
  const points = (corps.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined)
    ?.entryPoints;
  return points?.find((p) => p.entryPointType === "video")?.uri ?? null;
}

/** L'identifiant Google d'un rendez-vous : son uuid sans les tirets. */
export const idEvenement = (rdvId: string) => rdvId.replace(/-/g, "").toLowerCase();

/**
 * Écrire le rendez-vous. Rend l'identifiant de l'événement et le lien de
 * visio. Un Meet encore « en cours de création » se relit, au plus 5 fois.
 */
export async function creerEvenement(
  acces: string,
  agenda: string,
  e: Evenement,
  f: Fetch = fetch,
  attendre: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ id: string; lienVisio: string | null }> {
  if (!/^[0-9a-v]{5,1024}$/.test(e.id)) throw new ErreurGoogle(`identifiant d'événement refusé : ${e.id}`, 400);
  const reponse = await f(
    `${API}/calendars/${encodeURIComponent(agenda)}/events?conferenceDataVersion=1&sendUpdates=none`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${acces}`, "content-type": "application/json" },
      body: JSON.stringify(corpsEvenement(e)),
    },
  );
  const relire = async () =>
    lire(
      await f(`${API}/calendars/${encodeURIComponent(agenda)}/events/${encodeURIComponent(e.id)}`, {
        headers: { authorization: `Bearer ${acces}` },
      }),
      "relecture du rendez-vous",
    );

  // Déjà écrit par un essai précédent : on relit celui-là.
  const corps = reponse.status === 409 ? await relire() : await lire(reponse, "écriture du rendez-vous");
  if (e.visio.type === "lien") return { id: e.id, lienVisio: e.visio.lien };

  let lien = lienMeet(corps);
  for (let essai = 0; !lien && essai < 5; essai++) {
    await attendre(1_500);
    lien = lienMeet(await relire());
  }
  return { id: e.id, lienVisio: lien };
}

export async function effacerEvenement(acces: string, agenda: string, id: string, f: Fetch = fetch): Promise<void> {
  const reponse = await f(
    `${API}/calendars/${encodeURIComponent(agenda)}/events/${encodeURIComponent(id)}?sendUpdates=none`,
    { method: "DELETE", headers: { authorization: `Bearer ${acces}` } },
  );
  // Déjà effacé de son côté : c'est le résultat voulu.
  if (reponse.status === 404 || reponse.status === 410) return;
  if (!reponse.ok) await lire(reponse, "effacement du rendez-vous");
}
