"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { accepterFacture, acheteurDe, marquerPayee, type LigneFacture } from "./factures";
import { acheteurComplet, sirenValide, texteMandat, VERSION_MANDAT } from "./factures-regles";

/**
 * Les factures des closeuses (P16, 0051). La closeuse : son identité de
 * facturation et le mandat, puis « J'accepte » sur chaque facture. Le client :
 * ce qu'il doit, et « Payée » après son virement.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brut = (admin: ReturnType<typeof createAdminClient>) => admin as any;

async function visiteuse() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 64) || null;
  return { ip, agent: h.get("user-agent")?.slice(0, 400) ?? null };
}

export type FactureVue = {
  id: string;
  userId: string;
  nom: string;
  mois: string;
  numero: string;
  totalCents: number;
  statut: LigneFacture["statut"];
  accepteeLe: string | null;
  payeeLe: string | null;
};

export type FacturesCloseuse = {
  identite: { nomLegal: string; siren: string; adresse: string; mandatLe: string } | null;
  mandat: { titre?: string; paragraphes?: string[] }[];
  acheteurPret: boolean;
  factures: FactureVue[];
};

const vue = (f: LigneFacture, nom: string): FactureVue => ({
  id: f.id,
  userId: f.user_id,
  nom,
  mois: f.mois,
  numero: f.numero,
  totalCents: f.total_cents,
  statut: f.statut,
  accepteeLe: f.acceptee_le,
  payeeLe: f.payee_le,
});

/** Ce que la closeuse voit dans « Ma commission ». */
export async function lireMesFactures(orgSlug: string): Promise<ActionResult<FacturesCloseuse>> {
  const acces = await getMembership(orgSlug);
  if (!acces || acces.role !== "closeuse") return fail("Cet espace n'est plus accessible.");
  const admin = createAdminClient();
  const [{ data: identite }, { data: factures }, acheteur] = await Promise.all([
    brut(admin)
      .from("closeuse_facturation")
      .select("nom_legal, siren, adresse, mandat_accepte_le")
      .eq("organization_id", acces.org.id)
      .eq("user_id", acces.userId)
      .maybeSingle(),
    brut(admin)
      .from("closeuse_factures")
      .select("*")
      .eq("organization_id", acces.org.id)
      .eq("user_id", acces.userId)
      .neq("statut", "annulee")
      .order("mois", { ascending: false }),
    acheteurDe(admin, acces.org.id),
  ]);
  return ok({
    identite: identite
      ? { nomLegal: identite.nom_legal, siren: identite.siren, adresse: identite.adresse, mandatLe: identite.mandat_accepte_le }
      : null,
    mandat: texteMandat(acheteur?.nom ?? ""),
    acheteurPret: acheteurComplet(acheteur),
    factures: ((factures ?? []) as LigneFacture[]).map((f) => vue(f, "")),
  });
}

const identiteSchema = z.object({
  nomLegal: z.string().trim().min(3, { error: "Écris ton nom tel qu'il figure sur ton avis de situation (avec EI)." }).max(150),
  siren: z.string().transform((s) => s.replace(/\s+/g, "")),
  adresse: z.string().trim().min(8, { error: "Écris ton adresse complète." }).max(400),
  accepte: z.literal(true, { error: "Coche la case pour accepter le mandat." }),
});

