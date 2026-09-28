import "server-only";

import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { accesPage, json, sansCorps } from "@/tools/reservation/acces-page";

import { devisDuLien, profilDe, type LigneDevis } from "./moteur.ts";
import { lienValide, type ProfilDevis } from "./regles.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Qui appelle les routes du devis : le site du client, avec le même jeton que
 * la page de réservation (`reservation_jetons`, 0045). Le devis se désigne
 * par le lien personnel de la cliente, chez ce client seulement.
 */
export async function devisDemande(
  request: NextRequest,
): Promise<
  | { ok: true; admin: Admin; devis: LigneDevis; profil: ProfilDevis; corps: Record<string, unknown>; lien: string }
  | { ok: false; reponse: Response }
> {
  const admin = createAdminClient();
  const acces = await accesPage(admin, request.headers);
  if (!acces.ok) return { ok: false, reponse: sansCorps(acces.code) };

  const corps = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const lien = corps?.lien;
  if (!corps || !lienValide(lien)) return { ok: false, reponse: json({ raison: "lien_inconnu" }, 404) };

  const [devis, profil] = await Promise.all([
    devisDuLien(admin, acces.organizationId, lien),
    profilDe(admin, acces.organizationId),
  ]);
  if (!devis || !profil) return { ok: false, reponse: json({ raison: "lien_inconnu" }, 404) };
  return { ok: true, admin, devis, profil, corps, lien };
}

/** Ce que le site transmet de la visiteuse : son adresse IP et son navigateur, bornés. */
export function visiteuse(corps: Record<string, unknown>): { ip: string | null; agent: string | null } {
  const ip = typeof corps.ip === "string" ? corps.ip.slice(0, 64) : null;
  const agent = typeof corps.agent === "string" ? corps.agent.slice(0, 400) : null;
  return { ip, agent };
}
