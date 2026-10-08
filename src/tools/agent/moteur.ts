import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { canalPour } from "./canal.ts";
import { choisirContenu, contenusDeja } from "./contenus.ts";
import { marquerSiInjoignable, signalerEchec } from "./echecs.ts";
import { maintenantDe } from "./envoi.ts";
import { planifier, type Action, type EnvoiPasse } from "./planning.ts";
import { profil as profilDe } from "./profils/index.ts";
import { repondre } from "./reponse.ts";
import { MODELES, rendreModele, type CleModele, type Profil, type ValeursModele } from "./profil.ts";
import { heureDuRdv, jourEnMots } from "./temps.ts";

export { envoyerLibre, maintenantDe } from "./envoi.ts";

type Admin = ReturnType<typeof createAdminClient>;

/** Le contenu planifié ne part pas si un article lui est parti depuis moins que ça. */
const ARTICLE_RECENT_MS = 5 * 24 * 3_600_000;

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
    heure: heureDuRdv(c.rdv_debut, c.fuseau),
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

type LigneEnvoi = { modele: string | null; cle_envoi: string | null; created_at: string };

function versEnvois(lignes: LigneEnvoi[]): EnvoiPasse[] {
  return lignes
    .map((m) => ({
      // Un contenu n'a pas de `modele` en base (0032) : sa clé le dit.
      modele: (m.modele ?? (m.cle_envoi?.startsWith("contenu:") ? "contenu" : null)) as CleModele | null,
      cle_envoi: m.cle_envoi as string,
      le: m.created_at,
    }))
    .filter((m): m is EnvoiPasse => m.modele !== null && MODELES.includes(m.modele));
}

async function envoisDe(admin: Admin, id: string): Promise<EnvoiPasse[]> {
  const { data } = await admin
    .from("agent_messages")
    .select("modele, cle_envoi, created_at")
    .eq("conversation_id", id)
    .eq("sens", "sortant")
    .eq("genre", "modele")
    .not("cle_envoi", "is", null);
  return versEnvois(data ?? []);
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
      .select("texte, created_at")
      .eq("conversation_id", c.id)
      .eq("sens", "sortant");
    const reponses = Array.isArray(c.reponses) ? (c.reponses as { answer: string }[]) : [];
    const choisi = choisirContenu(
      profil.catalogue,
      reponses,
      contenusDeja(profil.catalogue, (sortis ?? []).map((m) => m.texte)),
    );
    // Un article déjà parti ces cinq derniers jours, dans la conversation :
    // un deuxième fait trop (05/10/2026 : Maÿlis, un article le 02/10 et un
    // autre le 05/10, a touché « Ne plus recevoir »).
    const recents = (sortis ?? []).filter(
      (m) => maintenant - Date.parse(m.created_at) < ARTICLE_RECENT_MS,
    );
    const articleRecent = contenusDeja(profil.catalogue, recents.map((m) => m.texte)).size > 0;
    // Elle a touché « Ne plus recevoir » : plus aucun article (option A, 06/10/2026).
    const { count: refus } = await admin
      .from("agent_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.id)
      .eq("sens", "entrant")
      .eq("comprehension->>sens", "sans_contenus");
    if ((refus ?? 0) > 0) {
      await admin.from("agent_messages").insert({
        conversation_id: c.id,
        organization_id: c.organization_id,
        sens: "sortant",
        genre: "modele",
        cle_envoi: action.cle,
        texte: "(elle ne veut plus d'articles)",
        canal: canal.nom,
        statut: "echec",
        erreur: "Articles refusés : rien envoyé.",
        created_at: new Date(maintenant).toISOString(),
      });
      return false;
    }
    if (!choisi || articleRecent) {
      // Rien de neuf à lui envoyer : le créneau se consomme sans rien envoyer.
      await admin.from("agent_messages").insert({
        conversation_id: c.id,
        organization_id: c.organization_id,
        sens: "sortant",
        genre: "modele",
        cle_envoi: action.cle,
        texte: choisi ? "(un article lui est déjà parti ces cinq derniers jours)" : "(aucun contenu qu'elle n'ait déjà reçu)",
        canal: canal.nom,
        statut: "echec",
        erreur: choisi ? "Article récent : rien envoyé." : "Catalogue épuisé : rien envoyé.",
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
      await marquerSiInjoignable(admin, c.id, resultat.erreur);
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

/** Les messages partis vers ces conversations, par paquets : la base en rend 1 000 au plus. */
async function sortiesDe(
  admin: Admin,
  ids: string[],
): Promise<Map<string, (LigneEnvoi & { genre: string })[]>> {
  const parConversation = new Map<string, (LigneEnvoi & { genre: string })[]>();
  const PAQUET = 1000;
  for (let debut = 0; ; debut += PAQUET) {
    const { data, error } = await admin
      .from("agent_messages")
      .select("id, conversation_id, genre, modele, cle_envoi, created_at")
      .in("conversation_id", ids)
      .eq("sens", "sortant")
      .order("id")
      .range(debut, debut + PAQUET - 1);
    if (error) throw new Error(`agent_messages : ${error.message}`);
    for (const m of data ?? []) {
      const liste = parConversation.get(m.conversation_id) ?? [];
      liste.push(m);
      parConversation.set(m.conversation_id, liste);
    }
    if (!data || data.length < PAQUET) return parConversation;
  }
}

/**
 * Toutes les conversations en cours : c'est ce que l'horloge appelle, toutes
 * les 5 minutes.
 *
 * Le planning se pose d'abord pour toutes à la fois, sur trois lectures
 * (conversations, réglages, messages partis). Seules celles qui ont quelque
 * chose à faire passent ensuite par `tournerConversation`, qui relit tout
 * avant d'agir. Avant le 08/10/2026, chaque conversation coûtait quatre
 * lectures à chaque passage, qu'elle ait à faire ou non : 35 conversations,
 * ~35 000 appels par jour, et un hub ralenti pour tout le monde.
 */
export async function tournerTout(admin: Admin, reel = Date.now()): Promise<number> {
  const { data, error } = await admin
    .from("agent_conversations")
    .select(COLONNES)
    .eq("etat", "active");
  if (error) throw new Error(`agent_conversations : ${error.message}`);
  const conversations = (data ?? []) as Conversation[];
  if (conversations.length === 0) return 0;

  const orgs = [...new Set(conversations.map((c) => c.organization_id))];
  const [{ data: reglages, error: erreurReglages }, sorties] = await Promise.all([
    admin.from("agent_reglages").select("organization_id, profil").in("organization_id", orgs),
    sortiesDe(
      admin,
      conversations.map((c) => c.id),
    ),
  ]);
  if (erreurReglages) throw new Error(`agent_reglages : ${erreurReglages.message}`);
  const profilParOrg = new Map((reglages ?? []).map((r) => [r.organization_id, profilDe(r.profil)]));

  let faits = 0;
  for (const c of conversations) {
    // Pas de réglages ou de profil : `tournerConversation` ne ferait rien non plus.
    if (!profilParOrg.get(c.organization_id)) continue;

    const lignes = sorties.get(c.id) ?? [];
    const envois = versEnvois(lignes.filter((m) => m.genre === "modele" && m.cle_envoi !== null));
    const derniere_sortie_le = lignes.reduce<string | null>(
      (max, m) => (max === null || Date.parse(m.created_at) > Date.parse(max) ? m.created_at : max),
      null,
    );
    const actions = planifier({ ...c, envois, derniere_sortie_le }, maintenantDe(c, reel));
    if (actions.length === 0) continue;

    faits += await tournerConversation(admin, c.id, reel);
  }
  return faits;
}
