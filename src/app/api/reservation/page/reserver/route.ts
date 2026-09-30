import { createHash, randomBytes } from "node:crypto";

import { after, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { horlogeAgent, outilVersAgent } from "@/tools/agent/outil";
import { accesPage, json, sansCorps } from "@/tools/reservation/acces-page";
import { agendasGoogle, ecrireRendezVous } from "@/tools/reservation/agenda";
import { depotSupabase } from "@/tools/reservation/depot";
import { identifiants } from "@/tools/reservation/google";
import { reserver } from "@/tools/reservation/moteur";
import { demandeSchema } from "@/tools/reservation/page";
import { prevenirPersonne } from "@/tools/reservation/prevenir";
import { versRadar } from "@/tools/reservation/radar";

/**
 * Réserver un diagnostic depuis la page du site du client.
 *
 * Appelée par le serveur du site, avec son jeton (0045) : le périmètre est
 * l'organisation du jeton, aucun champ du corps ne peut le changer. Le
 * créneau est recalculé ici, agendas compris ; la base a le dernier mot sur
 * les doubles réservations (contrainte d'exclusion, 0042).
 *
 * Elle attend l'écriture dans l'agenda Google de la personne : c'est elle qui
 * donne le lien Meet, que le mail de confirmation du site porte. C'est la
 * seule route sans session du hub qui peut dépasser 2 s (au pire une dizaine,
 * quand Google tarde à créer le Meet). Si l'écriture Google échoue, le
 * rendez-vous reste pris : il est dans la base, et sans lien de visio le mail
 * dit qu'il arrivera.
 *
 * Puis Radar : le rendez-vous y entre avec la personne qui le tient
 * (`radar.ts`), comme le webhook Calendly l'y aurait mis. Puis l'agent
 * WhatsApp (`agent/outil.ts`), qui ouvre sa conversation.
 *
 * Le lien personnel pour annuler ou reporter est tiré ici, rendu une fois au
 * site, et seul son SHA-256 est gardé.
 *
 *   401  jeton absent, inconnu ou révoqué.   429  trop d'appels.
 *   400  demande illisible (un défaut du site, à corriger).
 *   409  { raison: "plus_libre" } : le créneau vient d'être pris.
 *   423  { raison: "ferme" } : la réservation est fermée.
 *   200  { id, debut, fin, lienVisio, jeton }.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const acces = await accesPage(admin, request.headers);
  if (!acces.ok) return sansCorps(acces.code);

  const ids = identifiants();
  if (!ids) return json({ raison: "erreur" }, 503);

  const brut = await request.json().catch(() => null);
  const demande = demandeSchema.safeParse(brut);
  if (!demande.success) {
    // Le chemin du champ fautif, jamais sa valeur.
    const champ = demande.error.issues[0]?.path.join(".") || "corps";
    return json({ raison: "demande_illisible", champ }, 400);
  }
  const d = demande.data;

  const jeton = randomBytes(32).toString("hex");
  const org = acces.organizationId;

  try {
    const prise = await reserver(
      org,
      d.debut,
      {
        origine: "page",
        prenom: d.prenom,
        nom: d.nom,
        email: d.email.toLowerCase(),
        telephone: d.telephone,
        fuseauCliente: d.fuseau,
        reponses: d.reponses,
        utm: d.utm,
        jetonHash: createHash("sha256").update(jeton).digest("hex"),
      },
      Date.now(),
      depotSupabase(admin),
      agendasGoogle(admin, ids),
    );

    if (!prise.ok) {
      if (prise.raison === "ferme") return json({ raison: "ferme" }, 423);
      if (prise.raison === "plus_libre") return json({ raison: "plus_libre" }, 409);
      console.error("Réservation, prise refusée :", prise.message ?? prise.raison);
      return json({ raison: "erreur" }, 500);
    }

    const { data: orga } = await admin.from("organizations").select("slug").eq("id", org).single();
    const racine = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.cometestudio.fr").replace(/\/+$/, "");

    const espace = `${racine}/app/${orga?.slug ?? ""}`;
    let lienVisio: string | null = null;
    try {
      const ecrit = await ecrireRendezVous(admin, prise.id, ids, espace);
      lienVisio = ecrit.lienVisio;
    } catch (erreur) {
      console.error("Réservation, écriture Google :", erreur instanceof Error ? erreur.message : erreur);
    }

    // Le mail à la personne qui le tient, avec les réponses, après la
    // réponse au site : il ne la retarde pas.
    after(() => prevenirPersonne(admin, prise.id, "nouveau", espace));

    // Radar, avec la bonne personne. Ne fait jamais échouer la réservation.
    await versRadar(admin, prise.id);

    // L'agent WhatsApp, après Radar (il s'y relie) et après Google (le lien
    // de visio du matin même). Son premier message part après la réponse au
    // site, sans attendre l'horloge, comme depuis le webhook Calendly.
    await outilVersAgent(admin, org, { type: "reserve", rdvId: prise.id, jeton });
    after(() => horlogeAgent(admin));

    const { data: rdv } = await admin
      .from("reservation_rendez_vous")
      .select("debut, fin, lien_visio")
      .eq("id", prise.id)
      .single();

    return json({
      id: prise.id,
      debut: rdv?.debut ?? d.debut,
      fin: rdv?.fin ?? null,
      lienVisio: lienVisio ?? rdv?.lien_visio ?? null,
      jeton,
    });
  } catch (erreur) {
    console.error("Réservation, réserver :", erreur instanceof Error ? erreur.message : erreur);
    return json({ raison: "erreur" }, 500);
  }
}
