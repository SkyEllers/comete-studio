"use server";

import { createHash, randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { heureEnMots, jourEnMots } from "@/tools/agent/temps";
import { envoyer } from "@/tools/fichiers/courriel";
import { siteDuClient } from "@/tools/reservation/confier";

import {
  CHAMPS_FICHE,
  FREINS,
  PRETE,
  RESULTATS,
  ficheEnregistree,
  lignesFiche,
  mailCloseuse,
  mailTitulaire,
  manqueR2,
  type ResultatR2,
} from "./regles";

/**
 * Le R2 avec la titulaire (0054, Louis, 07/10/2026). La closeuse le demande
 * depuis « Noter le résultat » ; la titulaire le voit dans Radar, appelle,
 * note ce qu'il a donné. Écritures en service role après contrôle de la
 * session, comme les factures des closeuses (0051).
 */

type Admin = ReturnType<typeof createAdminClient>;
// La table arrive avec 0054 : les types générés ne la connaissent pas encore.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brut = (admin: Admin) => admin as any;

const FUSEAU = "Europe/Paris";
const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");
const prenomDe = (nom: string | null | undefined, defaut: string) => nom?.trim().split(/\s+/)[0] || defaut;

function racine() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.cometestudio.fr").replace(/\/+$/, "");
}

const texte = (max: number) => z.string().trim().max(max, { error: `${max} caractères au plus.` });

const demandeSchema = z.object({
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  fiche: z.object(Object.fromEntries(CHAMPS_FICHE.map((c) => [c.cle, texte(3000).optional()]))),
  freins: z.array(z.enum(FREINS.map((f) => f.cle) as [string, ...string[]])).max(FREINS.length),
  prete: z.enum(PRETE.map((p) => p.cle) as [string, ...string[]], { error: "Dis si elle est prête à avancer." }),
  joindre: texte(500),
  telephone: texte(40),
});

/**
 * L'enregistrement du diagnostic est réglé : une vidéo, « pas
 * d'enregistrement » avec son résumé, ou une issue déjà notée (même règle que
 * `diagnosticRegle` dans les actions de la closeuse).
 */
async function diagnosticRegle(supabase: Awaited<ReturnType<typeof createClient>>, bookingId: string) {
  const [{ data: enregistrement }, { data: rdv }, { data: activites }] = await Promise.all([
    supabase.from("radar_diagnostic_enregistrements").select("booking_id").eq("booking_id", bookingId).maybeSingle(),
    supabase.from("radar_bookings").select("sale_amount_cents").eq("id", bookingId).maybeSingle(),
    supabase
      .from("radar_booking_activities")
      .select("id")
      .eq("booking_id", bookingId)
      .in("type", ["sale.declined", "sale.reason"])
      .limit(1),
  ]);
  return Boolean(enregistrement) || rdv?.sale_amount_cents != null || (activites?.length ?? 0) > 0;
}

/** La titulaire : sa fiche de réservation, son adresse et son prénom. */
async function titulaireDe(admin: Admin, org: string) {
  const { data: personne } = await admin
    .from("reservation_personnes")
    .select("user_id")
    .eq("organization_id", org)
    .eq("role", "titulaire")
    .maybeSingle();
  if (!personne?.user_id) return null;
  const { data: profil } = await admin.from("profiles").select("email, full_name").eq("id", personne.user_id).maybeSingle();
  return profil?.email ? { email: profil.email, prenom: prenomDe(profil.full_name, "Peggy") } : null;
}

/**
 * Le mail à la cliente, envoyé par son site depuis l'adresse de la titulaire
 * (geste `r2` de `/api/rdv/notifier`). Le site ne croit qu'un lien personnel :
 * on en fait un nouveau, comme « Rendre à Peggy » ; le rendez-vous est passé,
 * l'ancien ne servait plus.
 */
