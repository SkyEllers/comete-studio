"use client";

import { Check, Copy, Download, FileVideo, Loader2, RefreshCw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import * as tus from "tus-js-client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { deposerEnregistrement, relancerTranscription } from "./enregistrement-actions";
import {
  CHAMPS_RESUME,
  horodatage,
  nomVoix,
  poids,
  texteACopier,
  typeDuFichier,
  type Enregistrement,
  type ResumeDiagnostic,
} from "./enregistrement-format";

/**
 * L'enregistrement du diagnostic sur la fiche d'un rendez-vous (0049).
 *
 * La vidéo part du navigateur droit vers le Storage, en TUS, comme dans
 * Capsule : elle pèse des centaines de Mo, elle ne doit ni traverser Vercel ni
 * repartir de zéro à la moindre coupure. Une fois arrivée, une action la range
 * sur la fiche et lance la transcription.
 */

const BUCKET = "diagnostics";
const MORCEAU = 6 * 1024 * 1024; // imposé par Supabase
const TAILLE_MAX = 5 * 1024 * 1024 * 1024;

type EtatEnvoi = { etat: "repos" } | { etat: "envoi"; envoye: number; total: number } | { etat: "rangement" };

/** Envoyer un fichier sur la fiche d'un rendez-vous. */
export function useDepotDiagnostic({
  orgSlug,
  organizationId,
  bookingId,
  onEnvoi,
}: {
  orgSlug: string;
  organizationId: string;
  bookingId: string;
  /** Prévient le parent qu'un envoi tourne (pour ne pas fermer la fenêtre). */
  onEnvoi?: (enCours: boolean) => void;
}) {
  const router = useRouter();
  const [envoi, setEnvoi] = useState<EtatEnvoi>({ etat: "repos" });
  const upload = useRef<tus.Upload | null>(null);
  const enCours = envoi.etat !== "repos";

  useEffect(() => {
    onEnvoi?.(enCours);
    if (!enCours) return;
    // Quitter la page couperait l'envoi : le navigateur le demande avant.
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", retenir);
    return () => window.removeEventListener("beforeunload", retenir);
  }, [enCours, onEnvoi]);

  useEffect(() => () => void upload.current?.abort(), []);

  const envoyer = (fichier: File) => {
    const type = typeDuFichier(fichier.name, fichier.type);
    if (!type) {
      toast.error("Ce fichier n'est pas une vidéo ni un son. Dépose le .mp4 de l'enregistrement.");
      return;
    }
    if (fichier.size > TAILLE_MAX) {
      toast.error("Ce fichier dépasse 5 Go.");
      return;
    }
    const ext = (fichier.name.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
    const chemin = `${organizationId}/${bookingId}/${crypto.randomUUID()}.${ext}`;
    const supabase = createClient();

    setEnvoi({ etat: "envoi", envoye: 0, total: fichier.size });

    const u = new tus.Upload(fichier, {
      endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      headers: { "x-upsert": "false" },
      // Le jeton est relu avant chaque morceau : un gros envoi dure plus qu'une session.
      onBeforeRequest: async (requete) => {
        const { data } = await supabase.auth.getSession();
        const frais = data.session?.access_token;
        if (frais) requete.setHeader("authorization", `Bearer ${frais}`);
      },
      chunkSize: MORCEAU,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: BUCKET, objectName: chemin, contentType: type, cacheControl: "3600" },
      onProgress: (envoye, total) => setEnvoi({ etat: "envoi", envoye, total }),
      onError: () => {
        upload.current = null;
        setEnvoi({ etat: "repos" });
        toast.error("L'envoi s'est arrêté. Vérifie ta connexion et redépose le fichier.");
      },
      onSuccess: () => {
        upload.current = null;
        setEnvoi({ etat: "rangement" });
        void (async () => {
          const r = await deposerEnregistrement(orgSlug, {
            bookingId,
            chemin,
            nom: fichier.name,
            taille: fichier.size,
          });
          setEnvoi({ etat: "repos" });
          if (!r.ok) {
            // Le fichier est arrivé mais n'est pas rangé : on ne le laisse pas traîner.
            await supabase.storage.from(BUCKET).remove([chemin]);
            toast.error(r.error);
            return;
          }
          toast.success(
            r.data.transcription === "echec"
              ? "Vidéo déposée. La transcription n'est pas partie : relance-la depuis la fiche."
              : "Vidéo déposée. La transcription arrive dans quelques minutes.",
          );
          router.refresh();
        })();
      },
    });
    upload.current = u;
    u.start();
  };

  const arreter = () => {
    void upload.current?.abort(true);
    upload.current = null;
    setEnvoi({ etat: "repos" });
  };

  return { envoi, enCours, envoyer, arreter };
}

/** La zone où l'on dépose le fichier, avec sa progression. */
export function ZoneDepot({
  depot,
  libelle = "Déposer l'enregistrement",
  variante = "grande",
}: {
  depot: ReturnType<typeof useDepotDiagnostic>;
  libelle?: string;
  variante?: "grande" | "bouton";
}) {
  const champ = useRef<HTMLInputElement>(null);
  const [survol, setSurvol] = useState(false);
  const { envoi } = depot;

  const choisir = (liste: FileList | null) => {
    const fichier = liste?.[0];
    if (fichier) depot.envoyer(fichier);
    if (champ.current) champ.current.value = "";
  };

  const input = (
    <input
      ref={champ}
      type="file"
      accept="video/*,audio/*,.mp4,.m4a,.mov"
      className="sr-only"
      onChange={(e) => choisir(e.target.files)}
    />
  );

  if (envoi.etat === "envoi") {
    const pct = envoi.total ? Math.floor((envoi.envoye / envoi.total) * 100) : 0;
    return (
      <div className="border-line space-y-2 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>Envoi de la vidéo… {pct} %</span>
          <button className="text-muted-foreground text-xs underline-offset-4 hover:underline" onClick={depot.arreter}>
            Arrêter
          </button>
        </div>
        <div className="bg-muted h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="bg-ember h-full transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-muted-foreground text-xs">
          {poids(envoi.envoye)} sur {poids(envoi.total)}. Garde cette page ouverte jusqu&apos;à la fin.
        </p>
      </div>
    );
  }

  if (envoi.etat === "rangement") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Vidéo reçue, on la range sur la fiche…
      </p>
    );
  }

  if (variante === "bouton") {
    return (
      <>
        {input}
        <Button variant="outline" size="sm" onClick={() => champ.current?.click()}>
          <Upload aria-hidden="true" />
          {libelle}
        </Button>
      </>
    );
  }

  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center text-sm transition-colors",
        survol ? "border-ember bg-ember/5" : "border-line hover:bg-muted",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setSurvol(true);
      }}
      onDragLeave={() => setSurvol(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSurvol(false);
        choisir(e.dataTransfer.files);
      }}
    >
      {input}
      <Upload aria-hidden="true" className="text-muted-foreground size-5" />
      <span className="font-medium">{libelle}</span>
      <span className="text-muted-foreground text-xs">Le fichier .mp4 de Zoom ou de Meet, glissé ici ou choisi.</span>
    </label>
  );
}

