import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { canalPour } from "./canal.ts";
import { choisirContenu, contenusDeja } from "./contenus.ts";
import { signalerEchec } from "./echecs.ts";
import { maintenantDe } from "./envoi.ts";
import { planifier, type Action, type EnvoiPasse } from "./planning.ts";
import { profil as profilDe } from "./profils/index.ts";
import { repondre } from "./reponse.ts";
import { MODELES, rendreModele, type CleModele, type Profil, type ValeursModele } from "./profil.ts";
import { heureEnMots, jourEnMots } from "./temps.ts";

export { envoyerLibre, maintenantDe } from "./envoi.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * L'horloge de l'agent : pour chaque conversation, faire ce que le planning
 * demande maintenant.
 *
 * Un envoi se réserve avant de partir : la ligne de `agent_messages` est
 * écrite d'abord, et sa `cle_envoi` unique fait qu'un deuxième passage
 * simultané de l'horloge échoue à l'insertion au lieu d'envoyer un doublon.
 * Si le canal refuse, la ligne est retirée et le passage suivant réessaie.
 */

const COLONNES =
  "id, organization_id, simulation, decalage, etat, reserve_le, rdv_debut, rdv_fin, fuseau, confirme_le, derniere_entree_le, sans_reponse_veille, prenom, telephone, lien_visio, reponses, annulee_par_agent_le";

type Conversation = {
  id: string;
  organization_id: string;
  simulation: boolean;
  decalage: string;
  etat: string;
  reserve_le: string;
  rdv_debut: string;
  rdv_fin: string;
  fuseau: string;
  confirme_le: string | null;
  derniere_entree_le: string | null;
  sans_reponse_veille: boolean;
  prenom: string;
  telephone: string | null;
  lien_visio: string | null;
  reponses: unknown;
  annulee_par_agent_le: string | null;
};

export function valeursPour(c: Conversation): ValeursModele {
  return {
    prenom: c.prenom,
    jour: jourEnMots(c.rdv_debut, c.fuseau),
    heure: heureEnMots(c.rdv_debut, c.fuseau),
    lienVisio: c.lien_visio ?? "(le lien de la visio est dans ton mail de confirmation)",
    titreContenu: "",
    lienContenu: "",
  };
}

async function reglagesDe(admin: Admin, orgId: string) {
  const { data } = await admin
    .from("agent_reglages")
    .select("profil, canal")
    .eq("organization_id", orgId)
    .maybeSingle();
  return data;
}

