import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { ecrireRendezVous, effacerRendezVous } from "./agenda.ts";
import type { Identifiants } from "./google.ts";
import type { Auteur } from "./moteur.ts";
import { prevenirPersonne } from "./prevenir.ts";
import { annulerDansRadar, versRadar } from "./radar.ts";

/**
 * Ce qui suit un report, quel que soit celui qui déplace (la cliente par son
 * lien, l'agent WhatsApp) : l'agenda Google de la personne (l'ancien effacé,
 * le nouveau écrit, d'où le lien de visio) puis Radar (l'ancien
 * « reprogrammé », le nouveau hérite de son canal). Rien ici ne fait échouer
 * le report : il est déjà pris en base.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** L'espace du client dans le hub, d'où partent les liens de l'événement Google et du mail. */
export async function baseEspace(admin: Admin, org: string): Promise<string> {
  const { data: orga } = await admin.from("organizations").select("slug").eq("id", org).single();
  const racine = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.cometestudio.fr").replace(/\/+$/, "");
  return `${racine}/app/${orga?.slug ?? ""}`;
}

export async function suivreReport(
  admin: Admin,
  org: string,
  ancienId: string,
  nouveauId: string,
  ids: Identifiants,
  par: Auteur,
): Promise<void> {
  try {
    await effacerRendezVous(admin, ancienId, ids);
  } catch (erreur) {
    console.error("Réservation, effacement Google :", erreur instanceof Error ? erreur.message : "erreur");
  }
  const espace = await baseEspace(admin, org);
  try {
    await ecrireRendezVous(admin, nouveauId, ids, espace);
  } catch (erreur) {
    console.error("Réservation, écriture Google :", erreur instanceof Error ? erreur.message : "erreur");
  }
  await annulerDansRadar(admin, ancienId, { reprogramme: true, par });
  await versRadar(admin, nouveauId);
  await prevenirPersonne(admin, nouveauId, "deplace", espace);
}