async function prevenirClienteR2(admin: Admin, org: string, bookingId: string): Promise<boolean> {
  const site = await siteDuClient(admin, org);
  if (!site) return false;
  const { data: ligne } = await admin
    .from("reservation_rendez_vous")
    .select("id, email")
    .eq("radar_booking_id", bookingId)
    .eq("statut", "confirme")
    .maybeSingle();
  if (!ligne?.email) return false;
  const jeton = randomBytes(32).toString("hex");
  const { error } = await admin.from("reservation_rendez_vous").update({ jeton_hash: empreinte(jeton) }).eq("id", ligne.id);
  if (error) return false;
  try {
    const r = await fetch(`${site.replace(/\/+$/, "")}/api/rdv/notifier`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "comete-hub/r2" },
      body: JSON.stringify({ lien: jeton, geste: "r2" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) console.error("R2 : le site refuse le mail", r.status);
    return r.ok;
  } catch {
    console.error("R2 : le site ne répond pas");
    return false;
  }
}

/** La closeuse demande un R2 avec la titulaire. */
export async function demanderR2(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ mailTitulaire: boolean; mailCliente: boolean }>> {
  const acces = await getMembership(orgSlug);
  if (!acces || (acces.role !== "closeuse" && acces.role !== "admin")) return fail("Cet espace n'est plus accessible.");

  const parsed = demandeSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const d = parsed.data;
  const demande = {
    fiche: d.fiche,
    freins: d.freins as (typeof FREINS)[number]["cle"][],
    prete: d.prete as (typeof PRETE)[number]["cle"],
    joindre: d.joindre,
    telephone: d.telephone,
  };
  const manque = manqueR2(demande);
  if (manque) return fail(manque);

  // Lu avec la session : la closeuse ne voit que ses rendez-vous.
  const supabase = await createClient();
  const { data: rdv } = await supabase
    .from("radar_bookings")
    .select("id, organization_id, closeuse_id, status, scheduled_start, invitee_first_name, invitee_last_name")
    .eq("id", d.bookingId)
    .maybeSingle();
  if (!rdv || rdv.organization_id !== acces.org.id || !rdv.closeuse_id) return fail("Rendez-vous introuvable.");
  if (acces.role === "closeuse" && rdv.closeuse_id !== acces.userId) return fail("Ce rendez-vous ne t'est pas confié.");
  if (rdv.status !== "confirme" || Date.parse(rdv.scheduled_start) > Date.now()) {
    return fail("Le R2 se demande après le diagnostic.");
  }
  if (!(await diagnosticRegle(supabase, d.bookingId))) {
    return fail("Dépose l'enregistrement du diagnostic, ou dis que tu n'en as pas et écris le résumé.");
  }

  const admin = createAdminClient();
  const { data: deja } = await brut(admin).from("radar_r2").select("booking_id").eq("booking_id", d.bookingId).maybeSingle();
  if (deja) return fail("Le R2 est déjà demandé pour ce rendez-vous.");

  const fiche = ficheEnregistree(demande);
  const { error } = await brut(admin).from("radar_r2").insert({
    booking_id: d.bookingId,
    organization_id: acces.org.id,
    closeuse_id: rdv.closeuse_id,
    fiche,
    joindre: d.joindre,
    telephone: d.telephone,
  });
  if (error) return fail("Le R2 n'a pas pu être enregistré.");

  const cliente = [rdv.invitee_first_name, rdv.invitee_last_name].filter(Boolean).join(" ") || "Une cliente";
  const { data: profilCloseuse } = await admin.from("profiles").select("full_name").eq("id", rdv.closeuse_id).maybeSingle();
  const titulaire = await titulaireDe(admin, acces.org.id);
  let mailT = false;
  if (titulaire) {
    const m = mailTitulaire({
      prenomTitulaire: titulaire.prenom,
      cliente,
      closeuse: prenomDe(profilCloseuse?.full_name, "Ta closeuse"),
      quandRdv: `le ${jourEnMots(rdv.scheduled_start, FUSEAU)} à ${heureEnMots(rdv.scheduled_start, FUSEAU)}`,
      telephone: d.telephone,
      joindre: d.joindre,
      fiche,
      lienRadar: `${racine()}/app/${orgSlug}/resultats`,
    });
    mailT = await envoyer({ ...m, a: [titulaire.email] });
  }
  const mailC = await prevenirClienteR2(admin, acces.org.id, d.bookingId);
  await brut(admin).from("radar_r2").update({ mail_titulaire: mailT, mail_cliente: mailC }).eq("booking_id", d.bookingId);

  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok({ mailTitulaire: mailT, mailCliente: mailC });
}

export type R2Titulaire = {
  bookingId: string;
  cliente: string;
  closeuse: string;
  rdvDebut: string;
  demandeeLe: string;
  telephone: string | null;
  joindre: string;
  lignes: { libelle: string; texte: string }[];
  resultat: ResultatR2 | null;
  appeleeLe: string | null;
  note: string | null;
};

async function accesTitulaire(orgSlug: string) {
  const acces = await getMembership(orgSlug);
  if (!acces || acces.role === "closeuse") return null;
  const supabase = await createClient();
  const { data: peut } = await supabase.rpc("can_access_radar", { org: acces.org.id } as never);
  return peut === true ? acces : null;
}

/** Les R2 à rappeler, et ceux faits depuis 30 jours. */
export async function lireR2Titulaire(orgSlug: string): Promise<ActionResult<R2Titulaire[]>> {
  const acces = await accesTitulaire(orgSlug);
  if (!acces) return fail("Cet espace n'est plus accessible.");
  const admin = createAdminClient();
  const depuis = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await brut(admin)
    .from("radar_r2")
    .select("booking_id, closeuse_id, fiche, joindre, telephone, demandee_le, resultat, note_titulaire, appelee_le")
    .eq("organization_id", acces.org.id)
    .or(`appelee_le.is.null,appelee_le.gte.${depuis}`)
    .order("demandee_le", { ascending: true })
    .limit(100);
  if (error) return ok([]);
  const lignes = (data ?? []) as {
    booking_id: string;
    closeuse_id: string;
    fiche: Record<string, string>;
    joindre: string;
    telephone: string | null;
    demandee_le: string;
    resultat: ResultatR2 | null;
    note_titulaire: string | null;
    appelee_le: string | null;
  }[];
  if (!lignes.length) return ok([]);
  const [{ data: rdvs }, { data: profils }] = await Promise.all([
    admin
      .from("radar_bookings")
      .select("id, scheduled_start, invitee_first_name, invitee_last_name")
      .in("id", lignes.map((l) => l.booking_id)),
    admin.from("profiles").select("id, full_name").in("id", [...new Set(lignes.map((l) => l.closeuse_id))]),
  ]);
  const rdvDe = new Map((rdvs ?? []).map((r) => [r.id, r]));
  const nomDe = new Map((profils ?? []).map((p) => [p.id, prenomDe(p.full_name, "Closeuse")]));
  return ok(
    lignes.map((l) => {
      const rdv = rdvDe.get(l.booking_id);
      return {
        bookingId: l.booking_id,
        cliente: [rdv?.invitee_first_name, rdv?.invitee_last_name].filter(Boolean).join(" ") || "Une cliente",
        closeuse: nomDe.get(l.closeuse_id) ?? "Closeuse",
        rdvDebut: rdv?.scheduled_start ?? l.demandee_le,
        demandeeLe: l.demandee_le,
        telephone: l.telephone,
        joindre: l.joindre,
        lignes: lignesFiche(l.fiche ?? {}),
        resultat: l.resultat,
        appeleeLe: l.appelee_le,
        note: l.note_titulaire,
      };
    }),
  );
}

const appelSchema = z.object({
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  resultat: z.enum(RESULTATS.map((r) => r.cle) as [string, ...string[]], { error: "Dis ce que l'appel a donné." }),
  note: texte(2000).optional(),
});

/** La titulaire a appelé : ce que ça a donné. La closeuse est prévenue par mail. */
export async function noterAppelR2(orgSlug: string, input: unknown): Promise<ActionResult<{ mailCloseuse: boolean }>> {
  const acces = await accesTitulaire(orgSlug);
  if (!acces) return fail("Cet espace n'est plus accessible.");
  const parsed = appelSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { bookingId } = parsed.data;
  const resultat = parsed.data.resultat as ResultatR2;
  const note = parsed.data.note?.trim() || null;

  const admin = createAdminClient();
  const { data: r2 } = await brut(admin)
    .from("radar_r2")
    .select("booking_id, organization_id, closeuse_id, resultat, appelee_le")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (!r2 || r2.organization_id !== acces.org.id) return fail("Ce R2 est introuvable.");

  const { error } = await brut(admin)
    .from("radar_r2")
    .update({ resultat, note_titulaire: note, appelee_le: r2.appelee_le ?? new Date().toISOString() })
    .eq("booking_id", bookingId);
  if (error) return fail("Ça n'a pas pu être noté.");

  let mailC = false;
  if (r2.resultat !== resultat) {
    const [{ data: rdv }, { data: closeuse }, titulaire] = await Promise.all([
      admin.from("radar_bookings").select("invitee_first_name, invitee_last_name").eq("id", bookingId).maybeSingle(),
      admin.from("profiles").select("email, full_name").eq("id", r2.closeuse_id).maybeSingle(),
      titulaireDe(admin, acces.org.id),
    ]);
    if (closeuse?.email) {
      const m = mailCloseuse({
        prenomCloseuse: prenomDe(closeuse.full_name, ""),
        titulaire: titulaire?.prenom ?? "Peggy",
        cliente: [rdv?.invitee_first_name, rdv?.invitee_last_name].filter(Boolean).join(" ") || "ta cliente",
        resultat,
        note,
        lienEspace: `${racine()}/app/${orgSlug}/closeuse`,
      });
      mailC = await envoyer({ ...m, a: [closeuse.email] });
      await brut(admin).from("radar_r2").update({ mail_closeuse: mailC }).eq("booking_id", bookingId);
    }
  }

  revalidatePath(`/app/${orgSlug}/resultats`);
  return ok({ mailCloseuse: mailC });
}
