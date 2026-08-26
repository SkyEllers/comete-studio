import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { IDENTIFIANTS_DE_CLIC } from "./attribution";

/**
 * Ce que Calendly nous envoie, et ce qu'on accepte d'en lire.
 *
 * Le corps est authentifié par signature avant d'arriver ici : la validation
 * qui suit n'est donc pas une défense contre un attaquant, c'est un détecteur
 * de dérive. Le jour où Calendly change la forme d'un champ qu'on lit, on veut
 * une ligne `invalid_payload` dans le journal, pas un montant silencieusement
 * à zéro sur un relevé.
 *
 * D'où le dosage : strict sur l'enveloppe, tolérant sur le reste.
 *
 * L'enveloppe est courte, documentée et stable ; un champ inattendu à ce
 * niveau-là veut dire qu'on ne parle plus à Calendly. Le `payload`, lui, porte
 * une vingtaine de champs dont nous n'en lisons qu'une poignée, et il grossit
 * au fil des versions : le refuser en bloc parce qu'un champ ignoré est apparu
 * ferait perdre des rendez-vous — c'est-à-dire de la commission — en silence.
 * On valide donc ce qu'on lit, et on laisse passer ce qu'on ignore.
 *
 * Le garde-fou de dernier recours est ailleurs : `last_webhook_at` n'avance
 * que sur un appel accepté, et l'administration alerte au-delà de quatorze
 * jours sans nouvelles.
 */

const objetSouple = z.looseObject;

const questionReponse = objetSouple({
  question: z.string(),
  answer: z.string(),
});

const paiement = objetSouple({
  external_id: z.string().nullish(),
  provider: z.string().nullish(),
  /** En unités de la devise — 90 pour 90 €, jamais en centimes. */
  amount: z.number().nullish(),
  currency: z.string().nullish(),
  successful: z.boolean().nullish(),
});

const evenementPlanifie = objetSouple({
  uri: z.string(),
  name: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  event_type: z.string().nullish(),
  status: z.string().nullish(),
});

const annulation = objetSouple({
  reason: z.string().nullish(),
  canceler_type: z.string().nullish(),
});

const invite = objetSouple({
  uri: z.string(),
  email: z.string(),
  status: z.string().nullish(),
  rescheduled: z.boolean().nullish(),
  old_invitee: z.string().nullish(),
  tracking: objetSouple({}).nullish(),
  questions_and_answers: z.array(questionReponse).nullish(),
  payment: paiement.nullish(),
  scheduled_event: evenementPlanifie,
  cancellation: annulation.nullish(),
});

/**
 * `created_by` fait partie de l'enveloppe de Calendly : l'oublier ici
 * refuserait tous les messages réels.
 */
export const messageCalendly = z.strictObject({
  event: z.string(),
  created_at: z.string().nullish(),
  created_by: z.string().nullish(),
  payload: invite,
});

export type MessageCalendly = z.infer<typeof messageCalendly>;

// ------------------------------- Signature ---------------------------------

const HEX = /^[0-9a-f]+$/i;

/**
 * `Calendly-Webhook-Signature: t=<horodatage>,v1=<hex>`
 *
 * La signature couvre `<t>.<corps brut>` : c'est l'horodatage dans le message
 * signé qui empêche de rejouer un ancien appel, et c'est pour ça qu'on le
 * compare à l'heure du serveur avant de faire quoi que ce soit d'autre.
 *
 * La comparaison est en temps constant. Sur une seule requête l'écart est
 * indétectable, mais rien n'empêche d'en envoyer un million.
 */
