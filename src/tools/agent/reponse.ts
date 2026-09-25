import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

import { envoyerLibre, maintenantDe } from "./envoi.ts";
import { demanderDecision, lireTarifs } from "./ia.ts";
import { profil as profilDe } from "./profils/index.ts";
import { consignesStables, contexteDuMoment, transcrire, type Decision } from "./prompt.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Répondre à son dernier message.
 *
 * L'IA décide ; le code garde la main sur ce qui ne se délègue pas :
 *
 *   détresse      le texte fixe part (3114), jamais un texte de l'IA, et la
 *                 question entre dans la file pour que Louis le sache ;
 *   pas sûre      la question entre dans la file avec le brouillon de l'IA,
 *                 et elle reçoit seulement « je vérifie et je reviens » ;
 *   IA en panne   même chemin que « pas sûre » : aucune cliente sans réponse ;
 *   sinon         la réponse part telle quelle.
 *
 * Un seul envoi par message reçu, même si l'horloge passe deux fois : la clé
 * `reponse:<id du message>` le garantit.
 *
 * Le mail à Louis pour la file et la détresse vient à l'étape suivante (7).
 */

export type Issue = "repondu" | "file" | "detresse" | "rien";

export async function repondre(admin: Admin, conversationId: string, reel = Date.now()): Promise<Issue> {
  const { data: c } = await admin
    .from("agent_conversations")
    .select(
      "id, organization_id, decalage, etat, prenom, rdv_debut, fuseau, confirme_le, facon_de_decider, reports_agent, contenu_propose_le, reponses",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (!c || c.etat !== "active") return "rien";

  const [{ data: reglages }, { data: fil }, { data: fixes }] = await Promise.all([
    admin.from("agent_reglages").select("profil").eq("organization_id", c.organization_id).maybeSingle(),
    admin
      .from("agent_messages")
      .select("id, sens, genre, modele, texte, created_at, comprehension")
      .eq("conversation_id", c.id)
      .order("created_at"),
    admin
      .from("agent_reponses_fixes")
      .select("question, reponse")
      .eq("organization_id", c.organization_id)
      .eq("actif", true)
      .order("created_at"),
  ]);
  const profil = reglages ? profilDe(reglages.profil) : null;
  const dernier = fil?.at(-1);
  if (!profil || !fil || !dernier || dernier.sens !== "entrant") return "rien";

  const maintenant = maintenantDe(c, reel);
  const reponses = (c.reponses as { question: string; answer: string }[]) ?? [];
  const appel = await demanderDecision({
    stables: consignesStables(profil, fixes ?? []),
    moment: contexteDuMoment({ ...c, reponses }, maintenant, await lireTarifs(profil.urlTarifs)),
    fil: transcrire(fil, c.fuseau),
  });

  const cle = `reponse:${dernier.id}`;
  const noter = (comprehension: Record<string, unknown>) =>
    admin
      .from("agent_messages")
      .update({ comprehension: { ...(dernier.comprehension as object), ...comprehension } as Json })
      .eq("id", dernier.id);

  // ------------------------------ Panne de l'IA ------------------------------
  if (!appel) {
    if (!(await envoyerLibre(admin, c.id, profil.textes.attente, { reel, cle }))) return "rien";
    await mettreEnFile(admin, c, dernier.id, "incertain", {
      question: "L'IA n'a pas pu répondre à ce message : à toi de lui écrire.",
      brouillon: null,
      maintenant,
    });
    await noter({ ia: "panne" });
    return "file";
  }

  const d = appel.decision;
  await noter({ ia: resumeDecision(d), cache: appel.usage.cache_read_input_tokens ?? 0 });

  // ------------------------------- Détresse ----------------------------------
  if (d.detresse) {
    if (!(await envoyerLibre(admin, c.id, profil.textes.detresse, { reel, cle }))) return "rien";
    await mettreEnFile(admin, c, dernier.id, "detresse", {
      question: dernier.texte,
      brouillon: null,
      maintenant,
    });
    return "detresse";
  }

  // ------------------------------- Pas sûre ----------------------------------
  if (!d.sur || !d.reponse.trim()) {
    if (!(await envoyerLibre(admin, c.id, profil.textes.attente, { reel, cle }))) return "rien";
    await mettreEnFile(admin, c, dernier.id, "incertain", {
      question: d.question_pour_louis || dernier.texte,
      brouillon: d.reponse || null,
      maintenant,
    });
    return "file";
  }

  // --------------------------------- Sûre -----------------------------------
  if (!(await envoyerLibre(admin, c.id, d.reponse.trim(), { reel, cle }))) return "rien";

  const iso = new Date(maintenant).toISOString();
  await admin
    .from("agent_conversations")
    .update({
      ...(d.confirme ? { confirme_le: iso } : {}),
      ...(d.contenu_propose && !c.contenu_propose_le ? { contenu_propose_le: iso } : {}),
    })
    .eq("id", c.id);
  return "repondu";
}

/** Ce qu'on garde de la décision, sur le message reçu : de quoi relire l'agent. */
function resumeDecision(d: Decision) {
  return {
    sur: d.sur,
    confirme: d.confirme,
    veut_changer: d.veut_changer,
    detresse: d.detresse,
    contenu_propose: d.contenu_propose || null,
    contenu_envoye: d.contenu_envoye || null,
    note_pour_peggy: d.note_pour_peggy || null,
    question_pour_louis: d.question_pour_louis || null,
  };
}

async function mettreEnFile(
  admin: Admin,
  c: { id: string; organization_id: string },
  messageId: string,
  genre: "incertain" | "detresse",
  q: { question: string; brouillon: string | null; maintenant: number },
) {
  await admin.from("agent_questions").insert({
    conversation_id: c.id,
    organization_id: c.organization_id,
    message_id: messageId,
    genre,
    question: q.question.slice(0, 2000),
    brouillon: q.brouillon?.slice(0, 2000) ?? null,
    created_at: new Date(q.maintenant).toISOString(),
  });
}
