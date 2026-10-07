"use server";

import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { rendezVousAccessible } from "@/tools/fiche/acces";

import { creerDevis, envoyerDevis, noter, prevenirCliente, profilDe } from "./moteur";
import { montants, type Paiement } from "./regles";

/**
 * Le bloc « Le devis » de la fiche d'un rendez-vous (P16) : lire où en est le
 * devis, l'envoyer, le renvoyer. Qui peut : ceux qui peuvent saisir sur le
 * rendez-vous (`radar_peut_saisir`, 0036), vérifié avec la session de la
 * personne ; ensuite, le serveur écrit.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brut = (admin: ReturnType<typeof createAdminClient>) => admin as any;

const idSchema = z.uuid({ error: "Rendez-vous introuvable." });


export type EtatDevis = {
  id: string;
  statut: "envoye" | "signe" | "expire" | "annule";
  prenom: string;
  email: string;
  dureeMois: number;
  /** La cliente ne prend que l'investigation (Louis, 07/10/2026). */
  investigationSeule: boolean;
  paiement: Paiement;
  totalCents: number;
  envoyeLe: string;
  ouvertLe: string | null;
  relances: number;
  valideJusquAu: string;
  signeLe: string | null;
  payeLe: string | null;
  paiementLienLe: string | null;
  mailParti: boolean;
};

export type BlocDevisDonnees = {
  disponible: boolean;
  devis: EtatDevis | null;
  preRempli: { prenom: string; nom: string; email: string; telephone: string };
  dureeParDefaut: number;
  tarifs: { investigationCents: number; mensualiteCents: number; remiseUneFoisCents: number } | null;
};

export async function lireBlocDevis(orgSlug: string, bookingId: string): Promise<ActionResult<BlocDevisDonnees>> {
  const parsed = idSchema.safeParse(bookingId);
  if (!parsed.success) return failFromZod(parsed.error);
  const lu = await rendezVousAccessible(orgSlug, parsed.data);
  if (!lu) return fail("Ce rendez-vous ne t'est pas accessible.");

  const admin = createAdminClient();
  const profil = await profilDe(admin, lu.rdv.organization_id);
  const [{ data: dernier }, { data: resa }] = await Promise.all([
    brut(admin)
      .from("devis")
      .select("id, statut, prenom, email, duree_mois, mensualite_cents, paiement, total_cents, envoye_le, ouvert_le, relances, valide_jusqu_au, signe_le, paye_le, paiement_lien_le")
      .eq("booking_id", lu.rdv.id)
      .neq("statut", "annule")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("reservation_rendez_vous")
      .select("prenom, nom, email, telephone")
      .eq("radar_booking_id", lu.rdv.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let mailParti = false;
  if (dernier) {
    const { count } = await brut(admin)
      .from("devis_evenements")
      .select("id", { count: "exact", head: true })
      .eq("devis_id", dernier.id)
      .eq("genre", "envoye");
    mailParti = (count ?? 0) > 0;
  }

  return ok({
    disponible: Boolean(profil),
    devis: dernier
      ? {
          id: dernier.id,
          statut: dernier.statut,
          prenom: dernier.prenom,
          email: dernier.email,
          dureeMois: dernier.duree_mois,
          investigationSeule: dernier.mensualite_cents === 0,
          paiement: dernier.paiement,
          totalCents: dernier.total_cents,
          envoyeLe: dernier.envoye_le,
          ouvertLe: dernier.ouvert_le,
          relances: dernier.relances,
          valideJusquAu: dernier.valide_jusqu_au,
          signeLe: dernier.signe_le,
          payeLe: dernier.paye_le,
          paiementLienLe: dernier.paiement_lien_le,
          mailParti,
        }
      : null,
    preRempli: {
      prenom: resa?.prenom ?? lu.rdv.invitee_first_name ?? "",
      nom: resa?.nom ?? lu.rdv.invitee_last_name ?? "",
      email: resa?.email ?? "",
      telephone: resa?.telephone ?? "",
    },
    dureeParDefaut: profil?.dureeParDefaut ?? 6,
    tarifs: profil
      ? {
          investigationCents: profil.investigationCents,
          mensualiteCents: profil.mensualiteCents,
          remiseUneFoisCents: profil.remiseUneFoisCents,
        }
      : null,
  });
}

const envoiSchema = z.object({
  bookingId: idSchema,
  prenom: z.string().trim().min(1, { error: "Écris son prénom." }).max(100),
  nom: z.string().trim().max(100),
  email: z.email({ error: "Son adresse mail ne ressemble pas à une adresse mail." }).max(254),
  telephone: z.string().trim().max(40),
  // 0 : l'investigation seule (`INVESTIGATION_SEULE`).
  dureeMois: z.coerce.number().int().min(0, { error: "La durée va de 1 à 24 mois." }).max(24, { error: "La durée va de 1 à 24 mois." }),
  paiement: z.enum(["une_fois", "plusieurs"], { error: "Choisis en 1 fois ou en plusieurs fois." }),
});

/** « Envoyer le devis » : il se crée, puis le site l'envoie à la cliente. */
export async function envoyerLeDevis(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ totalCents: number; mailParti: boolean }>> {
  const parsed = envoiSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const q = parsed.data;

  const lu = await rendezVousAccessible(orgSlug, q.bookingId);
  if (!lu) return fail("Ce rendez-vous ne t'est pas accessible.");
  if (lu.rdv.status === "annule" || lu.rdv.status === "no_show") {
    return fail("Cette séance est annulée ou n'a pas eu lieu : pas de devis.");
  }

  const admin = createAdminClient();
  const cree = await creerDevis(admin, {
    organizationId: lu.rdv.organization_id,
    bookingId: lu.rdv.id,
    closeuseId: lu.rdv.closeuse_id,
    creePar: lu.acces.userId,
    prenom: q.prenom,
    nom: q.nom || null,
    email: q.email.toLowerCase(),
    telephone: q.telephone || null,
    dureeMois: q.dureeMois,
    paiement: q.paiement,
  });
  if ("erreur" in cree) return fail(cree.erreur);

  const mailParti = await envoyerDevis(admin, lu.rdv.organization_id, cree.id, cree.lien);
  const profil = await profilDe(admin, lu.rdv.organization_id);
  return ok({ totalCents: profil ? montants(profil, q.dureeMois, q.paiement).totalCents : 0, mailParti });
}

/** Le mail n'est pas parti (site injoignable) : on le redemande. */
export async function renvoyerLeDevis(orgSlug: string, bookingId: string, devisId: string): Promise<ActionResult> {
  const lu = await rendezVousAccessible(orgSlug, bookingId);
  if (!lu) return fail("Ce rendez-vous ne t'est pas accessible.");
  const admin = createAdminClient();
  const { data: d } = await brut(admin)
    .from("devis")
    .select("id, statut, booking_id")
    .eq("id", devisId)
    .eq("booking_id", lu.rdv.id)
    .maybeSingle();
  if (!d || d.statut !== "envoye") return fail("Ce devis ne s'envoie plus.");
  const [{ data: l }, profil] = await Promise.all([
    brut(admin).from("devis_liens").select("lien").eq("devis_id", d.id).maybeSingle(),
    profilDe(admin, lu.rdv.organization_id),
  ]);
  if (!l?.lien || !profil) return fail("Ce devis ne s'envoie plus.");
  if (!(await prevenirCliente(profil, l.lien, "envoi"))) return fail("Le mail n'est pas parti : réessaie dans un instant.");
  await noter(admin, d.id, "envoye", { details: { renvoi: true } });
  return ok();
}
