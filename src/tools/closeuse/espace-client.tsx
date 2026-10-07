"use client";

import { fr } from "date-fns/locale";
import {
  CalendarCheck2,
  Check,
  FileVideo,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileText,
  PenLine,
  Phone,
  ShoppingBag,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  annulerAbsence,
  noterAbsente,
  noterNonVente,
  noterRecontactee,
  noterVente,
} from "@/app/app/[orgSlug]/closeuse/actions";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { libelleSuivi } from "@/tools/agent/suivi";
import {
  BlocEnregistrement,
  FormulaireResume,
  RESUME_VIDE,
  resumeRempli,
} from "@/tools/resultats/enregistrement-client";
import { noterSansEnregistrement } from "@/tools/resultats/enregistrement-actions";
import type { Enregistrement, ResumeDiagnostic } from "@/tools/resultats/enregistrement-format";
import { bilanPossible, heure, jour, montant } from "@/tools/resultats/format";
import { OngletAnalyses } from "@/tools/analyse/onglet-client";
import type { VueCloseuse } from "@/tools/analyse/queries";
import { BlocDevis } from "@/tools/devis/bloc-client";
import { BlocMesFactures } from "./factures-client";
import { BlocParcours } from "@/tools/fiche/parcours-client";
import { demanderR2 } from "@/tools/r2/actions";
import {
  CHAMPS_FICHE,
  FREINS,
  PRETE,
  libelleResultat,
  manqueR2,
  type CleFiche,
  type CleFrein,
  type ClePrete,
} from "@/tools/r2/regles";
import { libelleMois, moisPrecedent, moisSuivant } from "@/tools/resultats/mois";
import { LIBELLES_MOTIF, MOTIFS, type Motif, type Raison } from "@/tools/resultats/non-vente";
import { Tuile } from "@/tools/resultats/tuiles";

import { echeancier, plusMois, releveDuMois, type Paiement } from "./commission";
import type { EspaceCloseuse, RdvCloseuse } from "./queries";

/**
 * L'espace de la closeuse. Tout ce qu'elle voit vient de ses seuls
 * rendez-vous ; les chiffres du mois se recalculent ici, sans aller-retour,
 * quand elle change de mois.
 */

type Onglet = "rdv" | "ventes" | "commission" | "analyses" | "regles";

const ONGLETS: { id: Onglet; label: string }[] = [
  { id: "rdv", label: "Mes rendez-vous" },
  { id: "ventes", label: "Mes ventes" },
  { id: "commission", label: "Ma commission" },
  { id: "analyses", label: "Mes analyses" },
  { id: "regles", label: "Comment ça marche" },
];

const court = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const dateCourte = (jourIso: string) => court.format(new Date(`${jourIso}T00:00:00Z`));
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pourcent = (t: number) => `${String(t).replace(".", ",")} %`;

const longue = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dateLongue = (jourIso: string) => longue.format(new Date(`${jourIso}T00:00:00Z`));

