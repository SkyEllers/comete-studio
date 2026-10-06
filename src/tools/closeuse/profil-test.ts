import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { aujourdhuiAParis } from "@/tools/resultats/format";

/**
 * Le profil closeuse de test de Louis (06/10/2026).
 *
 * Un vrai compte closeuse, à part de son compte admin, dans l'espace d'essai
 * « Comète Studio » : il s'y connecte dans une fenêtre privée et voit, clique
 * et remplit exactement ce que voient les closeuses, sans toucher aux vrais
 * rendez-vous de Peggy. Les rendez-vous démo se remettent à neuf d'un bouton,
 * un dans chaque état de l'espace (à venir, à noter, à recontacter, déjà faits).
 *
 * Tout passe par le client admin : ces écritures ne viennent que de la page
 * `/admin/closeuse`, gardée par `requireAdmin`.
 */

export const ESPACE_TEST = "comete-studio";
export const EMAIL_TEST = "louisgirault1905+closeuse@gmail.com";
export const NOM_TEST = "Louis Girault (test)";

/** Les rendez-vous démo se reconnaissent à leur clé : on n'efface qu'eux. */
const PREFIXE = "demo-closeuse-";

type Admin = ReturnType<typeof createAdminClient>;

export type EtatProfilTest = {
  organisation: { id: string; nom: string } | null;
  compte: { id: string; nom: string } | null;
  closeuse: boolean;
  reservation: { actif: boolean; agenda: boolean } | null;
  demos: number;
  jamaisConnecte: boolean;
};

async function lire(admin: Admin) {
  const [{ data: org }, { data: profil }] = await Promise.all([
    admin.from("organizations").select("id, name").eq("slug", ESPACE_TEST).maybeSingle(),
    admin.from("profiles").select("id, full_name").eq("email", EMAIL_TEST).maybeSingle(),
  ]);
  return { org, profil };
}

export async function etatProfilTest(): Promise<EtatProfilTest> {
  const admin = createAdminClient();
  const { org, profil } = await lire(admin);

  if (!org || !profil) {
    return {
      organisation: org ? { id: org.id, nom: org.name } : null,
      compte: profil ? { id: profil.id, nom: profil.full_name ?? "" } : null,
      closeuse: false,
      reservation: null,
      demos: 0,
      jamaisConnecte: true,
    };
  }

  const [{ data: membre }, { data: personne }, { count }, utilisateur] = await Promise.all([
    admin
      .from("memberships")
      .select("role")
      .eq("organization_id", org.id)
      .eq("user_id", profil.id)
      .maybeSingle(),
    admin
      .from("reservation_personnes")
      .select("actif, google_connecte_le")
      .eq("organization_id", org.id)
      .eq("user_id", profil.id)
      .maybeSingle(),
    admin
      .from("radar_bookings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.id)
      .eq("closeuse_id", profil.id)
      .like("invitee_key", `${PREFIXE}%`),
    admin.auth.admin.getUserById(profil.id),
  ]);

  return {
    organisation: { id: org.id, nom: org.name },
    compte: { id: profil.id, nom: profil.full_name ?? "" },
    closeuse: membre?.role === "closeuse",
    reservation: personne ? { actif: personne.actif, agenda: Boolean(personne.google_connecte_le) } : null,
    demos: count ?? 0,
    jamaisConnecte: !utilisateur.data.user?.last_sign_in_at,
  };
}

/**
 * Rendre le compte de test closeuse dans l'espace d'essai : son nom, son
 * adhésion, sa grille, et sa fiche de réservation (hors roulement, pour
 * qu'aucune réservation d'essai du site ne tombe chez lui).
 */
export async function preparerProfilTest(): Promise<{ erreur: string } | { invite: boolean }> {
  const admin = createAdminClient();
  const { org } = await lire(admin);
  if (!org) return { erreur: `L'espace d'essai « ${ESPACE_TEST} » n'existe plus.` };

  let { profil } = await lire(admin);
  let invite = false;
  if (!profil) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(EMAIL_TEST, { data: { full_name: NOM_TEST } });
    if (error || !data.user) return { erreur: "Le compte de test n'a pas pu être créé." };
    invite = true;
    profil = { id: data.user.id, full_name: NOM_TEST };
  }

  if (profil.full_name !== NOM_TEST) {
    await admin.from("profiles").update({ full_name: NOM_TEST }).eq("id", profil.id);
  }

  const { data: membre } = await admin
    .from("memberships")
    .select("role")
    .eq("organization_id", org.id)
    .eq("user_id", profil.id)
    .maybeSingle();
  if (!membre) {
    const { error } = await admin
      .from("memberships")
      .insert({ organization_id: org.id, user_id: profil.id, role: "closeuse" });
    if (error) return { erreur: "Impossible de l'ajouter à l'espace d'essai." };
  } else if (membre.role !== "closeuse") {
    await admin
      .from("memberships")
      .update({ role: "closeuse" })
      .eq("organization_id", org.id)
      .eq("user_id", profil.id);
  }

  await admin
    .from("radar_closeuses")
    .upsert({ organization_id: org.id, user_id: profil.id }, { onConflict: "organization_id,user_id", ignoreDuplicates: true });

  const { data: personne } = await admin
    .from("reservation_personnes")
    .select("id")
    .eq("organization_id", org.id)
    .eq("user_id", profil.id)
    .maybeSingle();
  if (!personne) {
    const { error } = await admin
      .from("reservation_personnes")
      .insert({ organization_id: org.id, user_id: profil.id, role: "closeuse", actif: false });
    if (error) return { erreur: `Fiche de réservation : ${error.message}` };
  }

  return { invite };
}

