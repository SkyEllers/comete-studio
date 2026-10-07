import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { envoyer } from "../fichiers/courriel.ts";
import { agendasGoogle, ecrireRendezVous, effacerRendezVous } from "../reservation/agenda.ts";
import { depotSupabase } from "../reservation/depot.ts";
import { identifiants } from "../reservation/google.ts";
import { creneauxLibres, reserver, reporter } from "../reservation/moteur.ts";
import { creneauxPublics, type CreneauxPublics } from "../reservation/page.ts";
import { baseEspace } from "../reservation/suites.ts";

import { noter, notifierSite, profilDe, type LigneDevis } from "./moteur.ts";
import {
  dureePremier,
  mailPayePeggy,
  mailRdvPeggy,
  mailSansRdvPeggy,
  rappelSansRdvDu,
  rappelVeilleDu,
  type DevisPaye,
} from "./premier-regles.ts";

/**
 * Le premier rendez-vous avec Peggy, après un devis payé (Louis, 07/10/2026).
 * Il se prend dans l'outil de réservation, chez la titulaire seule, avec les
 * règles du diagnostic et sa durée à lui (`premier-regles.ts`). Il n'entre ni
 * dans Radar, ni chez l'agent WhatsApp, ni dans les conversions des pubs : ce
 * n'est pas un diagnostic. Il se gère par le lien du devis, pas par un lien
 * personnel de rendez-vous.
 */

type Admin = ReturnType<typeof createAdminClient>;

// Les tables du devis (0050) ne sont pas dans les types générés, comme dans `moteur.ts`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brut = (admin: Admin) => admin as any;

/** `fuseau` : celui de la cliente quand elle a réservé, pour les heures de ses mails. */
export type PremierRdv = { id: string; debut: string; fin: string; lienVisio: string | null; fuseau: string };

/** Le premier rendez-vous confirmé de ce devis, ou null. */
export async function premierDuDevis(admin: Admin, devisId: string): Promise<PremierRdv | null> {
  const { data } = await brut(admin)
    .from("reservation_rendez_vous")
    .select("id, debut, fin, lien_visio, fuseau_cliente")
    .eq("devis_id", devisId)
    .eq("genre", "premier")
    .eq("statut", "confirme")
    .maybeSingle();
  return data
    ? { id: data.id, debut: data.debut, fin: data.fin, lienVisio: data.lien_visio ?? null, fuseau: data.fuseau_cliente ?? "Europe/Paris" }
    : null;
}

/** Le rendez-vous tel que le site le voit : sans identifiant interne. */
export function rdvPourSite(r: PremierRdv | null): Omit<PremierRdv, "id"> | null {
  return r ? { debut: r.debut, fin: r.fin, lienVisio: r.lienVisio, fuseau: r.fuseau } : null;
}

/** Ce que le site lit d'un devis payé : la durée, et le rendez-vous s'il est pris. */
export async function vuePremier(admin: Admin, d: LigneDevis) {
  return {
    premierMinutes: dureePremier(d),
    premierRdv: d.paye_le ? rdvPourSite(await premierDuDevis(admin, d.id)) : null,
  };
}

async function closeuseDe(admin: Admin, d: Pick<LigneDevis, "closeuse_id">): Promise<string | null> {
  if (!d.closeuse_id) return null;
  const { data } = await admin.from("profiles").select("full_name").eq("id", d.closeuse_id).maybeSingle();
  return data?.full_name ?? null;
}

/** L'adresse de la titulaire (Peggy) ; Louis s'il n'y en a pas. */
async function adresseTitulaire(admin: Admin, org: string): Promise<string[] | undefined> {
  const { data } = await admin
    .from("reservation_personnes")
    .select("profiles(email)")
    .eq("organization_id", org)
    .eq("role", "titulaire")
    .maybeSingle();
  const email = (data?.profiles as { email: string | null } | null)?.email;
  return email ? [email] : undefined;
}

// ------------------------------ Le paiement ---------------------------------

/**
 * Au premier « payé » : le mail à Peggy (de quoi envoyer le kit), puis celui
 * de la cliente, par le site (le lien pour réserver). Ne lève jamais.
 */
