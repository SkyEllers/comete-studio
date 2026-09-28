import "server-only";

import { createHash } from "node:crypto";

import type { createAdminClient } from "@/lib/supabase/admin";
import { envoyer } from "@/tools/fichiers/courriel";

import { calculer, releveDuMois, type Grille, type Incident, type Vente } from "./commission";
import {
  ACHETEURS,
  acheteurComplet,
  moisEcoule,
  moisEnMots,
  numeroFacture,
  pdfFacture,
  rappelFactureDu,
  totalFacture,
  type Acheteur,
  type ContenuFacture,
  type LignesFacture,
  type Vendeuse,
} from "./factures-regles";
import { GRILLE_PAR_DEFAUT } from "./queries";

/**
 * Les factures des closeuses en autofacturation (P16, 0051) : les créer le
 * 1er du mois, les faire accepter, les relancer, les marquer payées. Le
 * serveur écrit (service role) ; les droits se vérifient dans les actions.
 */

type Admin = ReturnType<typeof createAdminClient>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brut = (admin: Admin) => admin as any;

const PARIS = "Europe/Paris";
const jourParis = (instant: number) => new Intl.DateTimeFormat("en-CA", { timeZone: PARIS }).format(new Date(instant));

export type LigneFacture = {
  id: string;
  organization_id: string;
  user_id: string;
  mois: string;
  rang: number;
  numero: string;
  total_cents: number;
  lignes: LignesFacture;
  vendeur: Vendeuse;
  acheteur: Acheteur;
  statut: "a_accepter" | "acceptee" | "payee" | "annulee";
  creee_le: string;
  acceptee_le: string | null;
  acceptee_ip: string | null;
  relance_le: string | null;
  relances: number;
  payee_le: string | null;
  pdf_chemin: string | null;
};

export async function acheteurDe(admin: Admin, organizationId: string): Promise<Acheteur | null> {
  const { data } = await admin.from("organizations").select("slug").eq("id", organizationId).maybeSingle();
  return data?.slug ? (ACHETEURS[data.slug] ?? null) : null;
}

