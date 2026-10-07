import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import {
  AGENDA_PRINCIPAL,
  agendaExiste,
  changerDescription,
  creerAgenda,
  creerEvenement,
  effacerEvenement,
  ErreurGoogle,
  idEvenement,
  jetonAcces,
  occupe,
  revoquer,
  type Connexion,
  type Identifiants,
} from "./google.ts";
import { evenementPremier, type DevisPaye } from "../devis/premier-regles.ts";

import type { Agendas, PersonneLue } from "./moteur.ts";
import { descriptionEvenement, lienFiche } from "./reponses.ts";

/**
 * Google Agenda branché sur la base du hub : le jeton de chacune vit dans le
 * Vault (`reservation:<personne>:google_refresh_token`, 0042), lu par le
 * serveur seulement.
 */

type Admin = ReturnType<typeof createAdminClient>;

const TYPE = "google_refresh_token";

export async function lireJeton(db: Admin, personneId: string): Promise<string | null> {
  const { data, error } = await db.rpc("reservation_get_secret", { personne: personneId, kind: TYPE });
  if (error) throw new Error(`jeton Google : ${error.message}`);
  return data ?? null;
}

/**
 * Après l'écran de Google : son agenda « Diagnostics » (celui d'avant s'il
 * existe encore, sinon un neuf), le jeton au Vault, l'adresse, l'agenda et
 * l'heure sur sa fiche.
 */
export async function enregistrerConnexion(db: Admin, personneId: string, c: Connexion): Promise<void> {
  const { data: fiche, error: lecture } = await db
    .from("reservation_personnes")
    .select("fuseau, google_agenda")
    .eq("id", personneId)
    .single();
  if (lecture || !fiche) throw new Error(`fiche : ${lecture?.message ?? "introuvable"}`);

  const ancien = fiche.google_agenda !== AGENDA_PRINCIPAL ? fiche.google_agenda : null;
  const agenda =
    ancien && (await agendaExiste(c.jetonAcces, ancien)) ? ancien : await creerAgenda(c.jetonAcces, fiche.fuseau);

  const pose = await db.rpc("reservation_set_secret", { personne: personneId, kind: TYPE, value: c.jetonRafraichissement });
  if (pose.error) throw new Error(`jeton Google : ${pose.error.message}`);
  const { error } = await db
    .from("reservation_personnes")
    .update({ google_email: c.email, google_agenda: agenda, google_connecte_le: new Date().toISOString() })
    .eq("id", personneId);
  if (error) throw new Error(`fiche : ${error.message}`);
}

/**
 * Plus d'agenda : plus de créneaux chez elle. Le jeton est rendu à Google
 * (s'il répond) puis effacé ; ses rendez-vous déjà pris restent.
 */
export async function deconnecter(db: Admin, personneId: string): Promise<void> {
  const jeton = await lireJeton(db, personneId);
  if (jeton) {
    try {
      await revoquer(jeton);
    } catch (erreur) {
      console.error("Réservation : révocation Google refusée", erreur instanceof Error ? erreur.message : erreur);
    }
  }
  await db.rpc("reservation_clear_secrets", { personne: personneId });
  const { error } = await db
    .from("reservation_personnes")
    .update({ google_email: null, google_connecte_le: null })
    .eq("id", personneId);
  if (error) throw new Error(`fiche : ${error.message}`);
}

/**
 * L'accès a été retiré de son côté (compte Google, mot de passe changé,
 * application retirée) : on la marque déconnectée, pour qu'elle ne propose
 * plus rien tant qu'elle ne s'est pas reconnectée.
 */
async function marquerRetire(db: Admin, personneId: string): Promise<void> {
  await db.from("reservation_personnes").update({ google_connecte_le: null }).eq("id", personneId);
}

/** Un jeton d'accès par personne, gardé le temps d'une requête. */
function porteJetons(db: Admin, ids: Identifiants) {
  const acces = new Map<string, Promise<string>>();
  return (personneId: string): Promise<string> => {
    let p = acces.get(personneId);
    if (!p) {
      p = (async () => {
        const jeton = await lireJeton(db, personneId);
        if (!jeton) throw new ErreurGoogle("aucun jeton Google rangé", 0, true);
        try {
          return await jetonAcces(jeton, ids);
        } catch (erreur) {
          if (erreur instanceof ErreurGoogle && erreur.accesRetire) await marquerRetire(db, personneId);
          throw erreur;
        }
      })();
      acces.set(personneId, p);
    }
    return p;
  };
}

/** L'occupé de l'agenda principal d'une personne, par son identifiant (page de réservation, liste « Confier »). */
export function lecteurOccupe(db: Admin, ids: Identifiants) {
  const jeton = porteJetons(db, ids);
  return async (personneId: string, de: number, a: number) => occupe(await jeton(personneId), AGENDA_PRINCIPAL, de, a);
}

/** Les agendas du moteur, sur Google. */
export function agendasGoogle(db: Admin, ids: Identifiants): Agendas {
  const lire = lecteurOccupe(db, ids);
  return {
    async occupe(p: PersonneLue, de: number, a: number) {
      // L'occupé se lit dans son agenda à elle ; ses diagnostics, eux,
      // viennent de la base (pause et maximum).
      return lire(p.id, de, a);
    },
  };
}

type RdvPourAgenda = {
  id: string;
  debut: string;
  fin: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  reponses: unknown;
  google_event_id: string | null;
  organization_id: string;
  genre: "diagnostic" | "premier";
  devis_id: string | null;
  personne: { id: string; role: string; google_agenda: string; visio: string; lien_visio: string | null };
};