/**
 * Tant qu'une transcription tourne sur l'écran, on relit la page toutes les
 * 20 secondes : le serveur va la chercher à chaque lecture.
 */
export function useSuiviTranscriptions(enCours: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!enCours) return;
    const t = window.setInterval(() => router.refresh(), 20_000);
    return () => window.clearInterval(t);
  }, [enCours, router]);
}

/** La vidéo, sa transcription, ou le résumé écrit à sa place. */
export function BlocEnregistrement({
  orgSlug,
  organizationId,
  bookingId,
  enregistrement,
  titreCopie,
  peutDeposer = true,
  onEnvoi,
}: {
  orgSlug: string;
  organizationId: string;
  bookingId: string;
  enregistrement: Enregistrement | undefined;
  /** La première ligne du texte copié (« Diagnostic de Sylvie, 3 octobre »). */
  titreCopie?: string;
  peutDeposer?: boolean;
  onEnvoi?: (enCours: boolean) => void;
}) {
  const depot = useDepotDiagnostic({ orgSlug, organizationId, bookingId, onEnvoi });
  useSuiviTranscriptions(enregistrement?.transcriptionEtat === "en_cours");

  if (!enregistrement) {
    return peutDeposer ? (
      <ZoneDepot depot={depot} />
    ) : (
      <p className="text-muted-foreground text-sm">Pas d&apos;enregistrement déposé.</p>
    );
  }

  if (enregistrement.sansEnregistrement) {
    return (
      <div className="space-y-3">
        <ResumeLu resume={enregistrement.resume} auteur={enregistrement.deposePar} />
        {peutDeposer ? <ZoneDepot depot={depot} libelle="Finalement, déposer la vidéo" variante="bouton" /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {enregistrement.lien ? (
        <video controls preload="metadata" className="bg-encre aspect-video w-full rounded-md" src={enregistrement.lien}>
          <track kind="captions" />
        </video>
      ) : (
        <p className="text-muted-foreground text-sm">La vidéo ne se charge pas : recharge la page.</p>
      )}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1">
          <FileVideo aria-hidden="true" className="size-3.5" />
          {enregistrement.nomFichier ?? "Enregistrement"}
          {enregistrement.taille ? ` · ${poids(enregistrement.taille)}` : ""}
        </span>
        {enregistrement.lien ? (
          <a href={enregistrement.lien} className="text-ember inline-flex items-center gap-1 underline-offset-4 hover:underline">
            <Download aria-hidden="true" className="size-3.5" />
            Télécharger
          </a>
        ) : null}
        {peutDeposer ? <ZoneDepot depot={depot} libelle="Remplacer" variante="bouton" /> : null}
      </div>
      <Transcription
        orgSlug={orgSlug}
        bookingId={bookingId}
        enregistrement={enregistrement}
        titreCopie={titreCopie}
      />
    </div>
  );
}

function Transcription({
  orgSlug,
  bookingId,
  enregistrement,
  titreCopie,
}: {
  orgSlug: string;
  bookingId: string;
  enregistrement: Enregistrement;
  titreCopie?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [copie, setCopie] = useState(false);
  const [enCours, startTransition] = useTransition();
  const router = useRouter();
  const { transcriptionEtat: etat, transcription } = enregistrement;

  if (etat === "en_cours" || etat === "aucune") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Transcription en cours. Elle arrive ici toute seule, en quelques minutes.
      </p>
    );
  }

  if (etat === "echec") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-destructive">La transcription n&apos;a pas marché.</span>
        <Button
          variant="outline"
          size="sm"
          disabled={enCours}
          onClick={() =>
            startTransition(async () => {
              const r = await relancerTranscription(orgSlug, { bookingId });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Transcription relancée.");
              router.refresh();
            })
          }
        >
          <RefreshCw aria-hidden="true" />
          Relancer
        </Button>
      </div>
    );
  }

  const repliques = transcription ?? [];
  if (repliques.length === 0) {
    return <p className="text-muted-foreground text-sm">La transcription est vide : on n&apos;entend personne dans ce fichier.</p>;
  }

  const texte = texteACopier(repliques, titreCopie);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
          {ouvert ? "Masquer la transcription" : "Lire la transcription"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(texte);
              setCopie(true);
              toast.success("Transcription copiée.");
              window.setTimeout(() => setCopie(false), 2000);
            } catch {
              toast.error("La copie n'a pas marché : ouvre la transcription et sélectionne le texte.");
            }
          }}
        >
          {copie ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          Copier le texte
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([texte], { type: "text/plain;charset=utf-8" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = `${(titreCopie ?? "transcription").replace(/[\\/:*?"<>|]/g, "-")}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download aria-hidden="true" />
          .txt
        </Button>
      </div>
      {ouvert ? (
        <div className="border-line max-h-96 space-y-3 overflow-y-auto rounded-md border p-3 text-sm">
          {repliques.map((r, i) => (
            <p key={i}>
              <span className="text-muted-foreground font-mono text-xs">
                {nomVoix(r.qui)} · {horodatage(r.debut)}
              </span>
              <br />
              {r.texte}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResumeLu({ resume, auteur }: { resume: ResumeDiagnostic | null; auteur: string | null }) {
  return (
    <div className="border-warning/50 space-y-2.5 rounded-md border p-3 text-sm">
      <p className="text-muted-foreground text-xs">
        Pas d&apos;enregistrement pour ce diagnostic. Résumé écrit{auteur ? ` par ${auteur}` : ""} :
      </p>
      <dl className="space-y-2">
        {CHAMPS_RESUME.map((c) => (
          <div key={c.cle}>
            <dt className="text-muted-foreground text-xs">{c.libelle}</dt>
            <dd className="whitespace-pre-line">{resume?.[c.cle] || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Les quatre champs du résumé écrit quand il n'y a pas d'enregistrement. */
export function FormulaireResume({
  valeur,
  onChange,
}: {
  valeur: ResumeDiagnostic;
  onChange: (v: ResumeDiagnostic) => void;
}) {
  return (
    <div className="space-y-3">
      {CHAMPS_RESUME.map((c) => (
        <div key={c.cle} className="space-y-1">
          <Label htmlFor={`resume-${c.cle}`}>{c.libelle}</Label>
          <textarea
            id={`resume-${c.cle}`}
            rows={2}
            maxLength={2000}
            value={valeur[c.cle]}
            placeholder={c.aide}
            onChange={(e) => onChange({ ...valeur, [c.cle]: e.target.value })}
            className="border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3"
          />
        </div>
      ))}
    </div>
  );
}

export const RESUME_VIDE: ResumeDiagnostic = { probleme: "", objectif: "", freins: "", propose: "" };

export const resumeRempli = (r: ResumeDiagnostic) =>
  CHAMPS_RESUME.every((c) => r[c.cle].trim().length > 0);
