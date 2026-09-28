import type { NextRequest } from "next/server";

import { devisDemande, visiteuse } from "@/tools/devis/acces";
import { devisDuLien, signer, vuePourSite } from "@/tools/devis/moteur";
import { propre } from "@/tools/devis/regles";
import { json } from "@/tools/reservation/acces-page";

/**
 * La cliente signe : son adresse postale, son accord (« J'ai lu et
 * j'accepte »), et si elle veut commencer avant la fin des 14 jours.
 * Rejouer la signature d'un devis déjà signé rend 200 sans rien refaire.
 *
 *   404  lien inconnu.   410  expiré ou annulé.   422  adresse ou accord manquant.
 *   200  le devis signé.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = await devisDemande(request);
  if (!d.ok) return d.reponse;

  const adresse = propre(d.corps.adresse, 400);
  if (d.corps.accepte !== true || !adresse || adresse.length < 8) {
    return json({ raison: "incomplet" }, 422);
  }

  const v = visiteuse(d.corps);
  const r = await signer(d.admin, d.profil, d.devis, {
    adresse,
    demarrageImmediat: d.corps.demarrage === true,
    ip: v.ip,
    agent: v.agent,
  });
  if (!r.ok) return json({ raison: r.raison }, r.raison === "erreur" ? 500 : 410);

  const relu = await devisDuLien(d.admin, d.devis.organization_id, d.lien);
  return json({ ...vuePourSite(d.profil, relu ?? d.devis), deja: r.deja ?? false });
}
