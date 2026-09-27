import type { NextRequest } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { accesPage, json, rdvDuLien, rdvPourSite, sansCorps } from "@/tools/reservation/acces-page";
import { effacerRendezVous } from "@/tools/reservation/agenda";
import { identifiants } from "@/tools/reservation/google";
import { annulerDansRadar } from "@/tools/reservation/radar";

/**
 * La cliente annule depuis son lien personnel.
 *
 * La base d'abord (`reservation_annuler`, 0042) : dès cet instant le créneau
 * se libère. Puis l'agenda Google de la personne et Radar, qui ne font jamais
 * échouer l'annulation. Rejouer l'appel sur un rendez-vous déjà annulé rend
 * 200 sans rien refaire (`deja: true`).
 *
 *   404  lien inconnu.   200  le rendez-vous, statut « annule ».
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
  if (rdv.statut === "annule") return json({ ...rdvPourSite(rdv), deja: true });

  const { error } = await admin.rpc("reservation_annuler", { rendez_vous: rdv.id, par: "cliente" });
  if (error) {
    console.error("Réservation, annulation :", error.message);
    return json({ raison: "erreur" }, 500);
  }

  const ids = identifiants();
  if (ids) {
    try {
      await effacerRendezVous(admin, rdv.id, ids);
    } catch (erreur) {
      console.error("Réservation, effacement Google :", erreur instanceof Error ? erreur.message : "erreur");
    }
  }
  await annulerDansRadar(admin, rdv.id, { reprogramme: false, par: "cliente" });

  return json({ ...rdvPourSite(rdv), statut: "annule" });
}
