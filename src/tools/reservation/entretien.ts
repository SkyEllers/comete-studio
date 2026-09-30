import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { echapper, envoyer } from "../fichiers/courriel.ts";

import { agendasGoogle, ecrireRendezVous } from "./agenda.ts";
import { depotSupabase } from "./depot.ts";
import { identifiants } from "./google.ts";
import { creneauxLibres } from "./moteur.ts";
import { uriRadar } from "./radar.ts";
import { baseEspace } from "./suites.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * L'entretien de l'outil de réservation, à chaque passage de l'horloge de
 * l'agent (toutes les 5 minutes, `api/agent/horloge`) :
 *
 * 1. Une écriture Google ratée se retente. Un rendez-vous pris sans son
 *    événement dans l'agenda « Diagnostics » manque à la personne qui le
 *    tient, et Calendly, qui lit cet agenda pendant la transition, pourrait
 *    redonner le créneau. Toujours absent 30 minutes après : un mail à Louis.
 *    Le lien de visio obtenu est rendu à la conversation de l'agent (le
 *    message du matin le donne).
 * 2. « Complet » : toutes les 15 minutes, si la page n'a plus aucun créneau
 *    sur toute la fenêtre, un mail à Louis pour ouvrir des créneaux, une fois
 *    par épisode (`complet_depuis`, 0042).
 *
 * Ne lève jamais : l'horloge de l'agent ne doit pas tomber pour ça.
 */

const MINUTE = 60_000;

function mail(sujet: string, phrase: string, lien: string) {
  return envoyer({
    sujet,
    texte: `${phrase}\n\n${lien}\n`,
    html: `<p>${echapper(phrase)}</p><p><a href="${echapper(lien)}">Ouvrir</a></p>`,
  });
}

async function nomClient(admin: Admin, org: string): Promise<string> {
  const { data } = await admin.from("organizations").select("name").eq("id", org).single();
  return data?.name ?? "?";
}

export async function reecrireGoogle(admin: Admin, maintenant = Date.now()): Promise<number> {
  const ids = identifiants();
  if (!ids) return 0;
  const { data } = await admin
    .from("reservation_rendez_vous")
    .select("id, organization_id, created_at")
    .eq("statut", "confirme")
    .is("google_event_id", null)
    .gt("debut", new Date(maintenant).toISOString())
    // La route qui vient de réserver est peut-être encore en train d'écrire.
    .lt("created_at", new Date(maintenant - 2 * MINUTE).toISOString())
    .order("debut")
    .limit(10);

  let ecrits = 0;
  for (const r of data ?? []) {
    try {
      const ecrit = await ecrireRendezVous(admin, r.id, ids, await baseEspace(admin, r.organization_id));
      ecrits++;
      if (ecrit.lienVisio) {
        await admin
          .from("agent_conversations")
          .update({ lien_visio: ecrit.lienVisio })
          .eq("organization_id", r.organization_id)
          .eq("invitee_uri", uriRadar(r.id))
          .is("lien_visio", null);
      }
    } catch (erreur) {
      console.error("Réservation, réécriture Google :", erreur instanceof Error ? erreur.message : "erreur");
      // Un seul mail : au passage qui tombe entre 30 et 35 minutes après la réservation.
      const age = maintenant - Date.parse(r.created_at);
      if (age >= 30 * MINUTE && age < 35 * MINUTE) {
        const racine = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
        await mail(
          `[Réservation ${await nomClient(admin, r.organization_id)}] Un rendez-vous manque dans Google Agenda`,
          "Un diagnostic réservé il y a 30 minutes n'est toujours pas écrit dans l'agenda « Diagnostics » de la personne qui le tient : Google refuse. Il est bien pris dans l'outil. Regarde dans l'onglet Réservation si son agenda est à reconnecter ; l'horloge réessaie toutes les 5 minutes.",
          `${racine}/admin/clients/${r.organization_id}/reservation`,
        );
      }
    }
  }
  return ecrits;
}

export async function surveillerComplet(admin: Admin, maintenant = Date.now()): Promise<number> {
  // Toutes les 15 minutes : chaque calcul lit l'occupé Google de chacune.
  if (new Date(maintenant).getUTCMinutes() % 15 >= 5) return 0;
  const ids = identifiants();
  if (!ids) return 0;

  const { data: clients } = await admin
    .from("reservation_reglages")
    .select("organization_id, complet_depuis, fenetre_max_jours")
    .eq("actif", true);

  let alertes = 0;
  for (const c of clients ?? []) {
    try {
      const d = await creneauxLibres(c.organization_id, maintenant, depotSupabase(admin), agendasGoogle(admin, ids));
      if (d.etat === "complet" && !c.complet_depuis) {
        await admin
          .from("reservation_reglages")
          .update({ complet_depuis: new Date(maintenant).toISOString() })
          .eq("organization_id", c.organization_id);
        const racine = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
        await mail(
          `[Réservation ${await nomClient(admin, c.organization_id)}] Plus aucun créneau sur ${c.fenetre_max_jours} jours`,
          `La page de réservation affiche « complet » : plus un seul créneau libre sur les ${c.fenetre_max_jours} prochains jours. Il faut ouvrir des créneaux (horaires, absences, ou une closeuse de plus). Tu ne recevras pas d'autre mail tant que ça reste complet.`,
          `${racine}/admin/clients/${c.organization_id}/reservation`,
        );
        alertes++;
      } else if (d.etat === "ouvert" && c.complet_depuis) {
        await admin
          .from("reservation_reglages")
          .update({ complet_depuis: null })
          .eq("organization_id", c.organization_id);
      }
    } catch (erreur) {
      console.error("Réservation, surveillance complet :", erreur instanceof Error ? erreur.message : "erreur");
    }
  }
  return alertes;
}

export async function entretienReservation(admin: Admin, maintenant = Date.now()) {
  try {
    return {
      google: await reecrireGoogle(admin, maintenant),
      complets: await surveillerComplet(admin, maintenant),
    };
  } catch {
    console.error("Réservation : l'entretien a échoué");
    return { google: 0, complets: 0 };
  }
}
