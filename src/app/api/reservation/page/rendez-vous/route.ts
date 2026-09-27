import type { NextRequest } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { accesPage, json, rdvDuLien, rdvPourSite, sansCorps } from "@/tools/reservation/acces-page";

/**
 * Le rendez-vous d'une cliente, lu par son lien personnel (celui du mail de
 * confirmation), pour la page « mon rendez-vous » du site. Le lien voyage
 * dans le corps, jamais dans l'adresse : il n'entre pas dans les journaux.
 *
 *   401/429 comme les autres routes de la page.
 *   404  lien inconnu chez ce client.
 *   200  { id, statut, debut, fin, prenom, email, lienVisio, fuseau }.
 */

export const runtime = "nodejs";

const corpsSchema = z.strictObject({ lien: z.string().regex(/^[0-9a-f]{64}$/) });

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const acces = await accesPage(admin, request.headers);
  if (!acces.ok) return sansCorps(acces.code);

  const corps = corpsSchema.safeParse(await request.json().catch(() => null));
  if (!corps.success) return json({ raison: "lien_inconnu" }, 404);

  const rdv = await rdvDuLien(admin, acces.organizationId, corps.data.lien);
  if (!rdv) return json({ raison: "lien_inconnu" }, 404);
  return json(rdvPourSite(rdv));
}
