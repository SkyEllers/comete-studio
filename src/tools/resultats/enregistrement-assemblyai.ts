import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../lib/supabase/database.types.ts";

import { versRepliques, type EtatTranscription, type Replique } from "./enregistrement-format.ts";

/**
 * La transcription des diagnostics, et l'entretien des enregistrements (0049).
 *
 * La transcription passe par AssemblyAI, sur ses serveurs européens (Dublin) :
 * il prend la vidéo telle quelle, jusqu'à 5 Go, par un lien signé du Storage,
 * sans qu'elle traverse Vercel. Il rend qui parle (A, B…) réplique par
 * réplique. Une fois le texte rapatrié chez nous, la transcription est effacée
 * chez lui : les diagnostics sont des données de santé.
 *
 * Sans clé ou en panne, rien ne casse (CLAUDE.md §8) : la vidéo reste déposée
 * et se regarde, la transcription affiche « échec » et se relance à la main.
 *
 * Chemins relatifs et client passé en paramètre : le banc
 * (`scripts/qa-diagnostic.mjs`) importe ce module sous `node`, sans les alias
 * du bundler.
 */

type Admin = SupabaseClient<Database>;

export const BUCKET_DIAGNOSTICS = "diagnostics";

/** Combien de temps on garde un enregistrement après le rendez-vous (Louis, 28/09/2026). */
export const CONSERVATION_MOIS = 6;

const API = "https://api.eu.assemblyai.com/v2";
/** Le temps laissé à AssemblyAI pour aller chercher la vidéo : une file d'attente peut durer. */
const LIEN_TRANSCRIPTION = 60 * 60 * 24;

const TABLE = "radar_diagnostic_enregistrements";

function cle() {
  return process.env.ASSEMBLYAI_API_KEY?.trim() || null;
}

