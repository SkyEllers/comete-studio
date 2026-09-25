import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { envoyer } from "../fichiers/courriel.ts";
import { envoyerLibre, maintenantDe } from "./envoi.ts";
import { finDeFenetre, mailDeLaFile, sansPrenom } from "./file-regles.ts";

export { finDeFenetre, mailDeLaFile, sansPrenom };

type Admin = ReturnType<typeof createAdminClient>;

/**
 * La file des questions : ce qui revient à Louis, et rien d'autre (P12,
 * « le minimum à gérer »).
 *
 *   incertain   l'agent n'est pas sûr. Elle a reçu « je vérifie et je
 *               reviens » ; Louis corrige le brouillon, l'agent l'envoie, et
 *               la réponse devient une réponse fixe pour la fois suivante.
 *   detresse    le 3114 est déjà parti. Louis est prévenu, rien à faire.
 *
 * Le mail ne porte ni prénom, ni message, ni rien de sa santé : il dit
 * seulement qu'une question attend, et où. Le contenu se lit dans le hub,
 * derrière la connexion de Louis.
 */

/** Les lignes qu'on écrit dans la file. */
export type NouvelleQuestion = {
  conversation_id: string;
  organization_id: string;
  message_id: string;
  genre: "incertain" | "detresse";
  question: string;
  brouillon: string | null;
  created_at: string;
};

/**
 * Mettre une question dans la file, puis prévenir Louis. Un mail qui ne part
 * pas ne défait rien : la question reste dans la file, `notifie_le` vide.
 */
export async function mettreEnFile(admin: Admin, q: NouvelleQuestion): Promise<string | null> {
  const { data, error } = await admin
    .from("agent_questions")
    .insert({
      ...q,
      question: q.question.slice(0, 2000),
      brouillon: q.brouillon?.slice(0, 2000) ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("Agent : question non mise en file", error?.code);
    return null;
  }
  await prevenirLouis(admin, data.id);
  return data.id;
}

async function prevenirLouis(admin: Admin, questionId: string): Promise<boolean> {
  const { data: q } = await admin
    .from("agent_questions")
    .select("id, genre, organization_id, conversation_id")
    .eq("id", questionId)
    .single();
  if (!q) return false;

  const [{ data: org }, { data: c }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", q.organization_id).single(),
    admin.from("agent_conversations").select("simulation").eq("id", q.conversation_id).single(),
  ]);

  const racine = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const parti = await envoyer(
    mailDeLaFile({
      genre: q.genre as "incertain" | "detresse",
      client: org?.name ?? "?",
      simulation: c?.simulation ?? false,
      lien: `${racine}/admin/agent/file`,
    }),
  );
  if (parti) {
    await admin
      .from("agent_questions")
      .update({ notifie_le: new Date().toISOString() })
      .eq("id", q.id);
  }
  return parti;
}

export type Traitement =
  | { choix: "envoyer"; texte: string; fixe: { question: string } | null }
  | { choix: "classer" };

export type IssueTraitement =
  | { ok: true }
  | { ok: false; erreur: string };

/**
 * Louis a tranché. Envoyer : la réponse part dans la conversation, une seule
 * fois (clé `file:<id>`), et devient une réponse fixe s'il l'a gardée.
 * Classer : rien ne part.
 */
export async function traiter(
  admin: Admin,
  questionId: string,
  t: Traitement,
  reel = Date.now(),
): Promise<IssueTraitement> {
  const { data: q } = await admin
    .from("agent_questions")
    .select("id, genre, etat, conversation_id, organization_id")
    .eq("id", questionId)
    .maybeSingle();
  if (!q) return { ok: false, erreur: "Question introuvable." };
  if (q.etat !== "ouverte") return { ok: false, erreur: "Cette question est déjà traitée." };

  const traitee_le = new Date(reel).toISOString();

  if (t.choix === "classer") {
    const { error } = await admin
      .from("agent_questions")
      .update({ etat: "classee", traitee_le })
      .eq("id", q.id)
      .eq("etat", "ouverte");
    return error ? { ok: false, erreur: "La question n'a pas pu être classée." } : { ok: true };
  }

  if (q.genre === "detresse") {
    return { ok: false, erreur: "La détresse a déjà reçu sa réponse fixe : classe-la." };
  }

  const { data: c } = await admin
    .from("agent_conversations")
    .select("id, etat, simulation, decalage, prenom, derniere_entree_le, organization_id")
    .eq("id", q.conversation_id)
    .single();
  if (!c) return { ok: false, erreur: "Conversation introuvable." };
  if (c.etat !== "active") {
    return { ok: false, erreur: "La conversation est close (STOP, annulée ou terminée) : classe la question." };
  }

  // Hors fenêtre, WhatsApp refuse un message libre. En simulation, rien ne
  // bloque : on veut voir la suite.
  const { data: reglages } = await admin
    .from("agent_reglages")
    .select("canal")
    .eq("organization_id", c.organization_id)
    .single();
  const fin = finDeFenetre(c.derniere_entree_le);
  if (!c.simulation && reglages?.canal === "whatsapp" && (fin === null || maintenantDe(c, reel) > fin)) {
    return {
      ok: false,
      erreur: "Plus de 24 h depuis son dernier message : WhatsApp refuserait l'envoi. Classe-la, ou attends qu'elle réécrive.",
    };
  }

  const parti = await envoyerLibre(admin, c.id, t.texte, { reel, cle: `file:${q.id}` });
  if (!parti) return { ok: false, erreur: "La réponse n'est pas partie. Réessaie dans un instant." };

  await admin
    .from("agent_questions")
    .update({ etat: "envoyee", reponse: t.texte, traitee_le })
    .eq("id", q.id);

  if (t.fixe) {
    await admin.from("agent_reponses_fixes").insert({
      organization_id: q.organization_id,
      question: sansPrenom(t.fixe.question, c.prenom).slice(0, 2000),
      reponse: sansPrenom(t.texte, c.prenom).slice(0, 2000),
    });
  }
  return { ok: true };
}
