"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";

import { createClient } from "@/lib/supabase/client";

import { nettoyerEnvoisAbandonnes, rafraichirApresLot } from "./actions";
import { mesurer } from "./media";
import { empreinte, memoriser, oublier, retrouver } from "./reprises";

/**
 * La file d'envoi.
 *
 * Elle vit dans le layout de l'outil, pas dans une page : passer d'un dossier
 * à l'autre ne doit pas interrompre un envoi de 1,8 Go.
 *
 * Les fichiers partent du navigateur droit vers le Storage, en TUS, sans
 * traverser Vercel — c'est ce qui les rend reprenables et ce qui évite de
 * faire transiter des gigaoctets par une fonction serverless. La ligne `files`
 * est écrite depuis le navigateur pour la même raison : quarante fichiers,
 * c'est quarante insertions, et les Server Actions de Next s'exécutent une par
 * une. La RLS protège (`files_insert` impose `uploaded_by = auth.uid()`), et
 * c'est l'exception que CLAUDE.md §7 prévoit pour ce genre d'outil.
 */

const BUCKET = "fichiers";
const MORCEAU = 6 * 1024 * 1024; // imposé par Supabase
const PARALLELE = 3;
const TAILLE_MAX = 5 * 1024 * 1024 * 1024;

export type EtatEnvoi =
  | "attente"
  | "envoi"
  | "termine"
  | "echec"
  | "annule"
  | "refuse";

export type Envoi = {
  cle: string;
  nom: string;
  taille: number;
  folderId: string | null;
  etat: EtatEnvoi;
  envoye: number;
  /** Octets par seconde, lissés — une mesure brute clignote trop pour être lue. */
  vitesse: number;
  message?: string;
  fileId?: string;
};

type Contexte = {
  envois: Envoi[];
  ajouter: (fichiers: File[], folderId: string | null) => void;
  annuler: (cle: string) => void;
  reprendre: (cle: string) => void;
  retirer: (cle: string) => void;
  vider: () => void;
};

const ContexteEnvois = createContext<Contexte | null>(null);

export function useEnvois(): Contexte {
  const contexte = useContext(ContexteEnvois);
  if (!contexte) {
    throw new Error("useEnvois doit être utilisé dans FichiersProvider.");
  }
  return contexte;
}

export const enCours = (envoi: Envoi) =>
  envoi.etat === "attente" || envoi.etat === "envoi";