/** À son arrivée : son identité de facturation et le mandat d'autofacturation. */
export async function enregistrerFacturation(orgSlug: string, input: unknown): Promise<ActionResult> {
  const acces = await getMembership(orgSlug);
  if (!acces || acces.role !== "closeuse") return fail("Cet espace n'est plus accessible.");
  const parsed = identiteSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  if (!sirenValide(parsed.data.siren)) return fail("Ce numéro SIREN ne semble pas juste : 9 chiffres, sans espace.", "siren");
  const nom = /\bEI\b/.test(parsed.data.nomLegal) ? parsed.data.nomLegal : `${parsed.data.nomLegal} EI`;
  const v = await visiteuse();

  const { error } = await brut(createAdminClient())
    .from("closeuse_facturation")
    .upsert({
      organization_id: acces.org.id,
      user_id: acces.userId,
      nom_legal: nom,
      siren: parsed.data.siren,
      adresse: parsed.data.adresse,
      mandat_version: VERSION_MANDAT,
      mandat_accepte_le: new Date().toISOString(),
      mandat_ip: v.ip,
      mandat_agent: v.agent,
    });
  if (error) return fail("Tes informations n'ont pas pu être enregistrées.");
  return ok();
}

const idSchema = z.uuid({ error: "Facture introuvable." });

/** « J'accepte » sur une facture. */
export async function accepterMaFacture(orgSlug: string, factureId: string): Promise<ActionResult> {
  const acces = await getMembership(orgSlug);
  if (!acces || acces.role !== "closeuse") return fail("Cet espace n'est plus accessible.");
  const parsed = idSchema.safeParse(factureId);
  if (!parsed.success) return failFromZod(parsed.error);
  const admin = createAdminClient();
  const { data: f } = await brut(admin)
    .from("closeuse_factures")
    .select("*")
    .eq("id", parsed.data)
    .eq("organization_id", acces.org.id)
    .eq("user_id", acces.userId)
    .maybeSingle();
  if (!f) return fail("Facture introuvable.");
  const v = await visiteuse();
  if (!(await accepterFacture(admin, f as LigneFacture, v.ip, v.agent))) return fail("Cette facture ne s'accepte plus.");
  return ok();
}

/** Ce que le client doit à ses closeuses : factures acceptées, pas encore payées, et les dernières payées. */
export async function lireFacturesClient(orgSlug: string): Promise<ActionResult<FactureVue[]>> {
  const acces = await getMembership(orgSlug);
  if (!acces || acces.role === "closeuse") return fail("Cet espace n'est plus accessible.");
  const supabase = await createClient();
  const { data: peut } = await supabase.rpc("can_access_radar", { org: acces.org.id } as never);
  if (peut !== true) return fail("Cet espace n'est plus accessible.");
  const admin = createAdminClient();
  const { data: factures } = await brut(admin)
    .from("closeuse_factures")
    .select("*")
    .eq("organization_id", acces.org.id)
    .in("statut", ["a_accepter", "acceptee", "payee"])
    .order("mois", { ascending: false })
    .limit(30);
  const lignes = (factures ?? []) as LigneFacture[];
  const ids = [...new Set(lignes.map((f) => f.user_id))];
  const { data: profils } = ids.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nomDe = new Map((profils ?? []).map((p) => [p.id, p.full_name || p.email || "Closeuse"]));
  return ok(lignes.map((f) => vue(f, nomDe.get(f.user_id) ?? "Closeuse")));
}

/** Le client a fait le virement. */
export async function marquerFacturePayee(orgSlug: string, factureId: string): Promise<ActionResult> {
  const acces = await getMembership(orgSlug);
  if (!acces || acces.role === "closeuse") return fail("Cet espace n'est plus accessible.");
  const supabase = await createClient();
  const { data: peut } = await supabase.rpc("can_access_radar", { org: acces.org.id } as never);
  if (peut !== true) return fail("Cet espace n'est plus accessible.");
  const parsed = idSchema.safeParse(factureId);
  if (!parsed.success) return failFromZod(parsed.error);
  const admin = createAdminClient();
  const { data: f } = await brut(admin)
    .from("closeuse_factures")
    .select("*")
    .eq("id", parsed.data)
    .eq("organization_id", acces.org.id)
    .maybeSingle();
  if (!f) return fail("Facture introuvable.");
  if (!(await marquerPayee(admin, f as LigneFacture))) return fail("Seule une facture acceptée se marque payée.");
  return ok();
}
