import { after, type NextRequest } from "next/server";
import { z } from "zod";

import { devisDemande } from "@/tools/devis/acces";
import { ouvrirCompteEtv } from "@/tools/devis/etv";
import { prevenirPeggy, rdvPourSite, reserverPremier } from "@/tools/devis/premier";
import { json } from "@/tools/reservation/acces-page";

/**
 * Réserver le premier rendez-vous d'un devis payé, ou le déplacer s'il est
 * déjà pris (Louis, 07/10/2026). Le créneau est recalculé ici, agendas
 * compris ; la base a le dernier mot. Puis l'agenda de Peggy (événement,
 * visio), et son mail après la réponse. Le mail de confirmation à la
 * cliente, avec l'invitation, c'est le site qui l'envoie.
 *
 * Ni Radar, ni l'agent WhatsApp, ni les conversions des pubs : ce n'est pas
 * un diagnostic.
 *
 * Puis son compte dans l'app de Peggy (Louis, 08/10/2026, `etv.ts`) : créé à
 * la première réservation, sa date remise à jour quand elle déplace. La page
 * propose d'entrer dans l'app quand le compte est prêt (`etv.pret`).
 *
 *   404  lien inconnu.   409  { raison: "pas_paye" | "plus_libre" }.
 *   423  { raison: "ferme" }.   200  { rdv: { debut, fin, lienVisio, fuseau }, deplace, ancienDebut, etv }.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const corpsSchema = z.object({
  debut: z.iso.datetime({ offset: false }),
  fuseau: z.string().regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/).max(64),
});

export async function POST(request: NextRequest) {
  const d = await devisDemande(request);
  if (!d.ok) return d.reponse;
  if (d.devis.statut !== "signe" || !d.devis.paye_le) return json({ raison: "pas_paye" }, 409);

  const corps = corpsSchema.safeParse(d.corps);
  if (!corps.success) return json({ raison: "demande_illisible" }, 400);

  try {
    const prise = await reserverPremier(d.admin, d.devis, corps.data.debut, corps.data.fuseau);
    if (!prise.ok) {
      if (prise.raison === "ferme") return json({ raison: "ferme" }, 423);
      if (prise.raison === "plus_libre") return json({ raison: "plus_libre" }, 409);
      return json({ raison: "erreur" }, 500);
    }
    after(() => prevenirPeggy(d.admin, d.devis, prise.rdv, prise.deplace));
    const etv = await ouvrirCompteEtv(d.admin, d.profil.slug, d.devis, prise.rdv.debut);
    return json({
      rdv: rdvPourSite(prise.rdv),
      deplace: prise.deplace,
      ancienDebut: prise.ancienDebut,
      etv: etv ? { pret: etv.pret, app: etv.app } : null,
    });
  } catch (erreur) {
    console.error("Premier rendez-vous, réserver :", erreur instanceof Error ? erreur.message : "erreur");
    return json({ raison: "erreur" }, 500);
  }
}