export function FichiersProvider({
  orgSlug,
  organizationId,
  userId,
  children,
}: {
  orgSlug: string;
  organizationId: string;
  userId: string;
  children: React.ReactNode;
}) {
  const [envois, setEnvois] = useState<Envoi[]>([]);

  /*
   * La file fait foi dans une ref, pas dans l'état : l'ordonnanceur décide de
   * démarrer le suivant juste après avoir marqué le précédent terminé, sans
   * attendre un rendu. L'état, lui, ne sert qu'à afficher.
   */
  const fileRef = useRef<Envoi[]>([]);
  const fichiersRef = useRef(new Map<string, File>());
  const uploadsRef = useRef(new Map<string, tus.Upload>());
  const empreintesRef = useRef(new Map<string, string>());
  const dossiersTouchesRef = useRef(new Set<string | null>());

  const majFile = useCallback((maj: (file: Envoi[]) => Envoi[]) => {
    fileRef.current = maj(fileRef.current);
    setEnvois(fileRef.current);
  }, []);

  const patcher = useCallback(
    (cle: string, patch: Partial<Envoi>) =>
      majFile((file) =>
        file.map((envoi) => (envoi.cle === cle ? { ...envoi, ...patch } : envoi)),
      ),
    [majFile],
  );

  // ------------------------------ fin de lot ------------------------------

  /**
   * Quand plus rien ne part, on rafraîchit les dossiers touchés : c'est
   * `revalidatePath` qui fait apparaître les fichiers dans la liste, sans
   * rechargement.
   */
  const cloreLot = useCallback(async () => {
    if (fileRef.current.some(enCours)) return;

    const dossiers = [...dossiersTouchesRef.current];
    dossiersTouchesRef.current.clear();
    if (dossiers.length === 0) return;

    for (const folderId of dossiers) {
      await rafraichirApresLot(orgSlug, folderId);
    }
  }, [orgSlug]);

  // ---------------------------- ordonnancement ----------------------------

  /*
   * `lancer` et `demarrerSuivants` s'appellent l'un l'autre : l'ordonnanceur
   * démarre un envoi, et un envoi terminé rappelle l'ordonnanceur. La ref
   * rompt la boucle. Elle est rafraîchie après chaque rendu, jamais pendant.
   */
  const lancerRef = useRef<(cle: string) => void>(() => {});

  const demarrerSuivants = useCallback(() => {
    const partis = fileRef.current.filter((e) => e.etat === "envoi").length;
    const places = PARALLELE - partis;
    if (places <= 0) {
      void cloreLot();
      return;
    }

    const suivants = fileRef.current
      .filter((e) => e.etat === "attente")
      .slice(0, places);

    if (suivants.length === 0) {
      void cloreLot();
      return;
    }

    for (const envoi of suivants) lancerRef.current(envoi.cle);
  }, [cloreLot]);

  // ------------------------------ nettoyage -------------------------------

  const nettoyerLigne = useCallback(
    async (fileId: string | undefined) => {
      if (!fileId) return;
      const supabase = createClient();

      await supabase.storage.from(BUCKET).remove([`${organizationId}/${fileId}`]);
      await supabase.from("files").delete().eq("id", fileId);
    },
    [organizationId],
  );

  // -------------------------------- l'envoi -------------------------------

  const lancer = useCallback(
    async (cle: string) => {
      const envoi = fileRef.current.find((e) => e.cle === cle);
      const fichier = fichiersRef.current.get(cle);
      if (!envoi || !fichier || envoi.etat !== "attente") return;

      patcher(cle, { etat: "envoi" });

      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const jeton = session.session?.access_token;

      if (!jeton) {
        patcher(cle, { etat: "echec", message: "Session expirée. Reconnecte-toi." });
        demarrerSuivants();
        return;
      }

      /*
       * Reprise : si ce fichier exact a déjà été entamé, on reprend sa ligne
       * et son objet. Sans ça, on repartirait de zéro dans un objet neuf.
       */
      const cleReprise = empreinte(orgSlug, envoi.folderId, fichier);
      empreintesRef.current.set(cle, cleReprise);

      const memoire = retrouver(cleReprise);
      let fileId = memoire?.fileId;

      if (fileId) {
        const { data } = await supabase
          .from("files")
          .select("id")
          .eq("id", fileId)
          .eq("status", "uploading")
          .maybeSingle();
        if (!data) fileId = undefined;
      }

      if (!fileId) {
        const mesures = await mesurer(fichier);

        const { data, error } = await supabase
          .from("files")
          .insert({
            organization_id: organizationId,
            folder_id: envoi.folderId,
            name: fichier.name,
            size_bytes: fichier.size,
            mime_type: fichier.type || "application/octet-stream",
            uploaded_by: userId,
            width: mesures.width ?? null,
            height: mesures.height ?? null,
            duration_seconds: mesures.durationSeconds ?? null,
          })
          .select("id")
          .single();

        if (error || !data) {
          patcher(cle, {
            etat: "echec",
            message: "Impossible d'inscrire ce fichier.",
          });
          demarrerSuivants();
          return;
        }

        fileId = data.id;
        memoriser(cleReprise, {
          fileId,
          folderId: envoi.folderId,
          nom: fichier.name,
          taille: fichier.size,
        });
      }

      patcher(cle, { fileId });

      let dernierInstant = Date.now();
      let dernierOctet = 0;

      const upload = new tus.Upload(fichier, {
        endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
        headers: {
          authorization: `Bearer ${jeton}`,
          "x-upsert": "true",
        },
        chunkSize: MORCEAU,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        removeFingerprintOnSuccess: true,
        fingerprint: async () => cleReprise,
        metadata: {
          bucketName: BUCKET,
          objectName: `${organizationId}/${fileId}`,
          contentType: fichier.type || "application/octet-stream",
          cacheControl: "3600",
        },
        onProgress: (envoye) => {
          const maintenant = Date.now();
          const ecart = (maintenant - dernierInstant) / 1000;

          // Une mesure par demi-seconde : plus souvent, le chiffre danse.
          if (ecart >= 0.5) {
            const brute = (envoye - dernierOctet) / ecart;
            dernierInstant = maintenant;
            dernierOctet = envoye;

            const precedent =
              fileRef.current.find((e) => e.cle === cle)?.vitesse ?? 0;
            const lissee = precedent ? precedent * 0.6 + brute * 0.4 : brute;
            patcher(cle, { envoye, vitesse: lissee });
            return;
          }

          patcher(cle, { envoye });
        },
        onSuccess: () => {
          void (async () => {
            await supabase.from("files").update({ status: "ready" }).eq("id", fileId);

            oublier(cleReprise);
            uploadsRef.current.delete(cle);
            fichiersRef.current.delete(cle);

            patcher(cle, { etat: "termine", envoye: fichier.size, vitesse: 0 });
            demarrerSuivants();
          })();
        },
        onError: (erreur) => {
          uploadsRef.current.delete(cle);

          /*
           * La ligne et l'objet partiel restent : c'est exactement ce qui
           * permet de reprendre là où ça s'est arrêté. Annuler, en revanche,
           * efface tout — et ce qui n'est jamais repris part au ménage des
           * 24 heures.
           */
          patcher(cle, {
            etat: "echec",
            vitesse: 0,
            message: message(erreur),
          });
          demarrerSuivants();
        },
      });

      uploadsRef.current.set(cle, upload);

      const precedents = await upload.findPreviousUploads();
      if (precedents.length > 0) upload.resumeFromPreviousUpload(precedents[0]);

      dossiersTouchesRef.current.add(envoi.folderId);
      upload.start();
    },
    [demarrerSuivants, organizationId, orgSlug, patcher, userId],
  );


  // -------------------------------- l'API ---------------------------------

  const ajouter = useCallback(
    (fichiers: File[], folderId: string | null) => {
      const nouveaux: Envoi[] = [];

      for (const fichier of fichiers) {
        const cle = crypto.randomUUID();

        const refus =
          fichier.size === 0
            ? "Ce fichier est vide."
            : fichier.size > TAILLE_MAX
              ? "Ce fichier dépasse 5 Go, la limite par fichier."
              : null;

        if (!refus) fichiersRef.current.set(cle, fichier);

        nouveaux.push({
          cle,
          nom: fichier.name,
          taille: fichier.size,
          folderId,
          etat: refus ? "refuse" : "attente",
          envoye: 0,
          vitesse: 0,
          message: refus ?? undefined,
        });
      }

      if (nouveaux.length === 0) return;

      majFile((file) => [...file, ...nouveaux]);
      demarrerSuivants();
    },
    [demarrerSuivants, majFile],
  );

  const annuler = useCallback(
    (cle: string) => {
      const envoi = fileRef.current.find((e) => e.cle === cle);
      if (!envoi) return;

      const upload = uploadsRef.current.get(cle);
      uploadsRef.current.delete(cle);
      fichiersRef.current.delete(cle);

      const cleReprise = empreintesRef.current.get(cle);
      if (cleReprise) oublier(cleReprise);

      patcher(cle, { etat: "annule", vitesse: 0, message: undefined });

      void (async () => {
        // `abort(true)` termine l'envoi côté serveur au lieu de le suspendre.
        if (upload) await upload.abort(true).catch(() => undefined);
        await nettoyerLigne(envoi.fileId);
        demarrerSuivants();
      })();
    },
    [demarrerSuivants, nettoyerLigne, patcher],
  );

  /** Après un échec : on repart d'où l'objet s'est arrêté, pas de zéro. */
  const reprendre = useCallback(
    (cle: string) => {
      const envoi = fileRef.current.find((e) => e.cle === cle);
      if (!envoi || !fichiersRef.current.has(cle)) return;

      patcher(cle, { etat: "attente", message: undefined });
      demarrerSuivants();
    },
    [demarrerSuivants, patcher],
  );

  const retirer = useCallback(
    (cle: string) => {
      fichiersRef.current.delete(cle);
      empreintesRef.current.delete(cle);
      majFile((file) => file.filter((envoi) => envoi.cle !== cle));
    },
    [majFile],
  );

  const vider = useCallback(
    () => majFile((file) => file.filter(enCours)),
    [majFile],
  );

  // ------------------------------ garde-fous ------------------------------

  useEffect(() => {
    lancerRef.current = (cle) => void lancer(cle);
  });

  // Quitter la page pendant un envoi, c'est le perdre : on prévient.
  useEffect(() => {
    const actifs = envois.some(enCours);
    if (!actifs) return;

    const prevenir = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevenir);
    return () => window.removeEventListener("beforeunload", prevenir);
  }, [envois]);

  // À l'ouverture de l'outil : les envois abandonnés depuis plus de 24 h.
  useEffect(() => {
    void nettoyerEnvoisAbandonnes(orgSlug);
  }, [orgSlug]);

  return (
    <ContexteEnvois.Provider
      value={{ envois, ajouter, annuler, reprendre, retirer, vider }}
    >
      {children}
    </ContexteEnvois.Provider>
  );
}

/** Ce qu'on peut dire d'une erreur TUS sans jargon. */
function message(erreur: Error): string {
  const texte = erreur.message ?? "";

  if (texte.includes("413")) return "Ce fichier dépasse la taille autorisée.";
  if (texte.includes("401") || texte.includes("403")) {
    return "Accès refusé. Reconnecte-toi, puis reprends l'envoi.";
  }
  return "Envoi interrompu. Tu peux le reprendre.";
}