// ------------------------------ Les démos -----------------------------------

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;

/** Au quart d'heure, comme les créneaux de la page de réservation. */
const auQuart = (ms: number) => new Date(Math.round(ms / (15 * 60_000)) * 15 * 60_000);

const REPONSES = (motivation: string, ageEtPoids: string, budget: string) => [
  { q: "Ton numéro de téléphone (WhatsApp de préférence)", r: "06 00 00 00 00" },
  { q: "Qu'est-ce qui te pousse à vouloir perdre du poids aujourd'hui, et qu'as-tu déjà essayé ?", r: motivation },
  { q: "Ton âge, ton poids actuel et le poids que tu aimerais atteindre", r: ageEtPoids },
  { q: "Quand tu décides de changer quelque chose, comment t'y prends-tu d'habitude ?", r: "J'ai besoin d'être accompagnée" },
  { q: "Comment as-tu connu Peggy ?", r: "Une publicité sur Instagram" },
  { q: "Quel budget mensuel pourrais-tu consacrer à ta santé ?", r: budget },
];

const RESUME = {
  probleme: "Démo : quinze kilos pris depuis la ménopause, grignotage le soir.",
  objectif: "Démo : retrouver son poids d'avant pour le mariage de sa fille en juin.",
  freins: "Démo : le prix, et en parler d'abord à son mari.",
  propose: "Démo : l'accompagnement sur 6 mois, devis expliqué.",
};

type Demo = {
  cle: string;
  prenom: string;
  nom: string;
  debut: Date;
  statut: "confirme" | "honore" | "annule" | "no_show";
  suivi?: "en_cours" | "confirme";
  reponses?: { q: string; r: string }[];
  vente?: { montantCents: number; fois: number; premierCents: number };
  nonVente?: { motif: string; recontacterLe: string };
  resume?: boolean;
};

function lesDemos(maintenant: number): Demo[] {
  const aujourdhui = aujourdhuiAParis();
  return [
    {
      cle: "a-venir-confirme",
      prenom: "Céline",
      nom: "Démo",
      debut: auQuart(maintenant + 26 * HEURE),
      statut: "confirme",
      suivi: "confirme",
      reponses: REPONSES(
        "Quinze kilos depuis la ménopause. J'ai fait WW, Dukan, les shakes : je perds, je reprends tout.",
        "54 ans, 82 kg, j'aimerais revenir à 68 kg",
        "Entre 150 et 250 €",
      ),
    },
    {
      cle: "a-venir-pas-confirme",
      prenom: "Nadia",
      nom: "Démo",
      debut: auQuart(maintenant + 3 * JOUR),
      statut: "confirme",
      suivi: "en_cours",
      reponses: REPONSES(
        "Je grignote le soir après le travail, je suis épuisée. Le jeûne m'a fait perdre puis reprendre.",
        "46 ans, 74 kg, objectif 64 kg",
        "Entre 100 et 150 €",
      ),
    },
    {
      cle: "a-noter",
      prenom: "Sophie",
      nom: "Démo",
      debut: auQuart(maintenant - 2 * HEURE),
      statut: "confirme",
      suivi: "confirme",
      reponses: REPONSES(
        "Le mariage de ma fille en juin, je n'ose pas acheter ma robe. Plusieurs régimes, rien ne tient.",
        "58 ans, 90 kg, j'aimerais 75 kg",
        "Plus de 250 €",
      ),
    },
    {
      cle: "a-recontacter",
      prenom: "Martine",
      nom: "Démo",
      debut: auQuart(maintenant - 3 * JOUR),
      statut: "honore",
      nonVente: { motif: "conjoint", recontacterLe: aujourdhui },
      resume: true,
    },
    {
      cle: "vendu",
      prenom: "Sandrine",
      nom: "Démo",
      debut: auQuart(maintenant - 5 * JOUR),
      statut: "honore",
      vente: { montantCents: 152_000, fois: 6, premierCents: 67_000 },
      resume: true,
    },
    { cle: "pas-venue", prenom: "Claire", nom: "Démo", debut: auQuart(maintenant - 2 * JOUR), statut: "no_show" },
    { cle: "annule", prenom: "Julie", nom: "Démo", debut: auQuart(maintenant + 2 * JOUR), statut: "annule" },
  ];
}

