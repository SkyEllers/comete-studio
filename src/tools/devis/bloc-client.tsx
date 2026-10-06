"use client";

import { Check, Download, FileSignature, Loader2, Mail, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { envoyerLeDevis, lireBlocDevis, renvoyerLeDevis, type BlocDevisDonnees, type EtatDevis } from "./actions";

/**
 * Le bloc « Le devis » de la fiche d'un rendez-vous (P16, Louis, 28/09/2026).
 *
 * Après le diagnostic, la closeuse (ou Peggy) choisit la durée et « en 1
 * fois » ou « en plusieurs fois », vérifie le mail de la cliente, et clique
 * « Envoyer le devis ». La cliente le reçoit, le signe en un clic ; un rappel
 * part chaque jour tant qu'elle n'a pas signé ; signé, la vente s'inscrit
 * seule dans Radar et le lien de paiement Stripe lui part.
 */

const euros = (cents: number) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(cents / 100).replace(/ | /g, " ")} €`;

const quand = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(new Date(iso));

const jourSeul = (jour: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${jour}T12:00:00Z`));

function Etat({ orgSlug, bookingId, devis, onRenvoye }: { orgSlug: string; bookingId: string; devis: EtatDevis; onRenvoye: () => void }) {
  const [enCours, demarrer] = useTransition();
  const libelle =
    devis.statut === "signe"
      ? devis.payeLe
        ? "Signé et payé"
        : "Signé, paiement en attente"
      : devis.statut === "expire"
        ? "Expiré sans signature"
        : devis.ouvertLe
          ? "Ouvert, pas encore signé"
          : "Envoyé, pas encore ouvert";

  return (
    <div className="border-line space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={devis.statut === "signe" ? "default" : "outline"}>{libelle}</Badge>
        <span className="text-muted-foreground">
          {euros(devis.totalCents)} · {devis.dureeMois} mois · {devis.paiement === "une_fois" ? "en 1 fois" : "en plusieurs fois"}
        </span>
      </div>
      <ul className="text-muted-foreground space-y-0.5 text-xs">
        <li>
          Envoyé le {quand(devis.envoyeLe)} à {devis.email}
          {devis.mailParti ? "" : " (le mail n'est pas parti)"}
        </li>
        {devis.ouvertLe ? <li>Ouvert le {quand(devis.ouvertLe)}</li> : null}
        {devis.statut === "envoye" ? (
          <li>
            {devis.relances > 0 ? `${devis.relances} rappel${devis.relances > 1 ? "s" : ""} envoyé${devis.relances > 1 ? "s" : ""}. ` : ""}
            Un rappel par jour jusqu&apos;au {jourSeul(devis.valideJusquAu)}.
          </li>
        ) : null}
        {devis.signeLe ? <li>Signé le {quand(devis.signeLe)} : la vente est dans Radar.</li> : null}
        {devis.paiementLienLe && !devis.payeLe ? <li>Page de paiement ouverte le {quand(devis.paiementLienLe)}</li> : null}
        {devis.payeLe ? <li>Paiement mis en place le {quand(devis.payeLe)}</li> : null}
      </ul>
      <div className="flex flex-wrap gap-2">
        {devis.statut === "signe" ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/app/${orgSlug}/devis/${devis.id}/pdf`} target="_blank" rel="noopener">
              <Download aria-hidden="true" />
              Le PDF signé
            </a>
          </Button>
        ) : null}
        {devis.statut === "envoye" && !devis.mailParti ? (
          <Button
            variant="outline"
            size="sm"
            disabled={enCours}
            onClick={() =>
              demarrer(async () => {
                const r = await renvoyerLeDevis(orgSlug, bookingId, devis.id);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("Le devis est reparti.");
                  onRenvoye();
                }
              })
            }
          >
            <RefreshCw aria-hidden="true" />
            Renvoyer le mail
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Formulaire({
  orgSlug,
  bookingId,
  donnees,
  onEnvoye,
  onAnnuler,
}: {
  orgSlug: string;
  bookingId: string;
  donnees: BlocDevisDonnees;
  onEnvoye: () => void;
  onAnnuler?: () => void;
}) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  // Le devis préparé avant l'appel (Louis, 06/10/2026) : ce qui a été rempli
  // se garde dans ce navigateur jusqu'à l'envoi, par rendez-vous.
  const brouillon = useMemo(() => lireBrouillon(bookingId), [bookingId]);
  const [duree, setDuree] = useState(brouillon?.duree ?? donnees.dureeParDefaut);
  const [paiement, setPaiement] = useState<"une_fois" | "plusieurs">(brouillon?.paiement ?? "plusieurs");
  const [prenom, setPrenom] = useState(brouillon?.prenom ?? donnees.preRempli.prenom);
  const [nom, setNom] = useState(brouillon?.nom ?? donnees.preRempli.nom);
  const [email, setEmail] = useState(brouillon?.email ?? donnees.preRempli.email);
  const [telephone, setTelephone] = useState(brouillon?.telephone ?? donnees.preRempli.telephone);

  useEffect(() => {
    ecrireBrouillon(bookingId, { duree, paiement, prenom, nom, email, telephone });
  }, [bookingId, duree, paiement, prenom, nom, email, telephone]);

  const t = donnees.tarifs;
  const total = t
    ? t.investigationCents + t.mensualiteCents * duree - (paiement === "une_fois" ? t.remiseUneFoisCents : 0)
    : 0;

  return (
    <form
      className="border-line space-y-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setErreur(null);
        demarrer(async () => {
          const r = await envoyerLeDevis(orgSlug, { bookingId, prenom, nom, email, telephone, dureeMois: duree, paiement });
          if (!r.ok) {
            setErreur(r.error);
            return;
          }
          effacerBrouillon(bookingId);
          if (r.data.mailParti) toast.success(`Devis envoyé à ${email}.`);
          else toast.warning("Le devis est prêt, mais le mail n'est pas parti : renvoie-le.");
          onEnvoye();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="mb-1 text-xs" htmlFor={`devis-duree-${bookingId}`}>
            Durée de l&apos;accompagnement
          </Label>
          <select
            id={`devis-duree-${bookingId}`}
            className="border-line bg-background h-9 w-full rounded-md border px-2 text-sm"
            value={duree}
            onChange={(e) => setDuree(Number(e.target.value))}
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} mois
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="mb-1 text-xs">Paiement</legend>
          <div className="flex gap-2">
            {(
              [
                ["plusieurs", "En plusieurs fois"],
                ["une_fois", "En 1 fois"],
              ] as const
            ).map(([valeur, texte]) => (
              <button
                key={valeur}
                type="button"
                onClick={() => setPaiement(valeur)}
                className={cn(
                  "border-line h-9 flex-1 rounded-md border px-2 text-sm",
                  paiement === valeur && "border-ember bg-ember/10",
                )}
                aria-pressed={paiement === valeur}
              >
                {texte}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {t ? (
        <p className="text-sm">
          <span className="font-medium">{euros(total)}</span>{" "}
          <span className="text-muted-foreground">
            {paiement === "une_fois"
              ? `en 1 fois (${euros(t.remiseUneFoisCents)} de moins)`
              : `: ${euros(t.investigationCents)}, puis ${duree} × ${euros(t.mensualiteCents)} par mois`}
          </span>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="mb-1 text-xs" htmlFor={`devis-prenom-${bookingId}`}>
            Prénom
          </Label>
          <Input id={`devis-prenom-${bookingId}`} value={prenom} onChange={(e) => setPrenom(e.target.value)} required />
        </div>
        <div>
          <Label className="mb-1 text-xs" htmlFor={`devis-nom-${bookingId}`}>
            Nom
          </Label>
          <Input id={`devis-nom-${bookingId}`} value={nom} onChange={(e) => setNom(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 text-xs" htmlFor={`devis-email-${bookingId}`}>
            Son mail (le devis part ici)
          </Label>
          <Input id={`devis-email-${bookingId}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label className="mb-1 text-xs" htmlFor={`devis-tel-${bookingId}`}>
            Téléphone
          </Label>
          <Input id={`devis-tel-${bookingId}`} value={telephone} onChange={(e) => setTelephone(e.target.value)} />
        </div>
      </div>

      {erreur ? <p className="text-destructive text-sm">{erreur}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={enCours}>
          {enCours ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
          Envoyer le devis
        </Button>
        {onAnnuler ? (
          <Button type="button" variant="ghost" size="sm" onClick={onAnnuler}>
            Annuler
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        Elle le reçoit par mail et le signe en un clic. Un rappel part chaque jour tant qu&apos;elle n&apos;a pas signé. Signé, la vente
        s&apos;inscrit seule et le lien de paiement lui part.
      </p>
    </form>
  );
}

export function BlocDevis({ orgSlug, bookingId }: { orgSlug: string; bookingId: string }) {
  const [donnees, setDonnees] = useState<BlocDevisDonnees | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const [version, setVersion] = useState(0);
  const charger = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let actif = true;
    lireBlocDevis(orgSlug, bookingId).then((r) => {
      if (!actif) return;
      if (r.ok) setDonnees(r.data);
      else setErreur(r.error);
    });
    return () => {
      actif = false;
    };
  }, [orgSlug, bookingId, version]);

  if (erreur) return null;
  if (!donnees) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        Le devis…
      </p>
    );
  }
  if (!donnees.disponible) return null;

  const apres = () => {
    setNouveau(false);
    charger();
  };

  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <FileSignature aria-hidden="true" className="size-3.5" />
        Le devis
      </h3>
      {donnees.devis && !nouveau ? (
        <>
          <Etat orgSlug={orgSlug} bookingId={bookingId} devis={donnees.devis} onRenvoye={charger} />
          {donnees.devis.statut !== "signe" ? (
            <Button variant="ghost" size="sm" onClick={() => setNouveau(true)}>
              <Mail aria-hidden="true" />
              {donnees.devis.statut === "expire" ? "Envoyer un nouveau devis" : "Corriger et renvoyer"}
            </Button>
          ) : (
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <Check aria-hidden="true" className="size-3" /> Rien à faire : tout suit seul.
            </p>
          )}
        </>
      ) : (
        <Formulaire
          orgSlug={orgSlug}
          bookingId={bookingId}
          donnees={donnees}
          onEnvoye={apres}
          onAnnuler={donnees.devis ? () => setNouveau(false) : undefined}
        />
      )}
    </section>
  );
}

// --------------------------------------------------- Le brouillon du devis

type Brouillon = {
  duree: number;
  paiement: "une_fois" | "plusieurs";
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
};

const cleBrouillon = (bookingId: string) => `devis-brouillon:${bookingId}`;

/** Le brouillon gardé dans ce navigateur, ou null (rien, illisible, ou stockage bloqué). */
function lireBrouillon(bookingId: string): Brouillon | null {
  if (typeof window === "undefined") return null;
  try {
    const b = JSON.parse(window.localStorage.getItem(cleBrouillon(bookingId)) ?? "null") as Brouillon | null;
    return b && typeof b.duree === "number" && (b.paiement === "une_fois" || b.paiement === "plusieurs") ? b : null;
  } catch {
    return null;
  }
}

function ecrireBrouillon(bookingId: string, b: Brouillon) {
  try {
    window.localStorage.setItem(cleBrouillon(bookingId), JSON.stringify(b));
  } catch {
    // Stockage bloqué (navigation privée) : le formulaire marche, sans mémoire.
  }
}

function effacerBrouillon(bookingId: string) {
  try {
    window.localStorage.removeItem(cleBrouillon(bookingId));
  } catch {
    // Rien à faire.
  }
}
