import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { BUCKET_DIAGNOSTICS, rapatrier } from "./enregistrement-assemblyai";
import { lireResume, type Enregistrement, type EtatTranscription, type Replique } from "./enregistrement-format";

/**
 * La lecture des enregistrements de diagnostic (0049), pour les pages.
 * La transcription et l'entretien sont dans `enregistrement-assemblyai.ts`.
 */

const LIEN_LECTURE = 60 * 60;

/**
 * Les enregistrements de ces rendez-vous, tels que qui regarde a le droit de
 * les voir (session, RLS de la 0049), avec un lien de lecture d'une heure.
 * Une transcription encore en cours est d'abord relue chez AssemblyAI.
 */
export async function getEnregistrements(bookingIds: string[]): Promise<Record<string, Enregistrement>> {
  if (bookingIds.length === 0) return {};
  const supabase = await createClient();

  const colonnes =
    "booking_id, chemin, nom_fichier, taille, sans_enregistrement, resume, transcription_etat, transcription_id, transcription, depose_le, profiles:depose_par(full_name)";
  const lire = () => supabase.from("radar_diagnostic_enregistrements").select(colonnes).in("booking_id", bookingIds);

  let { data } = await lire();
  const enCours = (data ?? []).filter((l) => l.transcription_etat === "en_cours");
  if (enCours.length && (await rapatrier(createAdminClient(), enCours)) > 0) {
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
