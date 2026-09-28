import type { NextRequest } from "next/server";

import { devisDemande, visiteuse } from "@/tools/devis/acces";
import { marquerOuvert, vuePourSite } from "@/tools/devis/moteur";
import { json } from "@/tools/reservation/acces-page";

/**
 * La page du devis, sur le site du client : le texte, les montants, l'état.
 * `ouvrir: true` (la cliente a ouvert la page) note la première ouverture
 * dans le dossier de preuve ; le site l'omet quand il relit le devis pour
 * écrire un mail.
 *
 *   404  lien inconnu.   200  le devis.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = await devisDemande(request);
  if (!d.ok) return d.reponse;
  if (d.corps.ouvrir === true && d.devis.statut === "envoye") {
    const v = visiteuse(d.corps);
    await marquerOuvert(d.admin, d.devis, v.ip, v.agent);
  }
  return json(vuePourSite(d.profil, d.devis));
}
