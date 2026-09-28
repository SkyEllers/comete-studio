import type { NextRequest } from "next/server";

import { devisDemande } from "@/tools/devis/acces";
import { noterPaiement } from "@/tools/devis/moteur";
import { json } from "@/tools/reservation/acces-page";

/**
 * Le site dit ce qui s'est passé côté paiement : la page Stripe ouverte
 * (`paiement_lien`), ou le paiement mis en place (`paye`, depuis le webhook
 * Stripe du site).
 *
 *   404  lien inconnu.   422  geste inconnu.   409  devis pas signé.   200  noté.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = await devisDemande(request);
  if (!d.ok) return d.reponse;
  const genre = d.corps.genre;
  if (genre !== "paiement_lien" && genre !== "paye") return json({ raison: "geste_inconnu" }, 422);
  if (d.devis.statut !== "signe") return json({ raison: "pas_signe" }, 409);
  const session = typeof d.corps.session === "string" ? d.corps.session.slice(0, 200) : null;
  await noterPaiement(d.admin, d.devis, genre, session);
  return json({ ok: true });
}
