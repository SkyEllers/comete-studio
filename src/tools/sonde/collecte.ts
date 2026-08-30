import { createHmac } from "node:crypto";

import { z } from "zod";

/**
 * Les défenses du point de collecte, à part de la route.
 *
 * Elles vivent ici parce qu'elles se déroulent en une seconde sous
 * `node --test`, alors que les éprouver à travers la route demande un serveur,
 * une base et un décor. Ce sont des fonctions pures : une entrée, une réponse,
 * aucun effet.
 *
 * Une chose à garder en tête en les lisant : aucune ne sert à protéger un
 * secret. Le jeton d'un site est public, il voyage dans une balise `<script>`.
 * Elles servent à ce que les chiffres veuillent dire quelque chose — qu'un
 * robot ne compte pas comme une personne, qu'une page tierce ne gonfle pas les
 * visites d'un client, qu'un rejeu ne fasse pas passer une landing pour un
 * succès.
 */

/** Les paramètres d'URL qu'on retient, et rien d'autre. */
export const IDENTIFIANTS_DE_CLIC = ["gclid", "fbclid", "ttclid"] as const;

/**
 * L'enveloppe, stricte : tout champ inattendu fait rejeter l'événement.
 *
 * C'est la règle de CLAUDE.md §7 appliquée à une enveloppe qu'on écrit
 * nous-mêmes, des deux côtés. Un champ en trop ne peut venir que d'un script
 * qui n'est pas le nôtre, et on n'a aucune raison de deviner ce qu'il voulait
 * dire. Le contenu de `u`, lui, reste filtré plutôt que rejeté : les régies
 * ajoutent des paramètres sans prévenir, et perdre une visite parce que
 * quelqu'un a collé un `?ref=newsletter` serait absurde.
 */