async function derniereSortie(admin: Admin, id: string): Promise<string | null> {
  const { data } = await admin
    .from("agent_messages")
    .select("created_at")
    .eq("conversation_id", id)
    .eq("sens", "sortant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ?? null;
}

async function envoisDe(admin: Admin, id: string): Promise<EnvoiPasse[]> {
  const { data } = await admin
    .from("agent_messages")
    .select("modele, cle_envoi, created_at")
    .eq("conversation_id", id)
    .eq("sens", "sortant")
    .eq("genre", "modele")
    .not("cle_envoi", "is", null);
  return (data ?? [])
    .map((m) => ({
      // Un contenu n'a pas de `modele` en base (0032) : sa clé le dit.
      modele: (m.modele ?? (m.cle_envoi?.startsWith("contenu:") ? "contenu" : null)) as CleModele | null,
      cle_envoi: m.cle_envoi as string,
      le: m.created_at,
    }))
    .filter((m): m is EnvoiPasse => m.modele !== null && MODELES.includes(m.modele));
}

async function appliquer(
  admin: Admin,
  c: Conversation,
  profil: Profil,
  canalReglage: string,
  action: Action,
  maintenant: number,
  reel: number,
): Promise<boolean> {
  if (action.genre === "terminer") {
    await admin.from("agent_conversations").update({ etat: "terminee" }).eq("id", c.id);
    return true;
  }

  if (action.genre === "clore_annulee") {
    await admin.from("agent_conversations").update({ etat: "annulee" }).eq("id", c.id);
    return true;
  }

  if (action.genre === "repondre") {
    return (await repondre(admin, c.id, reel)) !== "rien";
  }

  if (action.genre === "noter_sans_reponse_veille") {
    await admin
      .from("agent_conversations")
      .update({ sans_reponse_veille: true })
      .eq("id", c.id);
    return true;
  }

  const modele = profil.modeles[action.modele];
  let valeurs = valeursPour(c);
  let parModele = true;
  const canal = canalPour(c.simulation, canalReglage);

  if (action.modele === "contenu") {
    const { data: sortis } = await admin
      .from("agent_messages")
      .select("texte")
      .eq("conversation_id", c.id)
      .eq("sens", "sortant");
    const reponses = Array.isArray(c.reponses) ? (c.reponses as { answer: string }[]) : [];
    const choisi = choisirContenu(
      profil.catalogue,
      reponses,
      contenusDeja(profil.catalogue, (sortis ?? []).map((m) => m.texte)),
    );
    if (!choisi) {
      // Catalogue épuisé pour elle : le créneau se consomme sans rien envoyer.
      await admin.from("agent_messages").insert({
        conversation_id: c.id,
        organization_id: c.organization_id,
        sens: "sortant",
        genre: "modele",
        cle_envoi: action.cle,
        texte: "(aucun contenu qu'elle n'ait déjà reçu)",
        canal: canal.nom,
        statut: "echec",
        erreur: "Catalogue épuisé : rien envoyé.",
        created_at: new Date(maintenant).toISOString(),
      });
      return false;
    }
    valeurs = { ...valeurs, titreContenu: choisi.titre, lienContenu: choisi.url };
    // Elle a écrit dans les dernières 24 h : un message normal, gratuit,
    // plutôt qu'un modèle Marketing.
    parModele = !(c.derniere_entree_le && maintenant - Date.parse(c.derniere_entree_le) < 24 * 3_600_000);
  }
  const texte = rendreModele(modele, valeurs);

  const { data: reserve, error } = await admin
    .from("agent_messages")
    .insert({
      conversation_id: c.id,
      organization_id: c.organization_id,
      sens: "sortant",
      genre: "modele",
      // `contenu` n'est pas dans la contrainte de 0032 : sa clé suffit à le retrouver.
      modele: action.modele === "contenu" ? null : action.modele,
      cle_envoi: action.cle,
      texte,
      boutons: modele.boutons.map((b) => b.texte),
      canal: canal.nom,
      // En simulation, l'heure simulée : c'est elle que le planning relira.
      created_at: new Date(maintenant).toISOString(),
    })
    .select("id")
    .single();

  // Déjà pris par un autre passage : rien à faire, et surtout rien à renvoyer.
  if (error || !reserve) return false;

  const resultat = await canal.envoyer(admin, {
    organisationId: c.organization_id,
    telephone: c.telephone,
    texte,
    ...(parModele ? { modele: { cle: action.modele, profil: profil.cle, valeurs } } : {}),
  });

  if (!resultat.ok) {
    // Passager (Meta en panne, trop d'envois d'un coup) : la réservation
    // s'efface, l'horloge retentera. Définitif : il reste noté en échec, avec
    // la raison de Meta, et ne repart plus ; Louis est prévenu.
    if (!resultat.definitif) {
      await admin.from("agent_messages").delete().eq("id", reserve.id);
    } else {
      await admin
        .from("agent_messages")
        .update({ statut: "echec", erreur: resultat.erreur })
        .eq("id", reserve.id);
      await signalerEchec(admin, {
        organisationId: c.organization_id,
        conversationId: c.id,
        erreur: resultat.erreur,
      });
    }
    console.error("Agent : envoi refusé par le canal", canal.nom, action.modele, resultat.definitif ? "définitif" : "passager");
    return false;
  }

  if (resultat.idExterne) {
    await admin
      .from("agent_messages")
      .update({ id_externe: resultat.idExterne })
      .eq("id", reserve.id);
  }
  return true;
}

/**
 * Faire tourner une conversation jusqu'à ce que le planning n'ait plus rien
 * à demander. Trois tours au plus : une action en débloque rarement plus
 * d'une autre (noter « sans réponse », puis envoyer le lien).
 */
export async function tournerConversation(
  admin: Admin,
  id: string,
  reel = Date.now(),
): Promise<number> {
  let faits = 0;

  for (let tour = 0; tour < 3; tour++) {
    const { data: c } = await admin
      .from("agent_conversations")
      .select(COLONNES)
      .eq("id", id)
      .maybeSingle();
    if (!c) return faits;

    const reglages = await reglagesDe(admin, c.organization_id);
    const profil = reglages ? profilDe(reglages.profil) : null;
    if (!reglages || !profil) return faits;

    const maintenant = maintenantDe(c, reel);
    const [envois, derniere_sortie_le] = await Promise.all([
      envoisDe(admin, c.id),
      derniereSortie(admin, c.id),
    ]);
    const actions = planifier({ ...c, envois, derniere_sortie_le }, maintenant);
    if (actions.length === 0) return faits;

    for (const action of actions) {
      if (await appliquer(admin, c, profil, reglages.canal, action, maintenant, reel)) faits++;
    }
  }
  return faits;
}

/** Toutes les conversations en cours : c'est ce que l'horloge appelle. */
export async function tournerTout(admin: Admin, reel = Date.now()): Promise<number> {
  const { data } = await admin
    .from("agent_conversations")
    .select("id")
    .eq("etat", "active");

  let faits = 0;
  for (const { id } of data ?? []) faits += await tournerConversation(admin, id, reel);
  return faits;
}