async function appeler(chemin: string, init: { method?: string; json?: unknown } = {}) {
  const k = cle();
  if (!k) throw new Error("ASSEMBLYAI_API_KEY absente");
  const reponse = await fetch(`${API}${chemin}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: k,
      "user-agent": "comete-hub/1.0 (app.cometestudio.fr)",
      ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
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
 * Lance la transcription d'un enregistrement déposé, et écrit l'état sur la
 * ligne. Service role : l'appelant a déjà prouvé son droit en déposant.
 */
export async function lancerTranscription(admin: Admin, bookingId: string): Promise<EtatTranscription> {
  const { data: ligne } = await admin.from(TABLE).select("chemin").eq("booking_id", bookingId).maybeSingle();
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
      .from(TABLE)
      .update({ transcription_etat: "en_cours", transcription_id: id, transcription_erreur: null })
      .eq("booking_id", bookingId)
      .eq("chemin", ligne.chemin);
    return "en_cours";
  } catch (e) {
    // Jamais de donnée personnelle au journal : l'identifiant du rendez-vous suffit.
    console.error(`[diagnostic] transcription non lancée (${bookingId}) : ${(e as Error).message}`);
    await admin
      .from(TABLE)
      .update({ transcription_etat: "echec", transcription_erreur: (e as Error).message.slice(0, 500) })
      .eq("booking_id", bookingId)
      .eq("chemin", ligne.chemin);
    return "echec";
  }
}

/**
 * Va chercher les transcriptions encore en cours, et range celles qui sont
 * prêtes. Appelé à la lecture des pages et par l'horloge : sans route publique
 * pour recevoir un webhook.
 */
export async function rapatrier(
  admin: Admin,
  lignes: { booking_id: string; transcription_id: string | null }[],
): Promise<number> {
  if (!cle() || lignes.length === 0) return 0;
  let prets = 0;

  await Promise.all(
    lignes.map(async (l) => {
      if (!l.transcription_id) return;
      const id = encodeURIComponent(l.transcription_id);
      try {
        const t = await appeler(`/transcript/${id}`);
        if (t.status === "completed") {
          const repliques: Replique[] = versRepliques(t.utterances);
          const { error } = await admin
            .from(TABLE)
            .update({
              transcription_etat: "faite",
              transcription: repliques,
              transcription_le: new Date().toISOString(),
              transcription_erreur: null,
            })
            .eq("booking_id", l.booking_id)
            .eq("transcription_id", l.transcription_id);
          if (error) return;
          prets += 1;
          // Rangé chez nous : on l'efface chez eux. Un échec ici ne coûte
          // qu'une copie qui traîne ; il ne doit pas faire perdre le texte.
          await appeler(`/transcript/${id}`, { method: "DELETE" }).catch((e: Error) =>
            console.error(`[diagnostic] effacement AssemblyAI raté (${l.booking_id}) : ${e.message}`),
          );
        } else if (t.status === "error") {
          await admin
            .from(TABLE)
            .update({
              transcription_etat: "echec",
              transcription_erreur: String(t.error ?? "erreur inconnue").slice(0, 500),
            })
            .eq("booking_id", l.booking_id)
            .eq("transcription_id", l.transcription_id);
        }
      } catch (e) {
        // Réseau lent ou service indisponible : on réessaiera au prochain passage.
        console.error(`[diagnostic] relecture de la transcription (${l.booking_id}) : ${(e as Error).message}`);
      }
    }),
  );
  return prets;
}

/**
 * Le passage de l'horloge (`api/agent/horloge`, toutes les 5 minutes) :
 *
 * - rapatrie les transcriptions prêtes, pour qu'elles arrivent même quand
 *   personne n'ouvre la fiche ;
 * - efface la vidéo, la transcription et le résumé des diagnostics passés
 *   depuis plus de six mois. Le Storage refuse qu'on efface ses objets en SQL :
 *   c'est donc le hub qui s'en charge, et pas une tâche de la base.
 */
export async function entretenirEnregistrements(
  admin: Admin,
  maintenant: Date = new Date(),
): Promise<{ rapatries: number; effaces: number }> {
  const { data: enCours } = await admin
    .from(TABLE)
    .select("booking_id, transcription_id")
    .eq("transcription_etat", "en_cours")
    .limit(20);
  const rapatries = await rapatrier(admin, enCours ?? []);

  const limite = new Date(maintenant);
  limite.setMonth(limite.getMonth() - CONSERVATION_MOIS);

  const { data: tous } = await admin.from(TABLE).select("booking_id, chemin");
  if (!tous?.length) return { rapatries, effaces: 0 };

  const { data: passes } = await admin
    .from("radar_bookings")
    .select("id")
    .in(
      "id",
      tous.map((l) => l.booking_id),
    )
    .lt("scheduled_end", limite.toISOString())
    .limit(100);
  const aEffacer = new Set((passes ?? []).map((b) => b.id));
  if (aEffacer.size === 0) return { rapatries, effaces: 0 };

  const lignes = tous.filter((l) => aEffacer.has(l.booking_id));
  const chemins = lignes.map((l) => l.chemin).filter((c): c is string => Boolean(c));
  if (chemins.length) {
    // Les fichiers d'abord : une ligne effacée avant eux laisserait des vidéos
    // que plus rien ne retrouve.
    const { error } = await admin.storage.from(BUCKET_DIAGNOSTICS).remove(chemins);
    if (error) {
      console.error(`[diagnostic] purge : fichiers non effacés (${error.message})`);
      return { rapatries, effaces: 0 };
    }
  }
  const { error } = await admin
    .from(TABLE)
    .delete()
    .in(
      "booking_id",
      lignes.map((l) => l.booking_id),
    );
  if (error) console.error(`[diagnostic] purge : lignes non effacées (${error.message})`);
  // L'analyse de l'appel (0055) part avec lui : sa fiche et ses passages suivent
  // par la clé étrangère. Le carnet de leçons, sans nom, reste.
  const { error: analyses } = await admin
    .from("radar_analyses")
    .delete()
    .in(
      "booking_id",
      lignes.map((l) => l.booking_id),
    );
  if (analyses) console.error(`[diagnostic] purge : analyses non effacées (${analyses.message})`);
  return { rapatries, effaces: error ? 0 : lignes.length };
}
