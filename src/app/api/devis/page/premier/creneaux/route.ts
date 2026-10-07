import type { NextRequest } from "next/server";

import { devisDemande } from "@/tools/devis/acces";
import { creneauxPremier, premierDuDevis, rdvPourSite } from "@/tools/devis/premier";
import { dureePremier } from "@/tools/devis/premier-regles";
import { json } from "@/tools/reservation/acces-page";

/**
 * Les créneaux de Peggy pour le premier rendez-vous d'un devis payé (Louis,
 * 07/10/2026) : la titulaire seule, les règles du diagnostic, 30 minutes
 * (15 pour un bilan microbiote seul). Avec le rendez-vous déjà pris, s'il y
 * en a un : la page propose alors de le déplacer.
 *
 *   404  lien inconnu.   409  { raison: "pas_paye" }.   503  Google non configuré.
 *   200  { minutes, rdv, creneaux }.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const d = await devisDemande(request);
  if (!d.ok) return d.reponse;
  if (d.devis.statut !== "signe" || !d.devis.paye_le) return json({ raison: "pas_paye" }, 409);

  try {
    const [creneaux, rdv] = await Promise.all([creneauxPremier(d.admin, d.devis), premierDuDevis(d.admin, d.devis.id)]);
    if (!creneaux) return json({ raison: "erreur" }, 503);
    return json({ minutes: dureePremier(d.devis), rdv: rdvPourSite(rdv), creneaux });
  } catch (erreur) {
    console.error("Premier rendez-vous, créneaux :", erreur instanceof Error ? erreur.message : "erreur");
    return json({ raison: "erreur" }, 500);
  }
}