export async function apresPaiement(admin: Admin, d: LigneDevis): Promise<void> {
  try {
    const [closeuse, a] = await Promise.all([closeuseDe(admin, d), adresseTitulaire(admin, d.organization_id)]);
    if (await envoyer({ ...mailPayePeggy(d, closeuse), a })) await noter(admin, d.id, "peggy_prevenue");
  } catch (erreur) {
    console.error("Devis, mail à Peggy au paiement :", erreur instanceof Error ? erreur.message : "erreur");
  }
  try {
    const [p, lien] = await Promise.all([profilDe(admin, d.organization_id), lienDe(admin, d.id)]);
    if (p && lien && (await notifierSite(p.site, lien, "paye"))) await noter(admin, d.id, "mail_rdv");
  } catch (erreur) {
    console.error("Devis, mail à la cliente au paiement :", erreur instanceof Error ? erreur.message : "erreur");
  }
}

async function lienDe(admin: Admin, devisId: string): Promise<string | null> {
  const { data } = await brut(admin).from("devis_liens").select("lien").eq("devis_id", devisId).maybeSingle();
  return (data?.lien as string | undefined) ?? null;
}

// ------------------------------ Réserver ------------------------------------

const options = (d: LigneDevis) => ({ titulaireSeule: true, dureeMinutes: dureePremier(d) });

/** Les créneaux de Peggy pour ce premier rendez-vous. */
export async function creneauxPremier(admin: Admin, d: LigneDevis): Promise<CreneauxPublics | null> {
  const ids = identifiants();
  if (!ids) return null;
  const depot = depotSupabase(admin);
  const regles = await depot.reglages(d.organization_id);
  const dispo = await creneauxLibres(d.organization_id, Date.now(), depot, agendasGoogle(admin, ids), options(d));
  return creneauxPublics(dispo, regles?.fuseau ?? "Europe/Paris");
}

export type Prise =
  | { ok: true; rdv: PremierRdv; deplace: boolean; ancienDebut: string | null }
  | { ok: false; raison: "ferme" | "plus_libre" | "erreur" };

/**
 * Réserver le premier rendez-vous, ou le déplacer s'il est déjà pris. Puis
 * l'agenda de Peggy (événement et visio) et son mail. La cliente ne
 * l'annule pas en ligne : elle a payé, il lui faut un rendez-vous (Louis).
 */
export async function reserverPremier(admin: Admin, d: LigneDevis, debut: string, fuseau: string): Promise<Prise> {
  const ids = identifiants();
  if (!ids) return { ok: false, raison: "erreur" };
  const org = d.organization_id;
  const depot = depotSupabase(admin);
  const agendas = agendasGoogle(admin, ids);
  const ancien = await premierDuDevis(admin, d.id);

  const prise = ancien
    ? await reporter(org, ancien.id, debut, "cliente", Date.now(), depot, agendas, options(d))
    : await reserver(
        org,
        debut,
        {
          origine: "page",
          prenom: d.prenom,
          nom: d.nom,
          email: d.email.toLowerCase(),
          telephone: d.telephone,
          fuseauCliente: fuseau,
          reponses: [],
          utm: {},
          jetonHash: null,
          genre: "premier",
          devisId: d.id,
          dureeMinutes: dureePremier(d),
        },
        Date.now(),
        depot,
        agendas,
        options(d),
      );
  if (!prise.ok) {
    if (prise.raison !== "erreur") return { ok: false, raison: prise.raison };
    console.error("Premier rendez-vous, prise refusée :", prise.message ?? "erreur");
    return { ok: false, raison: "erreur" };
  }

  const espace = await baseEspace(admin, org);
  if (ancien) {
    try {
      await effacerRendezVous(admin, ancien.id, ids);
    } catch (erreur) {
      console.error("Premier rendez-vous, effacement Google :", erreur instanceof Error ? erreur.message : "erreur");
    }
  }
  let lienVisio: string | null = null;
  try {
    lienVisio = (await ecrireRendezVous(admin, prise.id, ids, espace)).lienVisio;
  } catch (erreur) {
    // L'horloge réessaie (`entretien.ts`) ; le mail dit que le lien arrivera.
    console.error("Premier rendez-vous, écriture Google :", erreur instanceof Error ? erreur.message : "erreur");
  }

  const rdv = await premierDuDevis(admin, d.id);
  if (!rdv) return { ok: false, raison: "erreur" };
  const lu = { ...rdv, lienVisio: lienVisio ?? rdv.lienVisio };
  await noter(admin, d.id, ancien ? "premier_deplace" : "premier_reserve", { details: { debut: lu.debut } });
  return { ok: true, rdv: lu, deplace: Boolean(ancien), ancienDebut: ancien?.debut ?? null };
}

