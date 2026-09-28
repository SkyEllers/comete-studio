import type { NextRequest } from "next/server";

import { devisDemande } from "@/tools/devis/acces";
import { pdfSigne } from "@/tools/devis/moteur";
import { json } from "@/tools/reservation/acces-page";

/**
 * Le PDF signé, en base64, pour la pièce jointe du mail du site ou le
 * téléchargement depuis la page. Seulement un devis signé.
 *
 *   404  lien inconnu.   409  pas encore signé.   200  { pdf, nom }.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = await devisDemande(request);
  if (!d.ok) return d.reponse;
  if (d.devis.statut !== "signe") return json({ raison: "pas_signe" }, 409);

  const pdf = await pdfSigne(d.admin, d.profil, d.devis);
  if (!pdf) return json({ raison: "erreur" }, 500);
  const nom = `devis-${d.devis.prenom}-${d.devis.signe_le?.slice(0, 10) ?? ""}.pdf`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-");
  return json({ pdf: Buffer.from(pdf).toString("base64"), nom });
}