export function verifierSignature({
  entete,
  corps,
  cle,
  toleranceSecondes = 180,
  maintenant = Date.now(),
}: {
  entete: string | null;
  corps: string;
  cle: string;
  toleranceSecondes?: number;
  maintenant?: number;
}): boolean {
  if (!entete || !cle) return false;

  const parties = new Map<string, string>();
  for (const morceau of entete.split(",")) {
    const separateur = morceau.indexOf("=");
    if (separateur <= 0) continue;
    parties.set(
      morceau.slice(0, separateur).trim(),
      morceau.slice(separateur + 1).trim(),
    );
  }

  const t = parties.get("t");
  const v1 = parties.get("v1");
  if (!t || !v1 || !HEX.test(v1) || v1.length % 2 !== 0) return false;

  const horodatage = Number(t);
  if (!Number.isFinite(horodatage)) return false;
  if (Math.abs(maintenant / 1000 - horodatage) > toleranceSecondes) return false;

  const attendu = createHmac("sha256", cle).update(`${t}.${corps}`).digest();
  const recu = Buffer.from(v1, "hex");

  return attendu.length === recu.length && timingSafeEqual(attendu, recu);
}

// ----------------------------- Pseudonymisation ----------------------------

/**
 * Une personne, réduite à une clé.
 *
 * L'email entre ici et n'en ressort pas : c'est tout le contrat de Radar avec
 * les données personnelles. Le sel est propre au client, ce qui empêche de
 * recouper deux clientèles, et il vit dans le Vault.
 */
export function cleInvite(sel: string, email: string): string {
  return createHmac("sha256", sel).update(email.trim().toLowerCase()).digest("hex");
}

// ------------------------------ Normalisation ------------------------------

/** 90 € arrive en `90`, la base range des centimes. */
export function centimes(montant: number | null | undefined): number {
  if (typeof montant !== "number" || !Number.isFinite(montant) || montant < 0) return 0;
  return Math.round(montant * 100);
}

/**
 * Ce qu'on retient du `tracking` : les `utm_*` et les identifiants de clic.
 *
 * Une liste blanche, et pas une liste noire. Calendly y range aussi un
 * `salesforce_uuid` qui n'a rien à faire chez nous, et y rangera demain des
 * champs qu'on ne connaît pas encore.
 */
export function utmRetenus(
  tracking: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const garde: Record<string, string> = {};
  if (!tracking) return garde;

  for (const [cle, valeur] of Object.entries(tracking)) {
    if (typeof valeur !== "string" || valeur.length === 0) continue;
    if (cle.startsWith("utm_") || IDENTIFIANTS_DE_CLIC.includes(cle)) {
      garde[cle] = valeur.slice(0, 200);
    }
  }

  return garde;
}

/**
 * Les noms des champs qu'un objet du payload porte — jamais leurs valeurs.
 *
 * La documentation de Calendly dit ce qu'il *peut* envoyer ; seul un vrai
 * rendez-vous dit ce qu'il envoie. On veut notamment savoir si `gclid` et
 * `fbclid` arrivent dans le `tracking`, parce que toute l'attribution par
 * identifiant de clic en dépend.
 *
 * La distinction entre renseigné et vide compte autant que la liste : un champ
 * présent mais toujours nul ne sert à rien, et se confondrait avec un champ
 * absent si on ne comptait que les clés.
 */
export function champsPresents(objet: unknown): string {
  if (objet === null || objet === undefined) return "absent";
  if (typeof objet !== "object") return "forme inattendue";

  const entrees = Object.entries(objet as Record<string, unknown>).slice(0, 40);
  if (entrees.length === 0) return "vide";

  const nom = ([cle]: [string, unknown]) => cle.slice(0, 40);
  const rempli = (valeur: unknown) =>
    valeur !== null && valeur !== undefined && valeur !== "";

  const renseignes = entrees.filter(([, v]) => rempli(v)).map(nom).sort();
  const vides = entrees.filter(([, v]) => !rempli(v)).map(nom).sort();

  const morceaux = [renseignes.length > 0 ? renseignes.join(", ") : "aucun renseigné"];
  if (vides.length > 0) morceaux.push(`(vides : ${vides.join(", ")})`);

  return morceaux.join(" ");
}

/**
 * Pourquoi cette séance est tombée.
 *
 * Une catégorie, jamais le motif écrit par la personne : `cancellation.reason`
 * est du texte libre, et `canceled_by` est un nom. Ni l'un ni l'autre n'entre
 * dans la base.
 */
export function motifAnnulation(reprogramme: boolean | null | undefined): string {
  return reprogramme ? "Reprogrammée depuis Calendly" : "Annulée dans Calendly";
}
