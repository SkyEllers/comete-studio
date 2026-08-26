"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import * as tus from "tus-js-client";

import { createClient } from "@/lib/supabase/client";

import {
  nettoyerEnvoisAbandonnes,
  notifyBatch,
  rafraichirApresLot,
  renameFile,
} from "./actions";
import { couper } from "./format";
import { mesurer, posterVideo } from "./media";
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
  "attente" | "envoi" | "termine" | "echec" | "annule" | "refuse";

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

/** Un fichier en attente d'être nommé et rangé. */
export type EntreePreparation = {
  cle: string;
  fichier: File;
  /** Le nom sans extension : la seule partie modifiable. */
  base: string;
  extension: string;
  refus: string | null;
};

/**
 * Le lot en cours de préparation.
 *
 * Il vit ici et non dans le dialog : déposer d'autres fichiers pendant qu'on
 * nomme les premiers doit les ajouter au lot, sans effacer ce qui est déjà
 * saisi. Le dialog n'a plus qu'à afficher et à rappeler.
 */
export type Preparation = {
  entrees: EntreePreparation[];
  folderId: string | null;
  /** Vide tant que le lot n'a pas de nom commun. */
  nomCommun: string;
};

type Contexte = {
  envois: Envoi[];
  preparation: Preparation | null;
  preparer: (fichiers: File[], folderId: string | null) => void;
  renommerPreparation: (cle: string, base: string) => void;
  retirerDePreparation: (cle: string) => void;
  changerDestination: (folderId: string | null) => void;
  appliquerNomCommun: (nomCommun: string) => void;
  annulerPreparation: () => void;
  envoyer: () => void;
  renommer: (cle: string, nom: string) => void;
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

/**
 * Applique le nom commun au lot : « Tournage octobre 01 », « 02 »…
 *
 * Seuls les fichiers qui partiront sont numérotés — compter les refusés
 * laisserait des trous dans la série déposée. Un nom commun vidé rend à
 * chacun son nom d'origine : c'est ce qui rend le champ sans risque à
 * essayer, et l'inverse exact de l'avoir rempli.
 *
 * `depuis` protège les noms déjà posés : les entrées d'avant ne font que
 * compter. C'est ce qui permet à un fichier ajouté en cours de route de
 * prendre le numéro suivant sans réécrire les retouches faites à la main.
 */
function numeroter(
  entrees: EntreePreparation[],
  nomCommun: string,
  depuis = 0,
): EntreePreparation[] {
  const propre = nomCommun.trim();
  let rang = 0;

  return entrees.map((entree, index) => {
    if (entree.refus) return entree;
    rang += 1;
    if (index < depuis) return entree;

    return {
      ...entree,
      base: propre
        ? `${propre} ${String(rang).padStart(2, "0")}`
        : couper(entree.fichier.name).base,
    };
  });
}

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
  const [preparation, setPreparation] = useState<Preparation | null>(null);

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
  /** Les fichiers réellement arrivés : ce dont l'email de fin de lot parle. */
  const arrivesRef = useRef<string[]>([]);

  const majFile = useCallback((maj: (file: Envoi[]) => Envoi[]) => {
    fileRef.current = maj(fileRef.current);
    setEnvois(fileRef.current);
  }, []);

  const patcher = useCallback(
    (cle: string, patch: Partial<Envoi>) =>
      majFile((file) =>
        file.map((envoi) =>
          envoi.cle === cle ? { ...envoi, ...patch } : envoi,
        ),
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
    const arrives = [...arrivesRef.current];
    dossiersTouchesRef.current.clear();
    arrivesRef.current = [];

    if (dossiers.length === 0 && arrives.length === 0) return;

    for (const folderId of dossiers) {
      await rafraichirApresLot(orgSlug, folderId);
    }

    /*
     * Prévenir Louis vient après le rafraîchissement : le lien de l'email mène
     * au dossier, et il doit y trouver les fichiers annoncés. L'action ne
     * renvoie jamais d'échec — un email raté ne concerne pas qui dépose.
     */
    if (arrives.length > 0) await notifyBatch(orgSlug, arrives);
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

      await supabase.storage
        .from(BUCKET)
        .remove([
          `${organizationId}/${fileId}`,
          `${organizationId}/${fileId}.poster.jpg`,
        ]);
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

      // Une session absente se voit tout de suite : inutile d'inscrire une
      // ligne pour un envoi qui ne partira pas.
      const { data: session } = await supabase.auth.getSession();

      if (!session.session) {
        patcher(cle, {
          etat: "echec",
          message: "Session expirée. Reconnecte-toi.",
        });
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
            name: envoi.nom,
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
        headers: { "x-upsert": "true" },
        /*
         * Le jeton est relu avant chaque morceau, jamais figé au départ : un
         * envoi de plusieurs gigaoctets dure plus qu'une heure de session, et
         * l'envoi tombait alors en 401 au milieu. `getSession()` rend le jeton
         * courant et le renouvelle de lui-même quand il approche de sa fin.
         */
        onBeforeRequest: async (requete) => {
          const { data } = await supabase.auth.getSession();
          const frais = data.session?.access_token;
          if (frais) requete.setHeader("authorization", `Bearer ${frais}`);
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
            await supabase
              .from("files")
              .update({ status: "ready" })
              .eq("id", fileId);

            /*
             * L'image de couverture d'une vidéo, seul dérivé jamais stocké.
             * Après l'envoi, pas avant : une vidéo annulée ne laisse rien.
             * Un échec ici ne coûte qu'une vignette.
             */
            const couverture = await posterVideo(fichier);
            if (couverture) {
              await supabase.storage
                .from(BUCKET)
                .upload(`${organizationId}/${fileId}.poster.jpg`, couverture, {
                  contentType: "image/jpeg",
                  upsert: true,
                });
            }

            oublier(cleReprise);
            uploadsRef.current.delete(cle);
            fichiersRef.current.delete(cle);
            if (fileId) arrivesRef.current.push(fileId);

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

  /**
   * Déposer ouvre d'abord le dialog de préparation : on nomme et on range
   * avant d'envoyer. Un lot déposé pendant qu'un autre se prépare vient s'y
   * ajouter plutôt que de l'écraser — personne n'a envie de reperdre dix noms
   * déjà saisis.
   */
  const preparer = useCallback((fichiers: File[], folderId: string | null) => {
    if (fichiers.length === 0) return;

    const nouvelles: EntreePreparation[] = fichiers.map((fichier) => {
      const { base, extension } = couper(fichier.name);
      return {
        cle: crypto.randomUUID(),
        fichier,
        base,
        extension,
        refus:
          fichier.size === 0
            ? "Fichier vide"
            : fichier.size > TAILLE_MAX
              ? "Dépasse 5 Go"
              : null,
      };
    });

    setPreparation((actuelle) => {
      if (!actuelle) return { entrees: nouvelles, folderId, nomCommun: "" };

      const entrees = [...actuelle.entrees, ...nouvelles];

      // Un lot déjà nommé absorbe les nouveaux venus dans la même série —
      // sinon « Tournage octobre 04 » serait suivi d'un « IMG_5012 » orphelin —
      // mais seuls les nouveaux sont nommés : les autres gardent leur nom.
      return {
        ...actuelle,
        entrees: actuelle.nomCommun.trim()
          ? numeroter(entrees, actuelle.nomCommun, actuelle.entrees.length)
          : entrees,
      };
    });
  }, []);

  const renommerPreparation = useCallback(
    (cle: string, base: string) =>
      setPreparation((actuelle) =>
        actuelle
          ? {
              ...actuelle,
              entrees: actuelle.entrees.map((entree) =>
                entree.cle === cle ? { ...entree, base } : entree,
              ),
            }
          : actuelle,
      ),
    [],
  );

  const retirerDePreparation = useCallback(
    (cle: string) =>
      setPreparation((actuelle) => {
        if (!actuelle) return actuelle;
        const restantes = actuelle.entrees.filter(
          (entree) => entree.cle !== cle,
        );
        // Retirer le dernier ferme le dialog : il n'y a plus rien à préparer.
        if (restantes.length === 0) return null;

        // Pas de renumérotation ici : elle écraserait les retouches faites à
        // la main. Retirer le deuxième de cinq laisse donc un trou entre 01 et
        // 03 — une frappe dans le champ commun referme la série.
        return { ...actuelle, entrees: restantes };
      }),
    [],
  );

  /**
   * Le nom commun, appliqué à chaque frappe.
   *
   * C'est le seul geste qui renumérote : il réécrit tous les noms, y compris
   * ceux qu'on aurait retouchés à la main. Rien ne se perd en silence — on voit
   * la liste changer sous le champ — et c'est aussi ce qui referme la série
   * après un retrait. Tout le reste laisse les noms tranquilles.
   */
  const appliquerNomCommun = useCallback(
    (nomCommun: string) =>
      setPreparation((actuelle) =>
        actuelle
          ? {
              ...actuelle,
              nomCommun,
              entrees: numeroter(actuelle.entrees, nomCommun),
            }
          : actuelle,
      ),
    [],
  );

  const changerDestination = useCallback(
    (folderId: string | null) =>
      setPreparation((actuelle) =>
        actuelle ? { ...actuelle, folderId } : actuelle,
      ),
    [],
  );

  const annulerPreparation = useCallback(() => setPreparation(null), []);

  const envoyer = useCallback(() => {
    const lot = preparation;
    if (!lot) return;

    setPreparation(null);

    const nouveaux: Envoi[] = [];

    for (const entree of lot.entrees) {
      if (entree.refus) continue;

      const cle = crypto.randomUUID();
      fichiersRef.current.set(cle, entree.fichier);

      // Un nom vidé retombe sur celui d'origine : mieux vaut un nom de
      // pellicule qu'un fichier appelé « .jpg ».
      const base = entree.base.trim() || couper(entree.fichier.name).base;

      nouveaux.push({
        cle,
        nom: `${base}${entree.extension}`,
        taille: entree.fichier.size,
        folderId: lot.folderId,
        etat: "attente",
        envoye: 0,
        vitesse: 0,
      });
    }

    if (nouveaux.length === 0) return;

    majFile((file) => [...file, ...nouveaux]);
    demarrerSuivants();
  }, [demarrerSuivants, majFile, preparation]);

  /**
   * Renommer depuis la file, même en plein envoi.
   *
   * Le nom ne voyage pas dans le chemin de l'objet : le renommer ne coûte
   * qu'une ligne modifiée, et n'interrompt rien. Tant que la ligne n'existe
   * pas, le nouveau nom attend simplement d'être inscrit.
   */
  const renommer = useCallback(
    (cle: string, nom: string) => {
      const propre = nom.trim();
      if (!propre) return;

      const envoi = fileRef.current.find((e) => e.cle === cle);
      if (!envoi || envoi.nom === propre) return;

      patcher(cle, { nom: propre });

      if (!envoi.fileId) return;

      void (async () => {
        const result = await renameFile(orgSlug, envoi.fileId!, propre);
        if (!result.ok) {
          patcher(cle, { nom: envoi.nom });
          toast.error(result.error);
        }
      })();
    },
    [orgSlug, patcher],
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
      value={{
        envois,
        preparation,
        preparer,
        renommerPreparation,
        retirerDePreparation,
        changerDestination,
        appliquerNomCommun,
        annulerPreparation,
        envoyer,
        renommer,
        annuler,
        reprendre,
        retirer,
        vider,
      }}
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
