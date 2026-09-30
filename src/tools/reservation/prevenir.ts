import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { envoyer } from "../fichiers/courriel.ts";
import { mailReservation } from "./reponses.ts";

/**
 * Prévenir par mail la personne qui tient le diagnostic (Peggy, une
 * closeuse) : à chaque réservation, et quand un rendez-vous est déplacé, avec
 * les réponses au formulaire, comme le faisait Calendly (Louis, 30/09/2026).
 * À son adresse de connexion au hub. Ne lève jamais : un mail raté ne défait
 * pas une réservation.
 */

type Admin = ReturnType<typeof createAdminClient>;

type RdvPourMail = {
  debut: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  reponses: unknown;
  lien_visio: string | null;
  personne: { user_id: string; fuseau: string };
};

export async function prevenirPersonne(
  admin: Admin,
  rdvId: string,
  type: "nouveau" | "deplace",
  lienEspace: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("reservation_rendez_vous")
      .select(
        "debut, prenom, nom, email, telephone, reponses, lien_visio, personne:reservation_personnes!reservation_rendez_vous_personne_id_organization_id_fkey(user_id, fuseau)",
      )
      .eq("id", rdvId)
      .single();
    if (error || !data) throw new Error(error?.message ?? "rendez-vous introuvable");
    const rdv = data as unknown as RdvPourMail;

    const { data: profil } = await admin.from("profiles").select("email").eq("id", rdv.personne.user_id).single();
    if (!profil?.email) return false;

    const mail = mailReservation({
      type,
      rdv,
      fuseau: rdv.personne.fuseau,
      lienVisio: rdv.lien_visio,
      lienEspace,
    });
    return await envoyer({ ...mail, a: [profil.email] });
  } catch (erreur) {
    console.error("Réservation, mail à la personne :", erreur instanceof Error ? erreur.message : "erreur");
    return false;
  }
}
