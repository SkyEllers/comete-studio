import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  lireResume,
  versRepliques,
  type Enregistrement,
  type EtatTranscription,
  type Replique,
} from "./enregistrement-format";

/**
 * L'enregistrement du diagnostic, côté serveur (0049).
 *
 * La transcription passe par AssemblyAI, sur ses serveurs européens (Dublin) :
 * il prend la vidéo telle quelle, jusqu'à 5 Go, par un lien signé du Storage,
 * sans qu'elle traverse Vercel. Il rend qui parle (A, B…) réplique par
 * réplique. Une fois le texte rapatrié chez nous, la transcription est effacée
 * chez lui : les diagnostics sont des données de santé.
 *
 * Sans clé ou en panne, rien ne casse (CLAUDE.md §8) : la vidéo reste déposée
 * et se regarde, la transcription affiche « échec » et se relance à la main.
 */

export const BUCKET_DIAGNOSTICS = "diagnostics";

const API = "https://api.eu.assemblyai.com/v2";
/** Le temps laissé à AssemblyAI pour aller chercher la vidéo : une file d'attente peut durer. */
const LIEN_TRANSCRIPTION = 60 * 60 * 24;
const LIEN_LECTURE = 60 * 60;

function cle() {
  return process.env.ASSEMBLYAI_API_KEY?.trim() || null;
}