async function lireRdv(db: Admin, rdvId: string): Promise<RdvPourAgenda> {
  const { data, error } = await db
    .from("reservation_rendez_vous")
    .select(
      "id, debut, fin, prenom, nom, telephone, reponses, google_event_id, organization_id, genre, devis_id, personne:reservation_personnes!reservation_rendez_vous_personne_id_organization_id_fkey(id, role, google_agenda, visio, lien_visio)",
    )
    .eq("id", rdvId)
    .single();
  if (error || !data) throw new Error(`rendez-vous ${rdvId} : ${error?.message ?? "introuvable"}`);
  return data as unknown as RdvPourAgenda;
}

/**
 * Écrire un rendez-vous dans l'agenda de sa personne, puis garder sur la
 * ligne l'identifiant de l'événement et le lien de visio. Sans effet s'il est
 * déjà écrit. Un échec laisse `google_event_id` vide : l'horloge réessaiera.
 */
export async function ecrireRendezVous(
  db: Admin,
  rdvId: string,
  ids: Identifiants,
  baseEspace: string,
): Promise<{ id: string; lienVisio: string | null }> {
  const rdv = await lireRdv(db, rdvId);
  if (rdv.google_event_id) return { id: rdv.google_event_id, lienVisio: null };
  if (rdv.personne.google_agenda === AGENDA_PRINCIPAL) {
    throw new Error(`rendez-vous ${rdv.id} : pas d'agenda « Diagnostics », la personne doit reconnecter Google`);
  }

  const acces = await porteJetons(db, ids)(rdv.personne.id);
  const prenom = rdv.prenom?.trim() || "une cliente";
  const premier = rdv.genre === "premier" && rdv.devis_id ? await evenementDuDevis(db, rdv.devis_id) : null;
  const ecrit = await creerEvenement(acces, rdv.personne.google_agenda, {
    id: idEvenement(rdv.id),
    debut: rdv.debut,
    fin: rdv.fin,
    // Le titre porte le rappel : c'est lui que la notification affiche (Louis, 28/09/2026).
    titre: premier?.titre ?? `Diagnostic · ${prenom} · lance l'enregistrement`,
    // Son numéro et ses réponses au formulaire, sous les yeux (Louis, 30/09/2026).
    // Un premier rendez-vous (0055) : sa formule, ce qu'elle veut, l'adresse du kit.
    description:
      premier?.description ??
      descriptionEvenement({ ...rdv, email: null }, lienFiche(baseEspace, rdv.personne.role, rdv.id)),
    visio:
      rdv.personne.visio === "lien" && rdv.personne.lien_visio
        ? { type: "lien", lien: rdv.personne.lien_visio }
        : { type: "meet", cle: rdv.id },
  });

  const { error } = await db
    .from("reservation_rendez_vous")
    .update({ google_event_id: ecrit.id, lien_visio: ecrit.lienVisio })
    .eq("id", rdv.id);
  if (error) throw new Error(`rendez-vous ${rdv.id} : ${error.message}`);
  return ecrit;
}

/** Le titre et la description d'un premier rendez-vous, depuis son devis (0055). */
async function evenementDuDevis(db: Admin, devisId: string): Promise<{ titre: string; description: string } | null> {
  // Les tables du devis (0050) ne sont pas dans les types générés : client non typé, comme `devis/moteur.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("devis")
    .select("prenom, nom, email, telephone, adresse, objet, duree_mois, paiement, investigation_cents, mensualite_cents, total_cents, paye_le, closeuse_id")
    .eq("id", devisId)
    .maybeSingle();
  if (!data) return null;
  const d = data as DevisPaye & { closeuse_id: string | null };
  const { data: profil } = d.closeuse_id
    ? await db.from("profiles").select("full_name").eq("id", d.closeuse_id).maybeSingle()
    : { data: null };
  return evenementPremier(d, profil?.full_name ?? null);
}

/** Retirer un rendez-vous annulé ou reporté de l'agenda de sa personne. */
export async function effacerRendezVous(db: Admin, rdvId: string, ids: Identifiants): Promise<void> {
  const rdv = await lireRdv(db, rdvId);
  if (!rdv.google_event_id) return;
  const acces = await porteJetons(db, ids)(rdv.personne.id);
  await effacerEvenement(acces, rdv.personne.google_agenda, rdv.google_event_id);
}

/**
 * Réécrire la description d'un rendez-vous déjà dans l'agenda : numéro,
 * réponses, lien de sa fiche (Louis, 30/09/2026, pour ceux pris avant). Même
 * texte que `ecrireRendezVous`, lien fixe de visio compris.
 */
export async function reecrireDescription(
  db: Admin,
  rdvId: string,
  ids: Identifiants,
  baseEspace: string,
): Promise<boolean> {
  const rdv = await lireRdv(db, rdvId);
  // Un premier rendez-vous (0055) garde la description tirée de son devis.
  if (!rdv.google_event_id || rdv.personne.google_agenda === AGENDA_PRINCIPAL || rdv.genre === "premier") return false;
  const acces = await porteJetons(db, ids)(rdv.personne.id);
  const texte = descriptionEvenement({ ...rdv, email: null }, lienFiche(baseEspace, rdv.personne.role, rdv.id));
  const lien = rdv.personne.visio === "lien" ? rdv.personne.lien_visio : null;
  await changerDescription(
    acces,
    rdv.personne.google_agenda,
    rdv.google_event_id,
    lien ? `${texte}\n\nVisio : ${lien}` : texte,
  );
  return true;
}