/** La commission d'une closeuse, lue par le serveur (même calcul que son espace). */
export async function commissionServeur(admin: Admin, organizationId: string, userId: string, aujourdhui: string) {
  const [{ data: reglage }, { data: lignes }] = await Promise.all([
    admin
      .from("radar_closeuses")
      .select("taux, taux_palier, palier_apres")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("radar_bookings_effective")
      .select("id, invitee_display, scheduled_start, effective_status, sale_amount_cents, sale_date, sale_fois")
      .eq("organization_id", organizationId)
      .eq("closeuse_id", userId),
  ]);
  const ids = (lignes ?? []).map((l) => l.id).filter((id): id is string => Boolean(id));
  const [{ data: premiers }, { data: incidents }] = ids.length
    ? await Promise.all([
        admin.from("radar_bookings").select("id, sale_premier_cents").in("id", ids),
        admin.from("radar_encaissement_incidents").select("booking_id, numero, type").in("booking_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const premierPar = new Map((premiers ?? []).map((p) => [p.id, p.sale_premier_cents]));

  const grille: Grille = reglage
    ? { taux: Number(reglage.taux), tauxPalier: Number(reglage.taux_palier), palierApres: reglage.palier_apres }
    : GRILLE_PAR_DEFAUT;
  const ventes: Vente[] = (lignes ?? [])
    .filter(
      (l) =>
        l.id && l.sale_amount_cents != null && l.sale_date && l.effective_status !== "annule" && l.effective_status !== "no_show",
    )
    .map((l) => ({
      bookingId: l.id as string,
      prenom: l.invitee_display ?? "Cliente",
      rendezVous: l.scheduled_start as string,
      dateVente: l.sale_date as string,
      montantCents: l.sale_amount_cents as number,
      fois: l.sale_fois ?? 1,
      premierCents: premierPar.get(l.id as string) ?? null,
    }));
  const listeIncidents: Incident[] = (incidents ?? []).map((i) => ({
    bookingId: i.booking_id,
    numero: i.numero,
    type: i.type as Incident["type"],
  }));
  return calculer(ventes, listeIncidents, grille, aujourdhui);
}

/**
 * Le 1er du mois (et chaque passage suivant, tant qu'elle manque) : la facture
 * du mois écoulé de chaque closeuse qui a accepté le mandat. Rien si
 * l'acheteur n'est pas complet (dénomination, SIREN), rien si le mois est vide.
 * Rend le nombre de factures créées.
 */
export async function creerFacturesDuMois(admin: Admin, maintenant = Date.now()): Promise<number> {
  const aujourdhui = jourParis(maintenant);
  const mois = moisEcoule(aujourdhui);
  const { data: mandats } = await brut(admin)
    .from("closeuse_facturation")
    .select("organization_id, user_id, nom_legal, siren, adresse, mention_tva");
  let creees = 0;
  for (const m of (mandats ?? []) as { organization_id: string; user_id: string; nom_legal: string; siren: string; adresse: string; mention_tva: string }[]) {
    const acheteur = await acheteurDe(admin, m.organization_id);
    if (!acheteurComplet(acheteur)) continue;

    const { data: deja } = await brut(admin)
      .from("closeuse_factures")
      .select("id")
      .eq("organization_id", m.organization_id)
      .eq("user_id", m.user_id)
      .eq("mois", mois)
      .maybeSingle();
    if (deja) continue;

    const releve = releveDuMois(await commissionServeur(admin, m.organization_id, m.user_id, aujourdhui), mois.slice(0, 7));
    const lignes: LignesFacture = { paiements: releve.paiements, reprises: releve.reprises };
    const total = totalFacture(lignes);
    if (lignes.paiements.length === 0 && lignes.reprises.length === 0) continue;
    if (total <= 0) continue;

    const { data: derniere } = await brut(admin)
      .from("closeuse_factures")
      .select("rang")
      .eq("organization_id", m.organization_id)
      .eq("user_id", m.user_id)
      .order("rang", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rang = ((derniere?.rang as number | undefined) ?? 0) + 1;
    const { data: profil } = await admin.from("profiles").select("email").eq("id", m.user_id).maybeSingle();

    const { error } = await brut(admin)
      .from("closeuse_factures")
      .insert({
        organization_id: m.organization_id,
        user_id: m.user_id,
        mois,
        rang,
        numero: numeroFacture(m.nom_legal, mois, rang),
        total_cents: total,
        lignes,
        vendeur: { nomLegal: m.nom_legal, siren: m.siren, adresse: m.adresse, mentionTva: m.mention_tva, email: profil?.email ?? null },
        acheteur,
      });
    if (error) {
      // Deux passages en même temps : la contrainte d'unicité garde une seule facture.
      if (!/duplicate|unique/i.test(error.message)) console.error("Factures, création :", error.message);
      continue;
    }
    creees++;
    if (profil?.email) {
      await envoyer({
        a: [profil.email],
        sujet: `Ta facture de ${moisEnMots(mois)} est prête`,
        texte: `Bonjour,\n\nTa facture de commissions de ${moisEnMots(mois)} est prête dans ton espace. Relis-la, puis clique sur « J'accepte » : c'est ce qui déclenche ton paiement.\n\nhttps://app.cometestudio.fr/app\n`,
        html: `<p>Bonjour,</p><p>Ta facture de commissions de ${moisEnMots(mois)} est prête dans ton espace. Relis-la, puis clique sur « J'accepte » : c'est ce qui déclenche ton paiement.</p><p><a href="https://app.cometestudio.fr/app">Ouvrir mon espace</a></p>`,
      });
    }
  }
  return creees;
}

/** Le rappel d'une facture pas encore acceptée, tous les deux jours. */
export async function relancerFactures(admin: Admin, maintenant = Date.now()): Promise<number> {
  const { data } = await brut(admin)
    .from("closeuse_factures")
    .select("id, user_id, mois, statut, creee_le, relance_le, relances")
    .eq("statut", "a_accepter");
  let partis = 0;
  for (const f of (data ?? []) as Pick<LigneFacture, "id" | "user_id" | "mois" | "statut" | "creee_le" | "relance_le" | "relances">[]) {
    if (!rappelFactureDu(f, maintenant)) continue;
    const { data: reserve } = await brut(admin)
      .from("closeuse_factures")
      .update({ relance_le: new Date(maintenant).toISOString(), relances: f.relances + 1 })
      .eq("id", f.id)
      .eq("relances", f.relances)
      .select("id");
    if (!reserve?.length) continue;
    const { data: profil } = await admin.from("profiles").select("email").eq("id", f.user_id).maybeSingle();
    if (!profil?.email) continue;
    const ok = await envoyer({
      a: [profil.email],
      sujet: `Ta facture de ${moisEnMots(f.mois)} attend ton accord`,
      texte: `Bonjour,\n\nTa facture de ${moisEnMots(f.mois)} n'est pas encore acceptée. Tant qu'elle ne l'est pas, elle ne peut pas t'être payée. Un clic sur « J'accepte » dans ton espace suffit.\n\nhttps://app.cometestudio.fr/app\n`,
      html: `<p>Bonjour,</p><p>Ta facture de ${moisEnMots(f.mois)} n'est pas encore acceptée. Tant qu'elle ne l'est pas, elle ne peut pas t'être payée. Un clic sur « J'accepte » dans ton espace suffit.</p><p><a href="https://app.cometestudio.fr/app">Ouvrir mon espace</a></p>`,
    });
    if (ok) partis++;
  }
  return partis;
}

function contenuDe(f: LigneFacture): ContenuFacture {
  return {
    numero: f.numero,
    date: jourParis(Date.parse(f.creee_le)),
    mois: f.mois,
    vendeuse: f.vendeur,
    acheteur: f.acheteur,
    lignes: f.lignes,
    totalCents: f.total_cents,
  };
}

/** Le PDF de la facture (refait s'il manque). */
export async function pdfDeLaFacture(admin: Admin, f: LigneFacture): Promise<Uint8Array> {
  if (f.pdf_chemin) {
    const { data } = await admin.storage.from("factures").download(f.pdf_chemin);
    if (data) return new Uint8Array(await data.arrayBuffer());
  }
  return pdfFacture(contenuDe(f), f.acceptee_le ? { le: f.acceptee_le, ip: f.acceptee_ip } : null);
}

/** « J'accepte » : la facture est figée, son PDF rangé. */
export async function accepterFacture(
  admin: Admin,
  f: LigneFacture,
  ip: string | null,
  agent: string | null,
): Promise<boolean> {
  if (f.statut !== "a_accepter") return f.statut === "acceptee" || f.statut === "payee";
  const le = new Date().toISOString();
  const { data } = await brut(admin)
    .from("closeuse_factures")
    .update({ statut: "acceptee", acceptee_le: le, acceptee_ip: ip, acceptee_agent: agent })
    .eq("id", f.id)
    .eq("statut", "a_accepter")
    .select("id");
  if (!data?.length) return true;
  try {
    const pdf = await pdfFacture(contenuDe({ ...f, acceptee_le: le }), { le, ip });
    const chemin = `${f.organization_id}/${f.user_id}/${f.numero}.pdf`;
    const { error } = await admin.storage.from("factures").upload(chemin, pdf, { contentType: "application/pdf", upsert: true });
    if (!error) {
      await brut(admin)
        .from("closeuse_factures")
        .update({ pdf_chemin: chemin, empreinte_pdf: createHash("sha256").update(pdf).digest("hex") })
        .eq("id", f.id);
    }
  } catch (erreur) {
    console.error("Factures, PDF :", erreur instanceof Error ? erreur.message : "erreur");
  }
  return true;
}

export async function marquerPayee(admin: Admin, f: LigneFacture): Promise<boolean> {
  if (f.statut !== "acceptee") return false;
  const { data } = await brut(admin)
    .from("closeuse_factures")
    .update({ statut: "payee", payee_le: new Date().toISOString() })
    .eq("id", f.id)
    .eq("statut", "acceptee")
    .select("id");
  return Boolean(data?.length);
}
