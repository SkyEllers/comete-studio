import { after, type NextRequest } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { horlogeAgent, outilVersAgent } from "@/tools/agent/outil";
import { accesPage, json, rdvDuLien, rdvPourSite, sansCorps } from "@/tools/reservation/acces-page";
import { agendasGoogle } from "@/tools/reservation/agenda";
import { depotSupabase } from "@/tools/reservation/depot";
import { identifiants } from "@/tools/reservation/google";
import { reporter } from "@/tools/reservation/moteur";
import { suivreReport } from "@/tools/reservation/suites";

/**
 * La cliente déplace son rendez-vous depuis son lien personnel.
 *
 * Le moteur garde la même personne si elle est libre (elle a les réponses
 * sous les yeux), sinon l'ordre habituel ; la base annule l'ancien et prend le
 * nouveau dans la même transaction, et le lien personnel suit (0042). Ensuite
 * l'agenda Google (l'ancien effacé, le nouveau écrit, d'où le lien Meet) et
 * Radar (l'ancien « reprogrammé », le nouveau hérite de son canal).
 *
 *   404  lien inconnu.   409  { raison: "plus_libre" }.   410  déjà annulé.
 *   423  réservation fermée.   200  le nouveau rendez-vous, `ancienId` et `ancienDebut`.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const corpsSchema = z.strictObject({
  lien: z.string().regex(/^[0-9a-f]{64}$/),
  debut: z.iso.datetime({ offset: false }),
});

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const acces = await accesPage(admin, request.headers);
  if (!acces.ok) return sansCorps(acces.code);

  const ids = identifiants();
  if (!ids) return json({ raison: "erreur" }, 503);

  const corps = corpsSchema.safeParse(await request.json().catch(() => null));
  if (!corps.success) return json({ raison: "lien_inconnu" }, 404);

  const org = acces.organizationId;
  const ancien = await rdvDuLien(admin, org, corps.data.lien);
  if (!ancien) return json({ raison: "lien_inconnu" }, 404);
  if (ancien.statut === "annule") return json({ raison: "annule" }, 410);

  try {
    const prise = await reporter(
      org,
      ancien.id,
      corps.data.debut,
      "cliente",
      Date.now(),
      depotSupabase(admin),
      agendasGoogle(admin, ids),
    );
    if (!prise.ok) {
      if (prise.raison === "ferme") return json({ raison: "ferme" }, 423);
      if (prise.raison === "plus_libre") return json({ raison: "plus_libre" }, 409);
      console.error("Réservation, report refusé :", prise.message ?? prise.raison);
      return json({ raison: "erreur" }, 500);
    }

    await suivreReport(admin, org, ancien.id, prise.id, ids, "cliente");

    // L'agent WhatsApp suit le nouveau créneau et repart de cette date.
    await outilVersAgent(admin, org, { type: "reporte", ancienId: ancien.id, rdvId: prise.id, jeton: corps.data.lien });
    after(() => horlogeAgent(admin));

    const nouveau = await rdvDuLien(admin, org, corps.data.lien);
    if (!nouveau) return json({ raison: "erreur" }, 500);
    return json({ ...rdvPourSite(nouveau), ancienId: ancien.id, ancienDebut: new Date(ancien.debut).toISOString() });
  } catch (erreur) {
    console.error("Réservation, reporter :", erreur instanceof Error ? erreur.message : "erreur");
    return json({ raison: "erreur" }, 500);
  }
}
