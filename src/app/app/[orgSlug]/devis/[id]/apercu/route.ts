import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { contenuDe, profilDe, type LigneDevis } from "@/tools/devis/moteur";
import { pdfDuDevis } from "@/tools/devis/pdf";

/**
 * L'aperçu d'un devis (Louis, 07/10/2026) : le même texte que la cliente, en
 * PDF marqué « aperçu », pour que la closeuse le lise avec elle en partage
 * d'écran. Il ne passe pas par le lien de la cliente : il ne compte pas comme
 * une ouverture et ne se signe pas. Même droit que le PDF signé (RLS de
 * `devis`, 0050).
 */

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const { org } = await requireMembership(orgSlug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: visible } = await (supabase as any).from("devis").select("id").eq("id", id).eq("organization_id", org.id).maybeSingle();
  if (!visible) notFound();

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: d } = await (admin as any).from("devis").select("*").eq("id", id).maybeSingle();
  const profil = await profilDe(admin, org.id);
  if (!d || !profil || d.statut === "annule") notFound();
  const pdf = await pdfDuDevis(contenuDe(profil, d as LigneDevis), null);

  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="apercu-devis-${(d as LigneDevis).prenom.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-")}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
