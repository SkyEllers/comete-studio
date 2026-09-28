import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { pdfDeLaFacture, type LigneFacture } from "@/tools/closeuse/factures";

/**
 * Le PDF d'une facture de closeuse (0051) : pour elle, et pour le client ou
 * Louis. Le droit se lit avec la session (RLS de `closeuse_factures`) ; le
 * fichier, avec le serveur (le bucket n'a aucune politique).
 */

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const { org } = await requireMembership(orgSlug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: visible } = await (supabase as any)
    .from("closeuse_factures")
    .select("id")
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!visible) notFound();

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: f } = await (admin as any).from("closeuse_factures").select("*").eq("id", id).maybeSingle();
  if (!f) notFound();
  const pdf = await pdfDeLaFacture(admin, f as LigneFacture);

  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="facture-${(f as LigneFacture).numero}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
