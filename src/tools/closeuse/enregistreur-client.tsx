"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDepotDiagnostic } from "@/tools/resultats/enregistrement-client";

import { chrono, navigateurCompatible, nomFichierAppel } from "./enregistreur";

/**
 * « Enregistrer l'appel » (Louis, 09/10/2026 : le dictaphone de Rachel s'est
 * arrêté à 21 minutes ; « le plus simple possible »). Le navigateur enregistre
 * le son de l'onglet de la visio (la cliente) et le micro (la closeuse),
 * mélangés en un seul fichier audio. À l'arrêt, il se dépose tout seul sur le
 * rendez-vous : transcription puis analyse, comme un fichier déposé à la main.
 *
 * Chaque morceau (toutes les 10 secondes) est aussi gardé dans le navigateur :
 * si l'onglet se ferme ou si l'envoi échoue, l'enregistrement se renvoie au
 * retour sur l'espace. Fin du partage côté Chrome (« Arrêter le partage », ou
 * la visio fermée) : l'enregistrement s'arrête et part.
 */

const BASE = "comete-enregistreur";
const MAGASIN = "morceaux";

type Morceau = { bookingId: string; rang: number; blob: Blob };

function ouvrirBase(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => {
      const magasin = r.result.createObjectStore(MAGASIN, { keyPath: ["bookingId", "rang"] });
      magasin.createIndex("bookingId", "bookingId");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

async function garderMorceau(m: Morceau): Promise<void> {
  try {
    const db = await ouvrirBase();
    await new Promise<void>((ok, ko) => {
      const t = db.transaction(MAGASIN, "readwrite");
      t.objectStore(MAGASIN).put(m);
      t.oncomplete = () => ok();
      t.onerror = () => ko(t.error);
    });
    db.close();
  } catch {
    // Pas de copie de secours possible (navigation privée) : l'enregistrement continue.
  }
}

async function lireMorceaux(bookingId: string): Promise<Blob[]> {
  try {
    const db = await ouvrirBase();
    const morceaux = await new Promise<Morceau[]>((ok, ko) => {
      const r = db.transaction(MAGASIN).objectStore(MAGASIN).index("bookingId").getAll(bookingId);
      r.onsuccess = () => ok(r.result as Morceau[]);
      r.onerror = () => ko(r.error);
    });
    db.close();
    return morceaux.sort((a, b) => a.rang - b.rang).map((m) => m.blob);
  } catch {
    return [];
  }
}

async function effacerMorceaux(bookingId: string): Promise<void> {
  try {
    const db = await ouvrirBase();
    await new Promise<void>((ok, ko) => {
      const t = db.transaction(MAGASIN, "readwrite");
      const index = t.objectStore(MAGASIN).index("bookingId");
      const r = index.openKeyCursor(IDBKeyRange.only(bookingId));
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return;
        t.objectStore(MAGASIN).delete(c.primaryKey);
        c.continue();
      };
      t.oncomplete = () => ok();
      t.onerror = () => ko(t.error);
    });
    db.close();
  } catch {
    // Rien à effacer.
  }
}

type Etat = "repos" | "consignes" | "demarrage" | "enregistrement";

const rien = () => () => {};

export function EnregistreurAppel({
  orgSlug,
  organizationId,
  bookingId,
  prenom,
  debut,
}: {
  orgSlug: string;
  organizationId: string;
  bookingId: string;
  prenom: string;
  debut: string;
}) {
  const [etat, setEtat] = useState<Etat>("repos");
  const [secondes, setSecondes] = useState(0);
  const [enAttente, setEnAttente] = useState(false);
  const flux = useRef<MediaStream[]>([]);
  const contexte = useRef<AudioContext | null>(null);
  const enregistreur = useRef<MediaRecorder | null>(null);
  const morceaux = useRef<Blob[]>([]);
  const rang = useRef(0);
  const depart = useRef(0);

  const { envoi, envoyer } = useDepotDiagnostic({
    orgSlug,
    organizationId,
    bookingId,
    onReussi: () => {
      void effacerMorceaux(bookingId);
      setEnAttente(false);
    },
  });

  // Chrome ou Edge sur ordinateur ; côté serveur, on suppose que oui.
  const compatible = useSyncExternalStore(
    rien,
    () => navigateurCompatible(navigator.userAgent) && Boolean(navigator.mediaDevices?.getDisplayMedia),
    () => true,
  );

  // Un enregistrement resté en attente (onglet fermé, envoi raté).
  useEffect(() => {
    let actif = true;
    void lireMorceaux(bookingId).then((m) => {
      if (actif) setEnAttente(m.length > 0);
    });
    return () => {
      actif = false;
    };
  }, [bookingId]);

  useEffect(() => {
    if (etat !== "enregistrement") return;
    const t = setInterval(() => setSecondes((Date.now() - depart.current) / 1000), 1000);
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", retenir);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", retenir);
    };
  }, [etat]);

  const toutCouper = useCallback(() => {
    flux.current.forEach((f) => f.getTracks().forEach((t) => t.stop()));
    flux.current = [];
    void contexte.current?.close();
    contexte.current = null;
  }, []);

  const envoyerMorceaux = useCallback(
    (blobs: Blob[]) => {
      if (!blobs.length) {
        toast.error("L'enregistrement est vide : rien n'a été capté.");
        setEtat("repos");
        return;
      }
      const fichier = new File(blobs, nomFichierAppel(prenom, debut), { type: "audio/webm" });
      setEtat("repos");
      envoyer(fichier);
    },
    [debut, envoyer, prenom],
  );

  const arreter = useCallback(() => {
    const r = enregistreur.current;
    if (!r || r.state === "inactive") return;
    r.onstop = () => {
      toutCouper();
      enregistreur.current = null;
      envoyerMorceaux(morceaux.current);
    };
    r.stop();
  }, [envoyerMorceaux, toutCouper]);

  const commencer = async () => {
    setEtat("demarrage");
    try {
      const ecran = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        // Chrome : proposer d'abord les onglets, et pas celui-ci.
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
      } as DisplayMediaStreamOptions);
      flux.current.push(ecran);
      if (!ecran.getAudioTracks().length) {
        toutCouper();
        setEtat("consignes");
        toast.error("Le son de l'onglet n'est pas partagé : recommence et coche « Partager aussi l'audio de l'onglet ».");
        return;
      }
      const micro = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      flux.current.push(micro);

      const ctx = new AudioContext();
      contexte.current = ctx;
      const sortie = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream(ecran.getAudioTracks())).connect(sortie);
      ctx.createMediaStreamSource(micro).connect(sortie);

      await effacerMorceaux(bookingId);
      morceaux.current = [];
      rang.current = 0;
      const r = new MediaRecorder(sortie.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 64_000 });
      r.ondataavailable = (e) => {
        if (!e.data.size) return;
        morceaux.current.push(e.data);
        void garderMorceau({ bookingId, rang: rang.current++, blob: e.data });
      };
      enregistreur.current = r;
      // La visio fermée ou « Arrêter le partage » dans Chrome : on arrête et on envoie.
      ecran.getTracks().forEach((t) => t.addEventListener("ended", () => arreter()));
      r.start(10_000);
      depart.current = Date.now();
      setSecondes(0);
      setEtat("enregistrement");
    } catch {
      toutCouper();
      setEtat("consignes");
      toast.error("L'enregistrement n'a pas démarré. Autorise le partage de l'onglet et le micro, puis recommence.");
    }
  };

  const renvoyer = async () => {
    const blobs = await lireMorceaux(bookingId);
    envoyerMorceaux(blobs);
  };

  if (!compatible) {
    return (
      <p className="text-muted-foreground max-w-56 text-xs">
        Pour enregistrer l&apos;appel ici, ouvre ton espace dans Chrome, sur ordinateur.
      </p>
    );
  }

  if (envoi.etat !== "repos") {
    const pourcent = envoi.etat === "envoi" && envoi.total ? Math.round((envoi.envoye / envoi.total) * 100) : null;
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        {pourcent !== null ? `Envoi de l'enregistrement… ${pourcent} %` : "Rangement sur le rendez-vous…"}
      </span>
    );
  }

  return (
    <>
      {enAttente && etat === "repos" ? (
        <Button size="sm" variant="outline" onClick={() => void renvoyer()}>
          <Mic aria-hidden="true" />
          Envoyer l&apos;enregistrement en attente
        </Button>
      ) : null}
      {etat === "repos" || etat === "consignes" || etat === "demarrage" ? (
        <Button size="sm" onClick={() => setEtat("consignes")} disabled={etat === "demarrage"}>
          <Mic aria-hidden="true" />
          Enregistrer l&apos;appel
        </Button>
      ) : null}

      {etat === "enregistrement" ? (
        <div className="bg-background border-destructive fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border-2 px-4 py-2 shadow-lg">
          <span aria-hidden="true" className="bg-destructive size-2.5 animate-pulse rounded-full" />
          <span className="text-sm font-medium tabular-nums">
            Enregistrement · {prenom} · {chrono(secondes)}
          </span>
          <Button size="sm" variant="destructive" onClick={arreter}>
            <Square aria-hidden="true" />
            Arrêter
          </Button>
        </div>
      ) : null}

      <Dialog open={etat === "consignes" || etat === "demarrage"} onOpenChange={(o) => (o ? null : setEtat("repos"))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enregistrer l&apos;appel avec {prenom}</DialogTitle>
            <DialogDescription>Ouvre d&apos;abord ta visio dans un autre onglet de Chrome.</DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Clique sur « Commencer ».</li>
            <li>Dans la fenêtre de Chrome, choisis l&apos;onglet de ta visio.</li>
            <li>
              Coche <strong>« Partager aussi l&apos;audio de l&apos;onglet »</strong>, puis clique sur « Partager ».
            </li>
          </ol>
          <p className="text-muted-foreground text-xs">
            C&apos;est tout : retourne sur ta visio. À la fin, clique sur « Arrêter » (en bas de cette page) ou sur
            « Arrêter le partage » dans Chrome. L&apos;enregistrement se dépose tout seul sur le rendez-vous.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEtat("repos")} disabled={etat === "demarrage"}>
              Annuler
            </Button>
            <Button onClick={() => void commencer()} disabled={etat === "demarrage"}>
              {etat === "demarrage" ? "Choisis l'onglet…" : "Commencer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