/** Le mail à Peggy, après la réponse au site. Ne lève jamais. */
export async function prevenirPeggy(admin: Admin, d: LigneDevis, rdv: PremierRdv, deplace: boolean): Promise<void> {
  try {
    const [closeuse, a] = await Promise.all([closeuseDe(admin, d), adresseTitulaire(admin, d.organization_id)]);
    await envoyer({ ...mailRdvPeggy(d, rdv, deplace ? "deplace" : "nouveau", closeuse), a });
  } catch (erreur) {
    console.error("Premier rendez-vous, mail à Peggy :", erreur instanceof Error ? erreur.message : "erreur");
  }
}

// ------------------------------ L'horloge -----------------------------------

const COLONNES =
  "id, organization_id, closeuse_id, prenom, nom, email, telephone, adresse, objet, duree_mois, paiement, investigation_cents, mensualite_cents, total_cents, paye_le, premier_rappel_le";

/**
 * Toutes les 5 minutes, avec l'horloge de l'agent : le rappel à la cliente
 * qui a payé sans réserver (24 h après, une fois, et un mail à Peggy), et le
 * rappel de la veille d'un premier rendez-vous. Chaque envoi se réserve
 * avant de partir : deux passages ne l'envoient pas deux fois.
 */
export async function horlogePremier(admin: Admin, maintenant = Date.now()): Promise<{ sansRdv: number; veilles: number }> {
  let sansRdv = 0;
  let veilles = 0;

  const depuis = new Date(maintenant - 7 * 86_400_000).toISOString();
  const { data: payes } = await brut(admin)
    .from("devis")
    .select(COLONNES)
    .eq("statut", "signe")
    .is("premier_rappel_le", null)
    .gte("paye_le", depuis);
  for (const d of (payes ?? []) as (DevisPaye & { id: string; organization_id: string; closeuse_id: string | null; premier_rappel_le: string | null })[]) {
    const aUnRdv = await brut(admin)
      .from("reservation_rendez_vous")
      .select("id", { count: "exact", head: true })
      .eq("devis_id", d.id)
      .eq("genre", "premier")
      .then((r: { count: number | null }) => (r.count ?? 0) > 0);
    if (!rappelSansRdvDu(d, aUnRdv, maintenant)) continue;

    const { data: reserve } = await brut(admin)
      .from("devis")
      .update({ premier_rappel_le: new Date(maintenant).toISOString() })
      .eq("id", d.id)
      .is("premier_rappel_le", null)
      .select("id");
    if (!reserve?.length) continue;

    const [p, lien, a] = await Promise.all([profilDe(admin, d.organization_id), lienDe(admin, d.id), adresseTitulaire(admin, d.organization_id)]);
    if (p && lien) await notifierSite(p.site, lien, "rdv_rappel");
    await envoyer({ ...mailSansRdvPeggy(d), a });
    await noter(admin, d.id, "rappel_sans_rdv");
    sansRdv++;
  }

  const { data: rdvs } = await brut(admin)
    .from("reservation_rendez_vous")
    .select("id, organization_id, devis_id, debut, created_at, rappel_le")
    .eq("genre", "premier")
    .eq("statut", "confirme")
    .is("rappel_le", null)
    .gt("debut", new Date(maintenant).toISOString())
    .lt("debut", new Date(maintenant + 2 * 86_400_000).toISOString());
  for (const r of (rdvs ?? []) as { id: string; organization_id: string; devis_id: string | null; debut: string; created_at: string; rappel_le: string | null }[]) {
    if (!r.devis_id || !rappelVeilleDu(r, maintenant)) continue;
    const { data: reserve } = await brut(admin)
      .from("reservation_rendez_vous")
      .update({ rappel_le: new Date(maintenant).toISOString() })
      .eq("id", r.id)
      .is("rappel_le", null)
      .select("id");
    if (!reserve?.length) continue;
    const [p, lien] = await Promise.all([profilDe(admin, r.organization_id), lienDe(admin, r.devis_id)]);
    if (p && lien && (await notifierSite(p.site, lien, "rdv_veille"))) veilles++;
  }

  return { sansRdv, veilles };
}
