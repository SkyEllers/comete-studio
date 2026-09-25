import { z } from "zod";

import type { FaconDeDecider, Profil } from "./profil.ts";

/**
 * Ce que l'agent lit d'une réservation Calendly.
 *
 * Le même message que Radar, déjà authentifié par sa signature ; mais l'agent
 * en lit ce que Radar s'interdit : le téléphone, l'email, toutes les réponses
 * au formulaire, les liens de report et de visio. Radar ne les voit jamais
 * passer par ici : ce module ne lui rend rien.
 *
 * Même dosage que `resultats/calendly.ts` : on valide ce qu'on lit, on laisse
 * passer le reste.
 */

const souple = z.looseObject;

const reponseFormulaire = souple({
  question: z.string(),
  answer: z.string(),
  position: z.number().nullish(),
});

export const invitationCalendly = souple({
  uri: z.string(),
  email: z.string(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  name: z.string().nullish(),
  created_at: z.string().nullish(),
  timezone: z.string().nullish(),
  text_reminder_number: z.string().nullish(),
  cancel_url: z.string().nullish(),
  reschedule_url: z.string().nullish(),
  rescheduled: z.boolean().nullish(),
  old_invitee: z.string().nullish(),
  questions_and_answers: z.array(reponseFormulaire).nullish(),
  scheduled_event: souple({
    uri: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    event_type: z.string().nullish(),
    location: souple({
      type: z.string().nullish(),
      join_url: z.string().nullish(),
      location: z.string().nullish(),
    }).nullish(),
  }),
  cancellation: souple({
    canceler_type: z.string().nullish(),
  }).nullish(),
});

export type InvitationCalendly = z.infer<typeof invitationCalendly>;
export type ReponseFormulaire = z.infer<typeof reponseFormulaire>;

/** 30 jours après le rendez-vous, tout s'efface (Louis, 25/09/2026). */
export const CONSERVATION_JOURS = 30;

const JOUR_MS = 86_400_000;

/**
 * Un numéro français au format international, ou `null`.
 *
 * Calendly rend ce que la personne a tapé : « 06 12 34 56 78 »,
 * « +33 6 12… », « 0033 6… ». WhatsApp veut « +33612345678 ». Un numéro
 * étranger déjà en `+` est gardé tel quel, espaces retirés. Tout le reste —
 * trop court, lettres — ne devine rien : mieux vaut aucun message qu'un
 * message chez quelqu'un d'autre.
 */
export function telephoneInternational(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const compact = brut.replace(/[\s.\-()]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  if (/^00[1-9]\d{7,14}$/.test(compact)) return `+${compact.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(compact)) return `+33${compact.slice(1)}`;
  return null;
}

function reponseA(reponses: ReponseFormulaire[], motif: RegExp): string | null {
  const trouvee = reponses.find((r) => motif.test(r.question));
  const texte = trouvee?.answer.trim();
  return texte ? texte : null;
}

export function faconDeDecider(
  reponses: ReponseFormulaire[],
  profil: Profil,
): FaconDeDecider | null {
  const reponse = reponseA(reponses, profil.questions.faconDeDecider);
  if (!reponse) return null;
  return profil.faconsDeDecider.find((f) => f.motif.test(reponse))?.facon ?? null;
}

function prenomDe(invite: InvitationCalendly): { prenom: string; nom: string | null } {
  const prenom = invite.first_name?.trim();
  if (prenom) return { prenom, nom: invite.last_name?.trim() || null };
  const complet = (invite.name ?? "").trim();
  const [premier, ...reste] = complet.split(/\s+/);
  return { prenom: premier || "toi", nom: reste.join(" ") || null };
}

export type NouvelleConversation = {
  invitee_uri: string;
  event_uri: string;
  event_type_uri: string | null;
  rdv_debut: string;
  rdv_fin: string;
  reserve_le: string;
  lien_visio: string | null;
  lien_report: string | null;
  lien_annulation: string | null;
  prenom: string;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  fuseau: string;
  reponses: ReponseFormulaire[];
  facon_de_decider: FaconDeDecider | null;
  etat: "active" | "hors_champ";
  efface_apres: string;
};

/**
 * Une réservation devient une conversation.
 *
 * `hors_champ` quand le rendez-vous est trop proche (P12 : l'agent prend la
 * main au-delà de 24 h) ou qu'on n'a aucun numéro où écrire : la conversation
 * existe quand même, pour que la mesure compte aussi ces rendez-vous-là.
 */
export function lireReservation(
  invite: InvitationCalendly,
  profil: Profil,
  options: { delaiMinimumMs: number; recuLe: string },
): NouvelleConversation {
  const reponses = [...(invite.questions_and_answers ?? [])];
  const telephone =
    telephoneInternational(reponseA(reponses, profil.questions.telephone)) ??
    telephoneInternational(invite.text_reminder_number);

  const debut = invite.scheduled_event.start_time;
  const reserveLe = invite.created_at ?? options.recuLe;
  const assezLoin = Date.parse(debut) - Date.parse(reserveLe) >= options.delaiMinimumMs;
  const { prenom, nom } = prenomDe(invite);
  const suivie = assezLoin && telephone !== null;

  // Hors champ, l'agent n'écrira jamais : il n'a aucune raison de garder de
  // quoi joindre la personne, ni ses réponses. Le prénom et l'heure suffisent
  // à la mesure.
  return {
    invitee_uri: invite.uri,
    event_uri: invite.scheduled_event.uri,
    event_type_uri: invite.scheduled_event.event_type ?? null,
    rdv_debut: debut,
    rdv_fin: invite.scheduled_event.end_time,
    reserve_le: reserveLe,
    lien_visio: invite.scheduled_event.location?.join_url ?? null,
    lien_report: invite.reschedule_url ?? null,
    lien_annulation: invite.cancel_url ?? null,
    prenom: prenom.slice(0, 80),
    nom: nom?.slice(0, 80) ?? null,
    email: suivie ? invite.email : null,
    telephone: suivie ? telephone : null,
    fuseau: invite.timezone || "Europe/Paris",
    reponses: suivie ? reponses : [],
    facon_de_decider: suivie ? faconDeDecider(reponses, profil) : null,
    etat: suivie ? "active" : "hors_champ",
    efface_apres: effaceApres(invite.scheduled_event.end_time),
  };
}

export function effaceApres(finRdv: string): string {
  return new Date(Date.parse(finRdv) + CONSERVATION_JOURS * JOUR_MS).toISOString();
}