/** « AAAA-MM-JJ » d'une date du calendrier, lue à l'heure locale de qui clique. */
function jourDuCalendrier(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Le moment de la rappeler est-il arrivé ? Le jour exact quand elle l'a noté
 * (0038), sinon le mois, comme dans le Radar du client.
 */
function rappelArrive(raison: Raison, aujourdhui: string, moisDuJour: string) {
  if (raison.recontacterLe) return raison.recontacterLe <= aujourdhui;
  return raison.recontacter !== null && raison.recontacter <= moisDuJour;
}

function quandRappeler(raison: Raison) {
  if (raison.recontacterLe) return `le ${dateLongue(raison.recontacterLe)}`;
  return raison.recontacter ? `en ${libelleMois(raison.recontacter)}` : "";
}

function aNoter(r: RdvCloseuse, maintenant: number) {
  return (
    r.statut === "honore" && !r.vente && !r.declinee && !r.raison && !r.r2 && bilanPossible(r.debut, maintenant)
  );
}

function telephone(r: RdvCloseuse): string | null {
  const ligne = r.reponses?.find((x) => /t[ée]l[ée]phone/i.test(x.q));
  return ligne?.r ?? null;
}

export function EspaceCloseuseClient({
  orgSlug,
  organizationId,
  espace,
  moisDuJour,
  aujourdhui,
  vueDeLouis,
  voisines = null,
  analyses = null,
}: {
  orgSlug: string;
  organizationId: string;
  espace: EspaceCloseuse;
  moisDuJour: string;
  aujourdhui: string;
  vueDeLouis: boolean;
  /** Pour Louis seulement : la closeuse d'avant et d'après chez ce client (Louis, 07/10/2026). */
  voisines?: { precedente: string; suivante: string; rang: number; total: number } | null;
  /** L'analyse de ses appels (0056) ; null chez un client sans analyse : pas d'onglet. */
  analyses?: { vue: VueCloseuse; titulaire: string } | null;
}) {
  const [onglet, setOnglet] = useState<Onglet>("rdv");
  const [mois, setMois] = useState(moisDuJour);
  const [aNoterRdv, setANoterRdv] = useState<RdvCloseuse | null>(null);
  const [devisRdv, setDevisRdv] = useState<RdvCloseuse | null>(null);
  const [facture, setFacture] = useState(false);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [maintenant] = useState(() => Date.now());

  const prenom = espace.nom.split(" ")[0] || "";
  const m7 = mois.slice(0, 7);

  const duMois = espace.rdvs.filter((r) => r.debut.slice(0, 7) === m7);
  const tenus = duMois.filter((r) => r.statut === "honore");
  const ventesDuMois = espace.rdvs.filter((r) => r.vente && r.vente.date.slice(0, 7) === m7);
  const releve = useMemo(() => releveDuMois(espace.commission, m7), [espace.commission, m7]);
  const encaisse = releve.paiements
    .filter((p) => p.etat !== "impaye")
    .reduce((s, p) => s + p.montantCents, 0);
  const taux = tenus.length ? Math.round((ventesDuMois.length / tenus.length) * 100) : null;
  const sansVideo = tenus.filter((r) => espace.enregistrements[r.id]?.sansEnregistrement).length;

  return (
    <>
      <PageHeader
        title={prenom ? `Bonjour ${prenom}` : "Ton espace"}
        aCoteDuTitre={
          vueDeLouis && voisines ? (
            <span className="flex items-center gap-1">
              <Button asChild variant="ghost" size="icon-sm">
                <Link href={`/app/${orgSlug}/closeuse?c=${voisines.precedente}`} aria-label="Closeuse précédente">
                  <ChevronLeft aria-hidden="true" />
                </Link>
              </Button>
              <span className="text-muted-foreground text-xs tabular-nums">
                {voisines.rang} / {voisines.total}
              </span>
              <Button asChild variant="ghost" size="icon-sm">
                <Link href={`/app/${orgSlug}/closeuse?c=${voisines.suivante}`} aria-label="Closeuse suivante">
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
            </span>
          ) : null
        }
        description="Tes rendez-vous, ce que tu as vendu, et ce que tu factures à la fin du mois."
        action={
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}/agenda`}>Mon agenda</Link>
          </Button>
        }
      />

      {vueDeLouis ? (
        <p className="border-line text-muted-foreground mb-6 rounded-md border border-dashed px-3 py-2 text-xs">
          Tu regardes l&apos;espace de {espace.nom || "la closeuse"} tel qu&apos;elle le voit.{" "}
          <Link href="/admin/closeuse" className="underline underline-offset-2">
            Toutes les closeuses
          </Link>
        </p>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Mois précédent" onClick={() => setMois(moisPrecedent(mois))}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium">{majuscule(libelleMois(mois))}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Mois suivant" onClick={() => setMois(moisSuivant(mois))}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tuile
          icon={CalendarCheck2}
          label="Rendez-vous tenus"
          valeur={String(tenus.length)}
          comparaison={`sur ${duMois.length} réservés dans le mois`}
        />
        <Tuile
          icon={ShoppingBag}
          label="Ventes"
          valeur={String(ventesDuMois.length)}
          comparaison={taux === null ? null : `${taux} % des rendez-vous tenus`}
        />
        <Tuile icon={Coins} label="Encaissé sur tes ventes" valeur={montant(encaisse)} comparaison="hors TVA" />
        <Tuile
          icon={FileText}
          label="Ta commission du mois"
          valeur={montant(releve.totalCents)}
          comparaison={
            releve.aVenirCents > 0
              ? `dont ${montant(releve.aVenirCents)} sur des paiements encore à venir`
              : "à facturer à la fin du mois"
          }
        />
      </div>

      {sansVideo > 0 ? (
        <p className="text-muted-foreground -mt-5 mb-8 text-xs">
          {sansVideo === 1
            ? "1 diagnostic sans enregistrement ce mois-ci."
            : `${sansVideo} diagnostics sans enregistrement ce mois-ci.`}
        </p>
      ) : null}

      <div role="tablist" className="border-line mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b">
        {ONGLETS.filter((o) => o.id !== "analyses" || analyses).map((o) => (
          <button
            key={o.id}
            role="tab"
            aria-selected={onglet === o.id}
            onClick={() => setOnglet(o.id)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
              onglet === o.id
                ? "border-ember text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {onglet === "rdv" ? (
        <OngletRdv
          orgSlug={orgSlug}
          rdvs={espace.rdvs}
          enregistrements={espace.enregistrements}
          maintenant={maintenant}
          moisDuJour={moisDuJour}
          aujourdhui={aujourdhui}
          onNoter={setANoterRdv}
          onDevis={setDevisRdv}
        />
      ) : null}
      {onglet === "ventes" ? <OngletVentes espace={espace} m7={m7} mois={mois} aujourdhui={aujourdhui} /> : null}
      {onglet === "commission" ? (
        <div className="space-y-6">
          {/* Les factures se font seules (autofacturation, P16) : le bloc ne
              s'affiche que pour la closeuse elle-même. */}
          <BlocMesFactures orgSlug={orgSlug} />
          <OngletCommission releve={releve} mois={mois} moisDuJour={moisDuJour} onFacture={() => setFacture(true)} />
        </div>
      ) : null}
      {onglet === "analyses" && analyses ? (
        <OngletAnalyses vue={analyses.vue} titulaire={analyses.titulaire} prenom={prenom} />
      ) : null}
      {onglet === "regles" ? <OngletRegles espace={espace} /> : null}

      <Dialog
        open={aNoterRdv !== null}
        onOpenChange={(o) => {
          if (o) return;
          // Fermer couperait l'envoi de la vidéo.
          if (envoiEnCours) {
            toast.error("Attends la fin de l'envoi de la vidéo, ou arrête-le.");
            return;
          }
          setANoterRdv(null);
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          {aNoterRdv ? (
            <FormResultat
              key={aNoterRdv.id}
              orgSlug={orgSlug}
              organizationId={organizationId}
              rdv={aNoterRdv}
              enregistrement={espace.enregistrements[aNoterRdv.id]}
              aujourdhui={aujourdhui}
              onEnvoi={setEnvoiEnCours}
              onFini={() => setANoterRdv(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={devisRdv !== null} onOpenChange={(o) => (o ? null : setDevisRdv(null))}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          {devisRdv ? (
            <>
              <DialogHeader>
                <DialogTitle>Le devis de {devisRdv.prenom}</DialogTitle>
                <DialogDescription>
                  {majuscule(jour(devisRdv.debut))} · {heure(devisRdv.debut)}. Prépare-le maintenant : rien ne part tant
                  que tu ne cliques pas « Envoyer le devis ». Ce que tu remplis reste ici, et dans la fiche du
                  rendez-vous pendant l&apos;appel.
                </DialogDescription>
              </DialogHeader>
              <BlocDevis key={devisRdv.id} orgSlug={orgSlug} bookingId={devisRdv.id} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={facture} onOpenChange={setFacture}>
        <DialogContent className="sm:max-w-lg">
          <Facture releve={releve} mois={mois} nom={espace.nom} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------ Mes rendez-vous */

function OngletRdv({
  orgSlug,
  rdvs,
  enregistrements,
  maintenant,
  moisDuJour,
  aujourdhui,
  onNoter,
  onDevis,
}: {
  orgSlug: string;
  rdvs: RdvCloseuse[];
  enregistrements: Record<string, Enregistrement>;
  maintenant: number;
  moisDuJour: string;
  aujourdhui: string;
  onNoter: (r: RdvCloseuse) => void;
  onDevis: (r: RdvCloseuse) => void;
}) {
  const aFaire = rdvs.filter((r) => aNoter(r, maintenant));
  // Jusqu'à sa fin, le rendez-vous reste ici avec « Préparer le devis » : la
  // closeuse l'envoie pendant l'appel. Il ne disparaissait des deux listes
  // entre dix minutes après le début et la fin (vu le 07/10/2026).
  const aVenir = rdvs.filter((r) => r.statut === "confirme");
  const enAttente = rdvs.filter((r) => r.raison?.recontacter && !r.recontactFait);
  const cle = (r: RdvCloseuse) => r.raison!.recontacterLe ?? r.raison!.recontacter ?? "";
  const recontacter = enAttente
    .filter((r) => rappelArrive(r.raison!, aujourdhui, moisDuJour))
    .sort((a, b) => cle(a).localeCompare(cle(b)));
  const plusTard = enAttente.length - recontacter.length;
  const faits = rdvs
    .filter((r) => r.vente || r.declinee || r.raison || r.r2 || r.statut === "no_show" || r.statut === "annule")
    .reverse();

  return (
    <div className="space-y-10">
      {aFaire.length ? (
        <Section titre="À noter" sousTitre="L'appel est passé : dis ce qui s'est passé.">
          {aFaire.map((r) => (
            <CarteRdv key={r.id} rdv={r} urgent onNoter={onNoter} />
          ))}
        </Section>
      ) : null}

      <Section titre="À venir" sousTitre="Réservés dans tes créneaux.">
        {aVenir.length ? (
          aVenir.map((r) => (
            <CarteRdv key={r.id} rdv={r} orgSlug={orgSlug} maintenant={maintenant} onNoter={onNoter} onDevis={onDevis} />
          ))
        ) : (
          <p className="text-muted-foreground text-sm">Aucun rendez-vous à venir pour l&apos;instant.</p>
        )}
      </Section>

      {recontacter.length || plusTard ? (
        <Section
          titre="À recontacter"
          sousTitre={
            plusTard
              ? `Celles dont le jour est arrivé. ${plusTard} autre${plusTard > 1 ? "s" : ""} plus tard.`
              : "Celles dont le jour est arrivé."
          }
        >
          <div className="border-line divide-line divide-y rounded-lg border">
            {recontacter.map((r) => (
              <LigneRecontact key={r.id} orgSlug={orgSlug} rdv={r} />
            ))}
          </div>
        </Section>
      ) : null}

      {faits.length ? (
        <Section titre="Déjà faits">
          <div className="border-line divide-line divide-y rounded-lg border">
            {faits.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="text-muted-foreground w-48 shrink-0">
                  {majuscule(jour(r.debut))}, {heure(r.debut)}
                </span>
                <span className="w-36 shrink-0 font-medium">{r.prenom}</span>
                <BadgeResultat rdv={r} />
                <BadgeEnregistrement rdv={r} enregistrement={enregistrements[r.id]} />
                {r.r2?.resultat === "demarrer" && !r.vente ? (
                  // Après le R2, c'est la closeuse qui envoie le devis (Louis, 07/10/2026).
                  <Button size="sm" className="ml-auto" onClick={() => onNoter(r)}>
                    <FileText aria-hidden="true" />
                    Envoyer le devis
                  </Button>
                ) : r.statut !== "annule" ? (
                  <button
                    className="text-muted-foreground hover:text-foreground ml-auto text-xs underline-offset-4 hover:underline"
                    onClick={() => onNoter(r)}
                  >
                    Modifier
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ titre, sousTitre, children }: { titre: string; sousTitre?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg">{titre}</h2>
        {sousTitre ? <p className="text-muted-foreground text-sm">{sousTitre}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** « Elle n'est pas venue » se note dès 10 minutes après le début (Louis, 07/10/2026). */
const ABSENTE_APRES_MS = 10 * 60_000;

function CarteRdv({
  rdv,
  urgent,
  orgSlug,
  maintenant,
  onNoter,
  onDevis,
}: {
  rdv: RdvCloseuse;
  urgent?: boolean;
  /** Les rendez-vous à venir : pour « Elle n'est pas venue » pendant le créneau. */
  orgSlug?: string;
  maintenant?: number;
  onNoter: (r: RdvCloseuse) => void;
  /** Préparer le devis avant l'appel (Louis, 06/10/2026) : les rendez-vous à venir seulement. */
  onDevis?: (r: RdvCloseuse) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [enCours, startTransition] = useTransition();
  const router = useRouter();
  // Avant la fin prévue, le rendez-vous n'est pas encore « À noter » : une
  // cliente absente ne se notait qu'après la fin (vu le 07/10/2026, Peggy
  // Auger à 18h15 pour un 18h-18h45). Le bouton apparaît 10 minutes après le
  // début, même si la page est restée ouverte.
  const absenteDes = Date.parse(rdv.debut) + ABSENTE_APRES_MS;
  const [absentePossible, setAbsentePossible] = useState(maintenant !== undefined && maintenant >= absenteDes);
  useEffect(() => {
    if (absentePossible || maintenant === undefined || !orgSlug) return;
    const attente = Math.max(0, absenteDes - Date.now());
    // setTimeout plafonne à environ 24 jours : au-delà, rien à afficher.
    if (attente > 2_000_000_000) return;
    const minuterie = setTimeout(() => setAbsentePossible(true), attente);
    return () => clearTimeout(minuterie);
  }, [absentePossible, absenteDes, maintenant, orgSlug]);

  const noterPasVenue = () => {
    if (!orgSlug) return;
    if (!window.confirm(`${rdv.prenom} n'est pas venue ? Le rendez-vous passe en « Pas venue ».`)) return;
    startTransition(async () => {
      const r = await noterAbsente(orgSlug, { bookingId: rdv.id });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("C'est noté : pas venue", {
        duration: 10_000,
        action: {
          label: "Annuler",
          onClick: async () => {
            const retour = await annulerAbsence(orgSlug, { bookingId: rdv.id });
            if (!retour.ok) toast.error(retour.error);
            router.refresh();
          },
        },
      });
      router.refresh();
    });
  };
  const reponses = rdv.reponses ?? [];
  // La première réponse qui n'est pas le téléphone : la raison du rendez-vous.
  const motif = reponses.find((x) => !/t[ée]l[ée]phone/i.test(x.q));

  return (
    <div className={cn("bg-surface-1 rounded-lg border p-4", urgent ? "border-warning/50" : "border-line")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs">
            {majuscule(jour(rdv.debut))} · {heure(rdv.debut)}
            {rdv.typeNom ? ` · ${rdv.typeNom}` : ""}
          </p>
          <p className="mt-1 text-base font-medium">{rdv.prenom}</p>
          {libelleSuivi(rdv.agentSuivi) ? (
            <Badge
              variant={rdv.agentSuivi === "confirme" ? "secondary" : "outline"}
              className={cn("mt-2", rdv.agentSuivi === "confirme" && "bg-success/15 text-success")}
            >
              {libelleSuivi(rdv.agentSuivi)}
            </Badge>
          ) : null}
        </div>
        {urgent ? (
          <Button size="sm" onClick={() => onNoter(rdv)}>
            <PenLine aria-hidden="true" />
            Noter le résultat
          </Button>
        ) : onDevis || absentePossible ? (
          <div className="flex flex-wrap gap-2">
            {absentePossible && orgSlug ? (
              <Button size="sm" variant="outline" disabled={enCours} onClick={noterPasVenue}>
                <UserX aria-hidden="true" />
                {enCours ? "En cours…" : "Elle n'est pas venue"}
              </Button>
            ) : null}
            {onDevis ? (
              <Button size="sm" variant="outline" onClick={() => onDevis(rdv)}>
                <FileText aria-hidden="true" />
                Préparer le devis
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {motif ? <p className="mt-3 text-sm">{motif.r}</p> : null}
      {reponses.length ? (
        <>
          <button
            className="text-ember mt-3 text-xs underline-offset-4 hover:underline"
            onClick={() => setOuvert((o) => !o)}
            aria-expanded={ouvert}
          >
            {ouvert ? "Masquer ses réponses" : "Voir toutes ses réponses"}
          </button>
          {ouvert ? (
            <dl className="border-line mt-3 space-y-2.5 rounded-md border p-3 text-sm">
              {reponses.map((x, i) => (
                <div key={i}>
                  <dt className="text-muted-foreground text-xs">{x.q}</dt>
                  <dd className="whitespace-pre-line">{x.r}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground mt-3 text-xs">Pas de réponses au formulaire pour ce rendez-vous.</p>
      )}
    </div>
  );
}

function LigneRecontact({ orgSlug, rdv }: { orgSlug: string; rdv: RdvCloseuse }) {
  const [enCours, startTransition] = useTransition();
  const router = useRouter();
  const tel = telephone(rdv);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <span className="w-36 shrink-0 font-medium">{rdv.prenom}</span>
      <span className="text-muted-foreground">{rdv.raison ? LIBELLES_MOTIF[rdv.raison.motif] : ""}</span>
      {rdv.raison ? <Badge variant="secondary">{quandRappeler(rdv.raison)}</Badge> : null}
      {tel ? (
        <a href={`tel:${tel.replace(/\s/g, "")}`} className="text-ember inline-flex items-center gap-1 text-xs">
          <Phone aria-hidden="true" className="size-3.5" />
          {tel}
        </a>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="ml-auto"
        disabled={enCours}
        onClick={() =>
          startTransition(async () => {
            const r = await noterRecontactee(orgSlug, { bookingId: rdv.id });
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success("C'est noté");
            router.refresh();
          })
        }
      >
        <Check aria-hidden="true" />
        C&apos;est fait
      </Button>
    </div>
  );
}

function BadgeResultat({ rdv }: { rdv: RdvCloseuse }) {
  if (rdv.statut === "annule") return <Badge variant="outline">Annulé</Badge>;
  if (rdv.statut === "no_show") return <Badge variant="destructive">Pas venue</Badge>;
  if (rdv.vente) {
    return (
      <Badge className="bg-success/15 text-success">
        Vendu · {montant(rdv.vente.montantCents)} HT{rdv.vente.fois > 1 ? ` en ${rdv.vente.fois} fois` : ""}
      </Badge>
    );
  }
  if (rdv.r2 && !rdv.raison && !rdv.declinee) {
    return (
      <Badge variant="outline" className={cn(rdv.r2.resultat === "demarrer" && "border-success text-success")}>
        R2 avec Peggy · {rdv.r2.resultat ? libelleResultat(rdv.r2.resultat).toLowerCase() : "à appeler"}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      Pas de vente{rdv.raison ? ` · ${LIBELLES_MOTIF[rdv.raison.motif]}` : ""}
    </Badge>
  );
}

/** Sur un diagnostic tenu : la vidéo est-elle là, ou seulement un résumé ? */
function BadgeEnregistrement({ rdv, enregistrement }: { rdv: RdvCloseuse; enregistrement: Enregistrement | undefined }) {
  if (rdv.statut === "annule" || rdv.statut === "no_show") return null;
  if (!enregistrement) {
    return (
      <Badge variant="outline" className="border-warning text-warning">
        Enregistrement à déposer
      </Badge>
    );
  }
  if (enregistrement.sansEnregistrement) return <Badge variant="outline">Sans enregistrement</Badge>;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <FileVideo aria-hidden="true" className="size-3.5" />
      {enregistrement.transcriptionEtat === "faite" ? "Vidéo et transcription" : "Vidéo"}
    </span>
  );
}

/* ----------------------------------------------------------- Mes ventes */

function OngletVentes({
  espace,
  m7,
  mois,
  aujourdhui,
}: {
  espace: EspaceCloseuse;
  m7: string;
  mois: string;
  aujourdhui: string;
}) {
  const ventes = espace.rdvs
    .filter((r) => r.vente && r.vente.date.slice(0, 7) === m7)
    .sort((a, b) => a.vente!.date.localeCompare(b.vente!.date));

  if (!ventes.length) {
    return <p className="text-muted-foreground text-sm">Aucune vente en {libelleMois(mois)}.</p>;
  }

  return (
    <div className="space-y-3">
      {ventes.map((r) => {
        const siens = espace.commission.paiements.filter((p) => p.bookingId === r.id);
        const rang = siens[0]?.rang ?? 0;
        const taux = siens[0]?.taux ?? espace.grille.taux;
        const total = siens.reduce((s, p) => s + p.commissionCents, 0);
        const gagne = siens.filter((p) => p.date <= aujourdhui && p.etat !== "impaye").reduce((s, p) => s + p.commissionCents, 0);
        const v = r.vente!;
        const parts = echeancier(v.montantCents, v.fois, v.premierCents);

        return (
          <div key={r.id} className="border-line bg-surface-1 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-muted-foreground text-xs">
                  {rang === 1 ? "1re" : `${rang}e`} vente du mois · {dateCourte(v.date)}
                </p>
                <p className="mt-1 text-base font-medium">{r.prenom}</p>
                <p className="text-muted-foreground text-sm">
                  {montant(v.montantCents)} HT
                  {v.fois > 1
                    ? `, en ${v.fois} fois (${montant(parts[0])} puis ${montant(parts[1])} par mois)`
                    : ", en une fois"}
                </p>
              </div>
              <div className="text-right">
                <Badge variant={taux === espace.grille.tauxPalier && rang > espace.grille.palierApres ? "default" : "secondary"}>
                  {pourcent(taux)}
                </Badge>
                <p className="font-display mt-2 text-xl font-semibold tabular-nums">{montant(total)}</p>
                <p className="text-muted-foreground text-xs">
                  {gagne < total ? `${montant(gagne)} déjà gagnés, le reste au fil des paiements` : "tout est encaissé"}
                </p>
              </div>
            </div>
            <ol className="mt-4 flex flex-wrap gap-2">
              {siens.map((p) => (
                <li key={p.numero} className={cn("rounded-md border px-2.5 py-1.5 text-xs", classeEtat(p))}>
                  {p.fois > 1 ? `${p.numero}/${p.fois} · ` : ""}
                  {dateCourte(p.date)} · {montant(p.commissionCents)} {LIBELLE_ETAT[p.etat]}
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

const LIBELLE_ETAT: Record<Paiement["etat"], string> = {
  encaisse: "encaissé",
  prevu: "prévu",
  impaye: "impayé",
  rembourse: "remboursé",
};

function classeEtat(p: Paiement) {
  if (p.etat === "encaisse") return "border-success/40 text-success";
  if (p.etat === "impaye" || p.etat === "rembourse") return "border-destructive/40 text-destructive";
  return "border-line text-muted-foreground";
}

/* -------------------------------------------------------- Ma commission */

function OngletCommission({
  releve,
  mois,
  moisDuJour,
  onFacture,
}: {
  releve: ReturnType<typeof releveDuMois>;
  mois: string;
  moisDuJour: string;
  onFacture: () => void;
}) {
  const etat =
    mois < moisDuJour
      ? "Mois terminé"
      : mois === moisDuJour
        ? "À facturer le dernier jour du mois"
        : "Prévu, si les paiements suivent";
  const vide = releve.paiements.length === 0 && releve.reprises.length === 0;

  return (
    <div className="space-y-6">
      <div className="border-line bg-surface-1 flex flex-wrap items-end justify-between gap-4 rounded-lg border p-5">
        <div>
          <p className="text-muted-foreground text-sm">Ta commission de {libelleMois(mois)}</p>
          <p className="font-display mt-1 text-4xl font-semibold tabular-nums">{montant(releve.totalCents)}</p>
          <p className="text-muted-foreground mt-1 text-sm">{etat}</p>
        </div>
        {!vide ? (
          <Button onClick={onFacture}>
            <FileText aria-hidden="true" />
            Préparer ma facture
          </Button>
        ) : null}
      </div>

      {vide ? (
        <p className="text-muted-foreground text-sm">Rien sur tes ventes en {libelleMois(mois)}.</p>
      ) : (
        <div className="border-line overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr className="border-line border-b">
                <th className="px-4 py-2 font-normal">Date</th>
                <th className="px-4 py-2 font-normal">Cliente</th>
                <th className="px-4 py-2 font-normal">Paiement</th>
                <th className="px-4 py-2 text-right font-normal">Montant HT</th>
                <th className="px-4 py-2 text-right font-normal">Taux</th>
                <th className="px-4 py-2 text-right font-normal">Ta part</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {releve.paiements.map((p) => (
                <tr key={`${p.bookingId}-${p.numero}`} className={p.etat === "prevu" ? "text-muted-foreground" : ""}>
                  <td className="px-4 py-2.5">{dateCourte(p.date)}</td>
                  <td className="px-4 py-2.5">{p.prenom}</td>
                  <td className="px-4 py-2.5">
                    {p.fois > 1 ? `Paiement ${p.numero} sur ${p.fois}` : "En une fois"}
                    {p.etat !== "encaisse" ? ` · ${LIBELLE_ETAT[p.etat]}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{montant(p.montantCents)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{pourcent(p.taux)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{montant(p.commissionCents)}</td>
                </tr>
              ))}
              {releve.reprises.map((r) => (
                <tr key={`reprise-${r.bookingId}-${r.numero}`}>
                  <td className="px-4 py-2.5" colSpan={3}>
                    {r.prenom} : paiement {r.numero} remboursé, commission reprise
                  </td>
                  <td colSpan={2} />
                  <td className="text-destructive px-4 py-2.5 text-right font-medium tabular-nums">
                    {montant(r.commissionCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Facture({ releve, mois, nom }: { releve: ReturnType<typeof releveDuMois>; mois: string; nom: string }) {
  const lignes = releve.paiements.filter((p) => p.etat !== "impaye");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Ta facture de {libelleMois(mois)}</DialogTitle>
        <DialogDescription>Les lignes à recopier dans ton outil de facturation.</DialogDescription>
      </DialogHeader>
      <div className="border-line space-y-3 rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <p className="font-medium">{nom || "Toi"}</p>
          <p className="text-muted-foreground text-right text-xs">Objet : commissions sur ventes, {libelleMois(mois)}</p>
        </div>
        <div className="divide-line divide-y">
          {lignes.map((p) => (
            <div key={`${p.bookingId}-${p.numero}`} className="flex justify-between gap-4 py-1.5">
              <span>
                {p.prenom}, {dateCourte(p.date)}
                {p.fois > 1 ? ` (${p.numero}/${p.fois})` : ""} · {pourcent(p.taux)} de {montant(p.montantCents)}
              </span>
              <span className="tabular-nums">{montant(p.commissionCents)}</span>
            </div>
          ))}
          {releve.reprises.map((r) => (
            <div key={`r-${r.bookingId}-${r.numero}`} className="flex justify-between gap-4 py-1.5">
              <span>{r.prenom} : remboursement, commission reprise</span>
              <span className="tabular-nums">{montant(r.commissionCents)}</span>
            </div>
          ))}
        </div>
        <div className="border-line flex justify-between border-t pt-2 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{montant(releve.totalCents)}</span>
        </div>
        {releve.aVenirCents > 0 ? (
          <p className="text-muted-foreground text-xs">
            Dont {montant(releve.aVenirCents)} sur des paiements pas encore arrivés : attends la fin du mois pour facturer.
          </p>
        ) : null}
      </div>
    </>
  );
}

/* ---------------------------------------------------- Comment ça marche */

function OngletRegles({ espace }: { espace: EspaceCloseuse }) {
  const g = espace.grille;
  const regles = [
    {
      titre: `${pourcent(g.taux)} de ce qui est encaissé`,
      texte: "Sur chaque vente que tu conclus, hors TVA.",
    },
    {
      titre: `${pourcent(g.tauxPalier)} au-delà de la ${g.palierApres}e vente du mois`,
      texte: `La vente n° ${g.palierApres + 1} du mois et les suivantes. Les ${g.palierApres} premières restent à ${pourcent(g.taux)}.`,
    },
    {
      titre: "Paiement en plusieurs fois",
      texte: "Ta commission suit chaque paiement. Si tu arrêtes un jour, tu la gardes jusqu'au dernier.",
    },
    {
      titre: "Impayés et remboursements",
      texte: "Rien sur ce qui n'est pas payé. Un remboursement se retire du mois suivant.",
    },
    {
      titre: "Ta facture",
      texte: "Tu es indépendante, mais tu n'as pas de facture à faire : l'app la prépare le 1er du mois, à ton nom. Tu l'acceptes d'un clic dans « Ma commission », et elle t'est payée.",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {regles.map((r) => (
        <div key={r.titre} className="border-line bg-surface-1 rounded-lg border p-4">
          <p className="font-medium">{r.titre}</p>
          <p className="text-muted-foreground mt-1 text-sm">{r.texte}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------ Noter un résultat */

const champ =
  "border-input bg-input/30 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const FOIS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function FormResultat({
  orgSlug,
  organizationId,
  rdv,
  enregistrement,
  aujourdhui,
  onEnvoi,
  onFini,
}: {
  orgSlug: string;
  organizationId: string;
  rdv: RdvCloseuse;
  enregistrement: Enregistrement | undefined;
  aujourdhui: string;
  onEnvoi: (enCours: boolean) => void;
  onFini: () => void;
}) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  const depart: "vente" | "non" | "absente" | "r2" = rdv.vente
    ? "vente"
    : rdv.statut === "no_show"
      ? "absente"
      : rdv.raison || rdv.declinee
        ? "non"
        : rdv.r2
          ? "r2"
          : "vente";
  const [type, setType] = useState(depart);
  const [montantSaisi, setMontant] = useState(rdv.vente ? String(rdv.vente.montantCents / 100) : "");
  const jourRdv = rdv.debut.slice(0, 10);
  const [date, setDate] = useState(rdv.vente?.date ?? aujourdhui);
  const [fois, setFois] = useState(rdv.vente?.fois ?? 1);
  const [premier, setPremier] = useState(
    rdv.vente?.premierCents ? String(rdv.vente.premierCents / 100) : "",
  );
  const [motif, setMotif] = useState<Motif>(rdv.raison?.motif ?? "argent");
  const [recontacterLe, setRecontacterLe] = useState<string>(rdv.raison?.recontacterLe ?? "");
  const [calendrier, setCalendrier] = useState(false);
  const [sansVideo, setSansVideo] = useState(false);
  const [resume, setResume] = useState<ResumeDiagnostic>(enregistrement?.resume ?? RESUME_VIDE);
  const [envoiVideo, setEnvoiVideo] = useState(false);
  const dernierJour = plusMois(aujourdhui, 24);
  // Le R2 avec Peggy (0054) : la fiche de son protocole.
  const [fiche, setFiche] = useState<Partial<Record<CleFiche, string>>>({});
  const [freins, setFreins] = useState<CleFrein[]>([]);
  const [prete, setPrete] = useState<ClePrete>("oui");
  const [joindre, setJoindre] = useState("");
  const [telR2, setTelR2] = useState(() => telephone(rdv) ?? "");
  const demandeR2 = { fiche, freins, prete, joindre, telephone: telR2 };
  const manque = type === "r2" && !rdv.r2 ? manqueR2(demandeR2) : null;

  /*
   * L'enregistrement du diagnostic (0049) : exigé la première fois qu'on note
   * ce qui s'est passé à un rendez-vous tenu. Une vidéo déposée, ou « je n'en
   * ai pas » avec le résumé écrit.
   */
  const dejaNote = Boolean(rdv.vente || rdv.declinee || rdv.raison || rdv.r2);
  const tenu = type !== "absente";
  const regle = Boolean(enregistrement) || (sansVideo && resumeRempli(resume));
  const bloque = tenu && !dejaNote && !regle;

  const suivreEnvoi = (enCours: boolean) => {
    setEnvoiVideo(enCours);
    onEnvoi(enCours);
  };

  const envoyer = () =>
    startTransition(async () => {
      if (tenu && !enregistrement && sansVideo) {
        const r = await noterSansEnregistrement(orgSlug, { bookingId: rdv.id, resume });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
      }
      if (type === "r2") {
        const r = await demanderR2(orgSlug, { bookingId: rdv.id, ...demandeR2 });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success("R2 demandé", {
          description: [
            r.data.mailTitulaire ? "Peggy a reçu ta fiche par mail." : "Le mail à Peggy n'est pas parti : préviens-la.",
            r.data.mailCliente
              ? "La cliente a reçu un mail : Peggy va l'appeler."
              : "Le mail à la cliente n'est pas parti : dis-lui que Peggy va l'appeler.",
          ].join(" "),
          duration: 10_000,
        });
        onFini();
        router.refresh();
        return;
      }
      const resultat =
        type === "vente"
          ? await noterVente(orgSlug, { bookingId: rdv.id, montant: montantSaisi, date, fois, premier })
          : type === "non"
            ? await noterNonVente(orgSlug, { bookingId: rdv.id, motif, recontacterLe: recontacterLe || null })
            : await noterAbsente(orgSlug, { bookingId: rdv.id });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      onFini();
      router.refresh();
    });

  const choix: { id: typeof type; label: string }[] = [
    { id: "vente", label: "Elle a acheté" },
    { id: "non", label: "Elle n'a pas acheté" },
    { id: "absente", label: "Elle n'est pas venue" },
    { id: "r2", label: "R2 avec Peggy" },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Le rendez-vous avec {rdv.prenom}</DialogTitle>
        <DialogDescription>
          {majuscule(jour(rdv.debut))}, {heure(rdv.debut)}
        </DialogDescription>
      </DialogHeader>

      <BlocParcours orgSlug={orgSlug} bookingId={rdv.id} />

      {tenu ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">L&apos;enregistrement du diagnostic</h3>
          {enregistrement || !sansVideo ? (
            <BlocEnregistrement
              orgSlug={orgSlug}
              organizationId={organizationId}
              bookingId={rdv.id}
              enregistrement={enregistrement}
              titreCopie={`Diagnostic de ${rdv.prenom}, ${jour(rdv.debut)}`}
              onEnvoi={suivreEnvoi}
            />
          ) : (
            <FormulaireResume valeur={resume} onChange={setResume} />
          )}
          {!enregistrement && !envoiVideo ? (
            <button
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
              onClick={() => setSansVideo((v) => !v)}
            >
              {sansVideo ? "Finalement, j'ai la vidéo" : "Je n'ai pas d'enregistrement"}
            </button>
          ) : null}
          {sansVideo && !enregistrement ? (
            <p className="text-muted-foreground text-xs">
              Écris ce que tu retiens de l&apos;appel : c&apos;est ce qui servira à préparer le dossier.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Le devis signé en ligne (P16) : envoyé d'ici, signé par elle ; la
          vente s'inscrit seule au paiement (06/10/2026). */}
      {tenu ? <BlocDevis orgSlug={orgSlug} bookingId={rdv.id} /> : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {choix.map((c) => (
          <button
            key={c.id}
            onClick={() => setType(c.id)}
            className={cn(
              "rounded-lg border px-2 py-2.5 text-sm transition-colors",
              type === c.id ? "border-ember bg-ember/10" : "border-line hover:bg-muted",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {type === "vente" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="montant">Montant total HT (€)</Label>
            <Input id="montant" inputMode="decimal" value={montantSaisi} onChange={(e) => setMontant(e.target.value)} placeholder="1 520" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">Date de la vente</Label>
            <Input id="date" type="date" value={date} max={aujourdhui} min={jourRdv} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fois">Payé en</Label>
            <select id="fois" className={champ} value={fois} onChange={(e) => setFois(Number(e.target.value))}>
              {FOIS.map((f) => (
                <option key={f} value={f}>
                  {f === 1 ? "une fois" : `${f} fois`}
                </option>
              ))}
            </select>
          </div>
          {fois > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="premier">Premier paiement (€)</Label>
              <Input id="premier" inputMode="decimal" value={premier} onChange={(e) => setPremier(e.target.value)} placeholder="500" />
            </div>
          ) : null}
          <p className="text-muted-foreground col-span-2 text-xs">
            {fois > 1
              ? "Le reste se répartit à parts égales, un paiement par mois. Laisse le premier paiement vide si tout est égal."
              : "Payé en une seule fois."}
          </p>
        </div>
      ) : null}

      {type === "non" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="motif">Pourquoi</Label>
            <select id="motif" className={champ} value={motif} onChange={(e) => setMotif(e.target.value as Motif)}>
              {MOTIFS.map((m) => (
                <option key={m} value={m}>
                  {LIBELLES_MOTIF[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recontacter">La rappeler le</Label>
            <Popover open={calendrier} onOpenChange={setCalendrier}>
              <PopoverTrigger asChild>
                <Button id="recontacter" variant="outline" className="w-full justify-start font-normal">
                  <CalendarCheck2 aria-hidden="true" />
                  {recontacterLe ? dateLongue(recontacterLe) : "Elle n'a pas dit"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-2">
                <Calendar
                  mode="single"
                  locale={fr}
                  selected={recontacterLe ? new Date(`${recontacterLe}T00:00:00`) : undefined}
                  defaultMonth={recontacterLe ? new Date(`${recontacterLe}T00:00:00`) : undefined}
                  disabled={[
                    { before: new Date(`${aujourdhui}T00:00:00`) },
                    { after: new Date(`${dernierJour}T00:00:00`) },
                  ]}
                  onSelect={(jour) => {
                    setRecontacterLe(jour ? jourDuCalendrier(jour) : "");
                    setCalendrier(false);
                  }}
                />
                {recontacterLe ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 w-full justify-start"
                    onClick={() => {
                      setRecontacterLe("");
                      setCalendrier(false);
                    }}
                  >
                    Elle n&apos;a pas dit
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      ) : null}

      {type === "r2" ? (
        rdv.r2 ? (
          <div className="border-line space-y-1 rounded-lg border p-3 text-sm">
            <p>
              R2 demandé le {dateLongue(rdv.r2.demandeeLe.slice(0, 10))}.{" "}
              {rdv.r2.resultat
                ? `Peggy l'a appelée : ${libelleResultat(rdv.r2.resultat).toLowerCase()}.`
                : "Peggy ne l'a pas encore appelée."}
            </p>
            {rdv.r2.noteTitulaire ? <p className="text-muted-foreground whitespace-pre-line">{rdv.r2.noteTitulaire}</p> : null}
            {rdv.r2.resultat === "demarrer" && !rdv.vente ? (
              <p className="font-medium">Elle veut démarrer : envoie-lui le devis ci-dessus.</p>
            ) : null}
          </div>
        ) : (
          <FormulaireR2
            fiche={fiche}
            setFiche={setFiche}
            freins={freins}
            setFreins={setFreins}
            prete={prete}
            setPrete={setPrete}
            joindre={joindre}
            setJoindre={setJoindre}
            telephone={telR2}
            setTelephone={setTelR2}
          />
        )
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onFini} disabled={enCours}>
          Annuler
        </Button>
        <Button
          onClick={envoyer}
          disabled={
            enCours ||
            envoiVideo ||
            bloque ||
            (type === "vente" && !montantSaisi.trim()) ||
            (type === "r2" && (Boolean(rdv.r2) || manque !== null))
          }
          title={
            bloque
              ? "Dépose la vidéo, ou dis que tu n'en as pas et écris le résumé."
              : type === "r2" && manque
                ? manque
                : undefined
          }
        >
          {type === "r2" ? "Envoyer à Peggy" : "Enregistrer"}
        </Button>
      </DialogFooter>
      {type === "r2" && manque && !bloque ? <p className="text-muted-foreground text-right text-xs">{manque}</p> : null}
    </>
  );
}

/**
 * La fiche du protocole R2 de Peggy (« Protocole R2 expert », kit des
 * closeuses) : ce qu'elle doit savoir pour reprendre là où la closeuse s'est
 * arrêtée, et quand joindre la cliente (Louis, 07/10/2026).
 */
function FormulaireR2(p: {
  fiche: Partial<Record<CleFiche, string>>;
  setFiche: (f: Partial<Record<CleFiche, string>>) => void;
  freins: CleFrein[];
  setFreins: (f: CleFrein[]) => void;
  prete: ClePrete;
  setPrete: (v: ClePrete) => void;
  joindre: string;
  setJoindre: (v: string) => void;
  telephone: string;
  setTelephone: (v: string) => void;
}) {
  return (
    <section className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Peggy reçoit cette fiche par mail et rappelle la cliente au téléphone. La cliente reçoit un mail : Peggy va
        l&apos;appeler. Si elle veut démarrer après, c&apos;est toi qui envoies le devis.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="r2-tel">Son téléphone</Label>
          <Input id="r2-tel" inputMode="tel" value={p.telephone} onChange={(e) => p.setTelephone(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r2-joindre">Quand Peggy peut la joindre</Label>
          <Input
            id="r2-joindre"
            value={p.joindre}
            onChange={(e) => p.setJoindre(e.target.value)}
            placeholder="En semaine après 18h"
          />
        </div>
      </div>
      {CHAMPS_FICHE.map((c) => (
        <div key={c.cle} className="space-y-1.5">
          <Label htmlFor={`r2-${c.cle}`}>
            {c.libelle}
            {c.requis ? "" : <span className="text-muted-foreground font-normal"> (si tu l&apos;as)</span>}
          </Label>
          {c.aide ? <p className="text-muted-foreground text-xs">{c.aide}</p> : null}
          <Textarea
            id={`r2-${c.cle}`}
            rows={c.cle === "questions" || c.cle === "chronologie" ? 4 : 2}
            value={p.fiche[c.cle] ?? ""}
            onChange={(e) => p.setFiche({ ...p.fiche, [c.cle]: e.target.value })}
          />
          {c.cle === "questions" ? (
            <>
              <p className="pt-2 text-sm font-medium">Son frein principal</p>
              <div className="flex flex-wrap gap-2">
                {FREINS.map((f) => {
                  const actif = p.freins.includes(f.cle);
                  return (
                    <button
                      key={f.cle}
                      type="button"
                      aria-pressed={actif}
                      onClick={() => p.setFreins(actif ? p.freins.filter((x) => x !== f.cle) : [...p.freins, f.cle])}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                        actif ? "border-ember bg-ember/10" : "border-line hover:bg-muted",
                      )}
                    >
                      {f.libelle}
                    </button>
                  );
                })}
              </div>
              <p className="pt-2 text-sm font-medium">
                Si Peggy répond à ses questions, est-elle prête à envisager l&apos;accompagnement ?
              </p>
              <div className="flex gap-2">
                {PRETE.map((x) => (
                  <button
                    key={x.cle}
                    type="button"
                    aria-pressed={p.prete === x.cle}
                    onClick={() => p.setPrete(x.cle)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      p.prete === x.cle ? "border-ember bg-ember/10" : "border-line hover:bg-muted",
                    )}
                  >
                    {x.libelle}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ))}
    </section>
  );
}
