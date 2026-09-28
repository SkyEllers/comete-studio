import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { pdfSigne, profilDe, type LigneDevis } from "@/tools/devis/moteur";

/**
 * Le PDF signé d'un devis, pour Peggy, Louis ou la closeuse du rendez-vous.
 * Le droit se lit avec la session (RLS de `devis`, 0050) ; le fichier, avec
 * le serveur (le bucket n'a aucune politique).
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
  if (!d || !profil) notFound();
  const pdf = await pdfSigne(admin, profil, d as LigneDevis);
  if (!pdf) notFound();

  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="devis-${(d as LigneDevis).prenom.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-")}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
