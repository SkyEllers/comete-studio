import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { accesPage, json, sansCorps } from "@/tools/reservation/acces-page";
import { agendasGoogle } from "@/tools/reservation/agenda";
import { depotSupabase } from "@/tools/reservation/depot";
import { identifiants } from "@/tools/reservation/google";
import { creneauxLibres } from "@/tools/reservation/moteur";
import { creneauxPublics } from "@/tools/reservation/page";

/**
 * Les créneaux de la page de réservation d'un client.
 *
 * Cinquième route sans session du hub, appelée par le serveur du site du
 * client (jamais par un navigateur), avec son jeton (0045). Elle ne sort que
 * des heures : ni qui tient le créneau, ni rien de personnel. Réservation
 * fermée (`reservation_reglages.actif` faux) : `{ etat: "ferme" }`, et la page
 * ne propose rien.
 *
 *   401  jeton absent, inconnu ou révoqué, sans corps.
 *   429  trop d'appels pour ce jeton.
 *   503  les identifiants Google manquent au serveur.
 *   200  { etat: "ferme" | "complet" } ou { etat: "ouvert", fuseau, creneaux }.
 */

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const admin = createAdminClient();
  const acces = await accesPage(admin, request.headers);
  if (!acces.ok) return sansCorps(acces.code);

  const ids = identifiants();
  if (!ids) return json({ erreur: "agenda_indisponible" }, 503);

  try {
    const depot = depotSupabase(admin);
    const [dispos, reglages] = await Promise.all([
      creneauxLibres(acces.organizationId, Date.now(), depot, agendasGoogle(admin, ids)),
      depot.reglages(acces.organizationId),
    ]);
    return json(creneauxPublics(dispos, reglages?.fuseau ?? "Europe/Paris"));
  } catch (erreur) {
    // Jamais de donnée personnelle ici : le moteur ne lit que des heures.
    console.error("Réservation, créneaux :", erreur instanceof Error ? erreur.message : erreur);
    return json({ erreur: "lecture_impossible" }, 500);
  }
}