/**
 * Effacer les démos du profil de test (et leurs fichiers d'enregistrement),
 * puis en remettre une de chaque état. Les vrais rendez-vous ne sont jamais
 * touchés : seuls ceux dont la clé commence par `demo-closeuse-`.
 */
export async function remettreLesDemos(): Promise<{ erreur: string } | { crees: number }> {
  const admin = createAdminClient();
  const { org, profil } = await lire(admin);
  if (!org || !profil) return { erreur: "Prépare d'abord le profil de test." };

  const { data: anciens } = await admin
    .from("radar_bookings")
    .select("id")
    .eq("organization_id", org.id)
    .eq("closeuse_id", profil.id)
    .like("invitee_key", `${PREFIXE}%`);
  const anciensIds = (anciens ?? []).map((a) => a.id);

  if (anciensIds.length) {
    const { data: fichiers } = await admin
      .from("radar_diagnostic_enregistrements")
      .select("chemin")
      .in("booking_id", anciensIds)
      .not("chemin", "is", null);
    const chemins = (fichiers ?? []).map((f) => f.chemin).filter((c): c is string => Boolean(c));
    if (chemins.length) await admin.storage.from("diagnostics").remove(chemins);

    const { error } = await admin.from("radar_bookings").delete().in("id", anciensIds);
    if (error) return { erreur: `Effacement des démos : ${error.message}` };
  }

  const marque = Date.now().toString(36);
  const maintenant = Date.now();
  let crees = 0;

  for (const d of lesDemos(maintenant)) {
    const { data: rdv, error } = await admin
      .from("radar_bookings")
      .insert({
        organization_id: org.id,
        closeuse_id: profil.id,
        invitee_uri: `demo://closeuse/${marque}/${d.cle}`,
        event_uri: `demo://closeuse/${marque}/ev-${d.cle}`,
        invitee_key: `${PREFIXE}${marque}-${d.cle}`,
        invitee_first_name: d.prenom,
        invitee_last_name: d.nom,
        event_type_name: "Démo · diagnostic offert 45 min",
        scheduled_start: d.debut.toISOString(),
        scheduled_end: new Date(d.debut.getTime() + 45 * 60_000).toISOString(),
        status: d.statut,
        status_origin: "admin",
        canceled_at: d.statut === "annule" ? new Date(maintenant).toISOString() : null,
        agent_suivi: d.suivi ?? null,
        ...(d.vente
          ? {
              sale_amount_cents: d.vente.montantCents,
              sale_date: d.debut.toISOString().slice(0, 10),
              sale_fois: d.vente.fois,
              sale_premier_cents: d.vente.premierCents,
              sale_recorded_by: profil.id,
              sale_recorded_at: new Date(maintenant).toISOString(),
            }
          : {}),
      })
      .select("id")
      .single();
    if (error || !rdv) return { erreur: `Démo « ${d.prenom} » : ${error?.message ?? "pas créée"}` };
    crees += 1;

    if (d.reponses) {
      await admin
        .from("radar_booking_answers")
        .insert({ booking_id: rdv.id, organization_id: org.id, answers: d.reponses });
    }
    if (d.nonVente) {
      await admin.from("radar_booking_activities").insert({
        booking_id: rdv.id,
        organization_id: org.id,
        user_id: profil.id,
        type: "sale.reason",
        // Comme `radar_note_non_vente` (0038) : le mois, et la date exacte à côté.
        payload: {
          motif: d.nonVente.motif,
          recontacter: `${d.nonVente.recontacterLe.slice(0, 7)}-01`,
          recontacter_le: d.nonVente.recontacterLe,
        },
      });
    }
    if (d.resume) {
      await admin.from("radar_diagnostic_enregistrements").insert({
        booking_id: rdv.id,
        organization_id: org.id,
        sans_enregistrement: true,
        resume: RESUME,
        depose_par: profil.id,
      });
    }
  }

  return { crees };
}
