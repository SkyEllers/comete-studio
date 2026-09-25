import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

import { annulerAncien, creneauxLibres, jetonAgent, reserver } from "./calendly.ts";
import { choisirCreneaux } from "./creneaux.ts";
import { envoyerLibre, maintenantDe } from "./envoi.ts";
import { mettreEnFile as mettreDansLaFile } from "./file.ts";
import { demanderDecision, lireTarifs } from "./ia.ts";
import { profil as profilDe } from "./profils/index.ts";
import {
  consignesStables,
  contexteDuMoment,
  transcrire,
  type CreneauxDuMoment,
  type Decision,
} from "./prompt.ts";
import { effaceApres } from "./reservation.ts";

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
 * Chaque entrée dans la file prévient Louis par mail (`file.ts`).
 */

export type Issue = "repondu" | "file" | "detresse" | "rien";

export async function repondre(admin: Admin, conversationId: string, reel = Date.now()): Promise<Issue> {
  const { data: c } = await admin
    .from("agent_conversations")
    .select(
      "id, organization_id, simulation, decalage, etat, prenom, nom, email, rdv_debut, rdv_fin, fuseau, confirme_le, facon_de_decider, reports_agent, contenu_propose_le, reponses, report_demande_le, creneaux_proposes, lien_report, event_uri, event_type_uri, invitee_uri, invites_precedents",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (!c || c.etat !== "active") return "rien";

  const [{ data: reglages }, { data: fil }, { data: fixes }] = await Promise.all([
    admin
      .from("agent_reglages")
      .select("profil, types_suivis")
      .eq("organization_id", c.organization_id)
      .maybeSingle(),
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
  const reponses = (c.reponses as { question: string; answer: string; position: number | null }[]) ?? [];
  const typeUri = c.event_type_uri ?? reglages?.types_suivis[0] ?? null;

  // Un report est en cours et rien n'est encore proposé : on lit l'agenda
  // maintenant, pour que l'IA propose de vrais créneaux.
  let creneaux: CreneauxDuMoment = null;
  if (c.report_demande_le && c.reports_agent < 1 && c.creneaux_proposes.length === 0) {
    const jeton = await jetonAgent(admin, c.organization_id);
    const libres = jeton && typeUri ? await creneauxLibres(jeton, typeUri, maintenant) : null;
    creneaux = libres ? choisirCreneaux(libres, c.rdv_debut, c.fuseau, maintenant) : "illisibles";
  }

  const appel = await demanderDecision({
    stables: consignesStables(profil, fixes ?? []),
    moment: contexteDuMoment(
      { ...c, reponses },
      maintenant,
      await lireTarifs(profil.urlTarifs),
      creneaux,
    ),
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
    // « Oui ça me va, par contre… » : la question monte chez Louis, mais la
    // confirmation, elle, est acquise.
    if (d.confirme && !c.confirme_le) {
      await admin
        .from("agent_conversations")
        .update({ confirme_le: new Date(maintenant).toISOString() })
        .eq("id", c.id);
    }
    await mettreEnFile(admin, c, dernier.id, "incertain", {
      question: d.question_pour_louis || dernier.texte,
      brouillon: d.reponse || null,
      maintenant,
    });
    return "file";
  }

  // ------------------------- Elle a choisi un créneau -----------------------
  const choisi = c.creneaux_proposes.find(
    (p) => d.creneau_choisi !== "" && Date.parse(p) === Date.parse(d.creneau_choisi),
  );
  if (choisi) {
    const deplace = await deplacerRendezVous(admin, c, choisi, typeUri, reponses, profil.textes.raisonAnnulation);
    if (!deplace) {
      if (!(await envoyerLibre(admin, c.id, profil.textes.creneauPris, { reel, cle }))) return "rien";
      await admin.from("agent_conversations").update({ creneaux_proposes: [] }).eq("id", c.id);
      await mettreEnFile(admin, c, dernier.id, "incertain", {
        question: "Le créneau qu'elle a choisi n'a pas pu être réservé dans Calendly : à toi de voir avec elle.",
        brouillon: null,
        maintenant,
      });
      return "file";
    }
  }

  // --------------------------------- Sûre -----------------------------------
  if (!(await envoyerLibre(admin, c.id, d.reponse.trim(), { reel, cle }))) return "rien";

  // Seuls des créneaux vraiment lus dans l'agenda peuvent être retenus.
  const lus = creneaux && creneaux !== "illisibles" ? [...creneaux.memeJour, ...creneaux.plusProches] : [];
  const proposes = d.creneaux_proposes.filter((p) => lus.some((l) => Date.parse(l) === Date.parse(p)));

  const iso = new Date(maintenant).toISOString();
  await admin
    .from("agent_conversations")
    .update({
      ...(d.confirme && !choisi ? { confirme_le: iso } : {}),
      ...(d.contenu_propose && !c.contenu_propose_le ? { contenu_propose_le: iso } : {}),
      ...(d.veut_changer && !c.report_demande_le && !choisi ? { report_demande_le: iso } : {}),
      ...(proposes.length > 0 ? { creneaux_proposes: proposes.map((p) => new Date(p).toISOString()) } : {}),
    })
    .eq("id", c.id);
  return "repondu";
}

type AvantReport = {
  id: string;
  organization_id: string;
  simulation: boolean;
  prenom: string;
  nom: string | null;
  email: string | null;
  fuseau: string;
  rdv_debut: string;
  rdv_fin: string;
  reports_agent: number;
  event_uri: string | null;
  invitee_uri: string;
  invites_precedents: string[];
};

/**
 * Réserver le créneau choisi à sa place, puis annuler l'ancien.
 *
 * En simulation, rien ne part vers Calendly : on fait comme si, pour que
 * Louis voie la suite. En vrai, la réservation passe d'abord ; si elle
 * échoue (créneau pris entre-temps), l'ancien rendez-vous reste, intact.
 * `report_attendu` prévient le webhook que la réservation annoncée par
 * Calendly est celle de l'agent, pas une nouvelle cliente.
 */
async function deplacerRendezVous(
  admin: Admin,
  c: AvantReport,
  choisi: string,
  typeUri: string | null,
  reponses: { question: string; answer: string; position: number | null }[],
  raison: string,
): Promise<boolean> {
  const duree = Date.parse(c.rdv_fin) - Date.parse(c.rdv_debut);
  const commun = {
    reports_agent: c.reports_agent + 1,
    report_demande_le: null,
    creneaux_proposes: [],
    confirme_le: new Date().toISOString(),
    sans_reponse_veille: false,
  };

  if (c.simulation) {
    const fin = new Date(Date.parse(choisi) + duree).toISOString();
    const { error } = await admin
      .from("agent_conversations")
      .update({
        ...commun,
        invitee_uri: `${c.invitee_uri}:report${c.reports_agent + 1}`,
        invites_precedents: [...c.invites_precedents, c.invitee_uri],
        rdv_debut: new Date(choisi).toISOString(),
        rdv_fin: fin,
        efface_apres: effaceApres(fin),
      })
      .eq("id", c.id);
    return !error;
  }

  const jeton = await jetonAgent(admin, c.organization_id);
  if (!jeton || !typeUri || !c.email || !c.event_uri) return false;

  await admin
    .from("agent_conversations")
    .update({ report_attendu: new Date(choisi).toISOString() })
    .eq("id", c.id);

  const nouveau = await reserver(jeton, {
    typeUri,
    debut: choisi,
    prenom: c.prenom,
    nom: c.nom,
    email: c.email,
    fuseau: c.fuseau,
    reponses,
  });
  if (!nouveau) {
    await admin.from("agent_conversations").update({ report_attendu: null }).eq("id", c.id);
    return false;
  }

  // Le webhook de la nouvelle réservation fait la même mise à jour ; celle
  // qui arrive en second voit l'invité déjà en place et ne change rien.
  const { data: actuelle } = await admin
    .from("agent_conversations")
    .select("invitee_uri, invites_precedents")
    .eq("id", c.id)
    .single();
  if (actuelle && actuelle.invitee_uri !== nouveau.inviteeUri) {
    await admin
      .from("agent_conversations")
      .update({
        ...commun,
        invitee_uri: nouveau.inviteeUri,
        invites_precedents: [...actuelle.invites_precedents, actuelle.invitee_uri],
        event_uri: nouveau.eventUri,
        rdv_debut: nouveau.debut,
        rdv_fin: nouveau.fin,
        lien_visio: nouveau.lienVisio,
        lien_report: nouveau.lienReport,
        lien_annulation: nouveau.lienAnnulation,
        report_attendu: null,
        efface_apres: effaceApres(nouveau.fin),
      })
      .eq("id", c.id);
  } else {
    await admin.from("agent_conversations").update(commun).eq("id", c.id);
  }

  if (!(await annulerAncien(jeton, c.event_uri, raison))) {
    // Deux rendez-vous plutôt qu'aucun : Louis annule l'ancien à la main.
    console.error("Agent : l'ancien rendez-vous reste à annuler dans Calendly");
  }
  return true;
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

function mettreEnFile(
  admin: Admin,
  c: { id: string; organization_id: string },
  messageId: string,
  genre: "incertain" | "detresse",
  q: { question: string; brouillon: string | null; maintenant: number },
) {
  return mettreDansLaFile(admin, {
    conversation_id: c.id,
    organization_id: c.organization_id,
    message_id: messageId,
    genre,
    question: q.question,
    brouillon: q.brouillon,
    created_at: new Date(q.maintenant).toISOString(),
  });
}