async function appeler(chemin: string, init: RequestInit & { json?: unknown } = {}) {
  const k = cle();
  if (!k) throw new Error("ASSEMBLYAI_API_KEY absente");
  const { json, ...reste } = init;
  const reponse = await fetch(`${API}${chemin}`, {
    ...reste,
    headers: {
      authorization: k,
      "user-agent": "comete-hub/1.0 (app.cometestudio.fr)",
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : reste.body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const corps: unknown = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    const message =
      corps && typeof corps === "object" && "error" in corps && typeof corps.error === "string"
        ? corps.error
        : `HTTP ${reponse.status}`;
    throw new Error(message.slice(0, 300));
  }
  return (corps ?? {}) as Record<string, unknown>;
}

/**
 * Lance la transcription d'un enregistrement déposé. Écrit l'état sur la ligne
 * (service role : l'appelant a déjà prouvé son droit en déposant).
 */
export async function lancerTranscription(bookingId: string): Promise<EtatTranscription> {
  const admin = createAdminClient();
  const { data: ligne } = await admin
    .from("radar_diagnostic_enregistrements")
    .select("chemin")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (!ligne?.chemin) return "aucune";

  try {
    const { data: signe, error } = await admin.storage
      .from(BUCKET_DIAGNOSTICS)
      .createSignedUrl(ligne.chemin, LIEN_TRANSCRIPTION);
    if (error || !signe?.signedUrl) throw new Error("lien signé impossible");

    const reponse = await appeler("/transcript", {
      method: "POST",
      json: {
        audio_url: signe.signedUrl,
        language_code: "fr",
        speaker_labels: true,
        speakers_expected: 2,
      },
    });
    const id = typeof reponse.id === "string" ? reponse.id : null;
    if (!id) throw new Error("réponse sans identifiant");

    await admin
      .from("radar_diagnostic_enregistrements")
      .update({ transcription_etat: "en_cours", transcription_id: id, transcription_erreur: null })
      .eq("booking_id", bookingId)
      .eq("chemin", ligne.chemin);
    return "en_cours";
  } catch (e) {
    // Jamais de donnée personnelle au journal : l'identifiant du rendez-vous suffit.
    console.error(`[diagnostic] transcription non lancée (${bookingId}) : ${(e as Error).message}`);
    await admin
      .from("radar_diagnostic_enregistrements")
      .update({ transcription_etat: "echec", transcription_erreur: (e as Error).message.slice(0, 500) })
      .eq("booking_id", bookingId)
      .eq("chemin", ligne.chemin);
    return "echec";
  }
}

/**
 * Va chercher les transcriptions encore en cours parmi ces rendez-vous, et
 * range celles qui sont prêtes. Appelé à la lecture des pages : la
 * transcription arrive la première fois que quelqu'un regarde, sans route
 * publique ni tâche de fond.
 */
async function rapatrier(lignes: { booking_id: string; transcription_id: string | null }[]) {
  if (!cle() || lignes.length === 0) return;
  const admin = createAdminClient();

  await Promise.all(
    lignes.map(async (l) => {
      if (!l.transcription_id) return;
      try {
        const t = await appeler(`/transcript/${encodeURIComponent(l.transcription_id)}`);
        if (t.status === "completed") {
          const repliques: Replique[] = versRepliques(t.utterances);
          const { error } = await admin
            .from("radar_diagnostic_enregistrements")
            .update({
              transcription_etat: "faite",
              transcription: repliques,
              transcription_le: new Date().toISOString(),
              transcription_erreur: null,
            })
            .eq("booking_id", l.booking_id)
            .eq("transcription_id", l.transcription_id);
          // Rangé chez nous : on l'efface chez eux. Un échec ici ne coûte
          // qu'une copie qui traîne ; il ne doit pas faire perdre le texte.
          if (!error) {
            await appeler(`/transcript/${encodeURIComponent(l.transcription_id)}`, { method: "DELETE" }).catch(
              (e: Error) => console.error(`[diagnostic] effacement AssemblyAI raté (${l.booking_id}) : ${e.message}`),
            );
          }
        } else if (t.status === "error") {
          await admin
            .from("radar_diagnostic_enregistrements")
            .update({
              transcription_etat: "echec",
              transcription_erreur: String(t.error ?? "erreur inconnue").slice(0, 500),
            })
            .eq("booking_id", l.booking_id)
            .eq("transcription_id", l.transcription_id);
        }
      } catch (e) {
        // Réseau lent ou service indisponible : on réessaiera à la prochaine lecture.
        console.error(`[diagnostic] relecture de la transcription (${l.booking_id}) : ${(e as Error).message}`);
      }
    }),
  );
}

/**
 * Les enregistrements de ces rendez-vous, tels que qui regarde a le droit de
 * les voir (session, RLS de la 0049), avec un lien de lecture d'une heure.
 */
export async function getEnregistrements(bookingIds: string[]): Promise<Record<string, Enregistrement>> {
  if (bookingIds.length === 0) return {};
  const supabase = await createClient();

  const colonnes =
    "booking_id, chemin, nom_fichier, taille, sans_enregistrement, resume, transcription_etat, transcription_id, transcription, depose_le, profiles:depose_par(full_name)";
  const lire = () => supabase.from("radar_diagnostic_enregistrements").select(colonnes).in("booking_id", bookingIds);

  let { data } = await lire();
  const enCours = (data ?? []).filter((l) => l.transcription_etat === "en_cours");
  if (enCours.length) {
    await rapatrier(enCours);
    ({ data } = await lire());
  }

  const lignes = data ?? [];
  const chemins = lignes.map((l) => l.chemin).filter((c): c is string => Boolean(c));
  const liens = new Map<string, string>();
  if (chemins.length) {
    const { data: signes } = await supabase.storage.from(BUCKET_DIAGNOSTICS).createSignedUrls(chemins, LIEN_LECTURE);
    for (const s of signes ?? []) {
      if (s.path && s.signedUrl) liens.set(s.path, s.signedUrl);
    }
  }

  const sortie: Record<string, Enregistrement> = {};
  for (const l of lignes) {
    const profil = l.profiles as { full_name: string | null } | null;
    sortie[l.booking_id] = {
      bookingId: l.booking_id,
      lien: l.chemin ? (liens.get(l.chemin) ?? null) : null,
      nomFichier: l.nom_fichier,
      taille: l.taille,
      sansEnregistrement: l.sans_enregistrement,
      resume: lireResume(l.resume),
      transcriptionEtat: l.transcription_etat as EtatTranscription,
      transcription: Array.isArray(l.transcription) ? (l.transcription as Replique[]) : null,
      deposeLe: l.depose_le,
      deposePar: profil?.full_name ?? null,
    };
  }
  return sortie;
}