export const corpsSchema = z
  .object({
    e: z.enum(["pageview", "cta"]),
    p: z.string().max(2048).optional(),
    r: z.string().max(255).nullish(),
    u: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type CorpsSonde = z.infer<typeof corpsSchema>;

/** Un corps plus gros que ça n'est pas une mesure d'audience. */
export const TAILLE_MAX_CORPS = 1024;

/**
 * Les robots, reconnus à ce qu'ils disent d'eux-mêmes.
 *
 * Filtre imparfait et assumé : un robot qui se déclare navigateur passera, et
 * un navigateur exotique pourra être écarté. Sonde mesure des ordres de
 * grandeur — « trois cents visiteurs, quarante clics » — pas une comptabilité.
 * Un user-agent absent est écarté aussi : tous les navigateurs en envoient un,
 * ce qui n'en a pas n'est pas quelqu'un.
 */
const SIGNATURES_ROBOT = [
  "bot",
  "crawler",
  "spider",
  "preview",
  "headless",
  "lighthouse",
  "pingdom",
  "monitor",
];

export function estRobot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  const ua = userAgent.toLowerCase();
  return SIGNATURES_ROBOT.some((signature) => ua.includes(signature));
}

/** L'hôte d'une URL, en minuscules et sans port, ou `null`. */
export function hote(valeur: string | null | undefined): string | null {
  if (!valeur) return null;

  const brut = valeur.trim();
  if (brut.length === 0 || brut.length > 2048) return null;

  try {
    const url = new URL(brut.includes("://") ? brut : `https://${brut}`);
    const nom = url.hostname.toLowerCase();
    return nom.length > 0 && nom.length <= 255 ? nom : null;
  } catch {
    return null;
  }
}

/**
 * Cet hôte fait-il partie du site ?
 *
 * Les sous-domaines sont admis : un client déclare `jonathan-cuinat.com` et sa
 * landing peut vivre sur `www.` ou `rdv.`. L'inverse ne l'est pas —
 * `jonathan-cuinat.com.attaquant.test` ne doit pas passer, d'où le point
 * exigé avant le domaine déclaré.
 */
export function hoteAutorise(candidat: string | null, domaines: string[]): boolean {
  if (!candidat) return false;

  return domaines.some((declare) => {
    const domaine = hote(declare);
    if (!domaine) return false;
    return candidat === domaine || candidat.endsWith(`.${domaine}`);
  });
}

/**
 * Le chemin, débarrassé de tout le reste.
 *
 * La query string ne rentre pas : elle porte parfois un prénom, un courriel de
 * désinscription, un identifiant de commande. Le fragment non plus. Ce qui
 * reste tient en 512 caractères, largement au-delà de ce qu'une landing
 * utilise, et bien en deçà de ce qu'une URL forgée pourrait faire entrer.
 */
export function chemin(valeur: string | null | undefined): string {
  if (!valeur) return "/";

  const sansAncre = valeur.split("#")[0] ?? "";
  const sansQuery = sansAncre.split("?")[0] ?? "";
  const propre = sansQuery.trim();

  if (propre.length === 0) return "/";
  const commence = propre.startsWith("/") ? propre : `/${propre}`;

  return commence.slice(0, 512);
}

/**
 * Ce qu'on retient de l'URL : les `utm_*` et les identifiants de clic.
 *
 * Une liste blanche, comme pour Calendly, et pour la même raison : on sait ce
 * qu'on veut garder, on ne saura jamais énumérer ce qu'on refuse.
 */
export function utmRetenus(brut: unknown): Record<string, string> {
  const garde: Record<string, string> = {};
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return garde;

  for (const [cle, valeur] of Object.entries(brut as Record<string, unknown>)) {
    if (typeof valeur !== "string" || valeur.length === 0) continue;
    if (cle.startsWith("utm_") || (IDENTIFIANTS_DE_CLIC as readonly string[]).includes(cle)) {
      garde[cle.slice(0, 40)] = valeur.slice(0, 200);
    }
  }

  return garde;
}

/**
 * L'adresse du visiteur, telle que Vercel la transmet.
 *
 * Elle ne sert qu'à deux choses, toutes deux en mémoire : compter les
 * événements d'une même adresse par minute, et entrer dans le HMAC. Elle n'est
 * écrite nulle part — aucune colonne de Sonde ne pourrait la recevoir.
 */
export function adresse(entetes: Headers): string {
  const transmise = entetes.get("x-forwarded-for") ?? entetes.get("x-real-ip") ?? "";
  return transmise.split(",")[0]?.trim() || "inconnue";
}

// ------------------------------ Le débit ------------------------------------

/**
 * Un amortisseur, pas un rempart.
 *
 * La fenêtre est glissante et vit dans la mémoire de l'instance : Vercel en
 * fait tourner plusieurs, et une même adresse répartie sur trois instances
 * obtient trois fois la limite. C'est connu et accepté — le rôle de ce
 * compteur est d'empêcher qu'un script en boucle sur un poste fasse passer une
 * landing pour un succès, pas de résister à quelqu'un qui s'en donne les
 * moyens. Contre celui-là, il n'y a rien à voler : le jeton est public et les
 * chiffres sont ceux du client.
 *
 * L'horloge est injectable pour que le banc puisse dérouler une minute en
 * quelques microsecondes.
 */
export function creerLimiteur({
  fenetreMs = 60_000,
  maximum = 60,
  cles = 5_000,
  horloge = () => Date.now(),
}: {
  fenetreMs?: number;
  maximum?: number;
  cles?: number;
  horloge?: () => number;
} = {}) {
  const passages = new Map<string, number[]>();

  return function autorise(cle: string): boolean {
    const maintenant = horloge();
    const depuis = maintenant - fenetreMs;

    // Le garde-fou de mémoire : au-delà de quelques milliers d'adresses, on
    // repart de zéro plutôt que de grossir sans fin. Une instance Vercel qui
    // vit longtemps verrait sinon sa table enfler à chaque nouveau visiteur.
    if (passages.size > cles) passages.clear();

    const recents = (passages.get(cle) ?? []).filter((instant) => instant > depuis);

    if (recents.length >= maximum) {
      passages.set(cle, recents);
      return false;
    }

    recents.push(maintenant);
    passages.set(cle, recents);
    return true;
  };
}

// ------------------------------ La clé du jour ------------------------------

/**
 * La clé d'un visiteur.
 *
 * `HMAC(sel du jour, site + adresse + user-agent)`. Le sel est le seul secret,
 * il vit un jour, et la tâche de nuit le détruit : demain, cette clé ne se
 * recalcule plus, même en connaissant l'adresse et le navigateur. C'est ce qui
 * rend deux visites à deux jours d'écart irréconciliables — non par politique
 * d'usage, mais parce que l'information qui les relierait n'existe plus.
 *
 * Fonction pure, à côté des autres, et non enfouie dans la route : c'est la
 * promesse centrale de Sonde, et une promesse doit pouvoir se dérouler en
 * quelques microsecondes plutôt que se relire.
 */
export function cleVisiteur(
  sel: string,
  siteId: string,
  ip: string,
  userAgent: string,
): string {
  return createHmac("sha256", sel).update(`${siteId}|${ip}|${userAgent}`).digest("hex");
}
