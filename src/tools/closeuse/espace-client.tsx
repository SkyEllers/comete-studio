"use client";

import {
  CalendarCheck2,
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileText,
  PenLine,
  Phone,
  ShoppingBag,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  noterAbsente,
  noterNonVente,
  noterRecontactee,
  noterVente,
} from "@/app/app/[orgSlug]/closeuse/actions";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { bilanPossible, heure, jour, montant } from "@/tools/resultats/format";
import { libelleMois, moisPrecedent, moisSuivant } from "@/tools/resultats/mois";
import { LIBELLES_MOTIF, MOTIFS, moisProposes, type Motif } from "@/tools/resultats/non-vente";
import { Tuile } from "@/tools/resultats/tuiles";

import { echeancier, releveDuMois, type Paiement } from "./commission";
import type { EspaceCloseuse, RdvCloseuse } from "./queries";

/**
 * L'espace de la closeuse. Tout ce qu'elle voit vient de ses seuls
 * rendez-vous ; les chiffres du mois se recalculent ici, sans aller-retour,
 * quand elle change de mois.
 */

type Onglet = "rdv" | "ventes" | "commission" | "regles";

const ONGLETS: { id: Onglet; label: string }[] = [
  { id: "rdv", label: "Mes rendez-vous" },
  { id: "ventes", label: "Mes ventes" },
  { id: "commission", label: "Ma commission" },
  { id: "regles", label: "Comment ça marche" },
];

const court = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const dateCourte = (jourIso: string) => court.format(new Date(`${jourIso}T00:00:00Z`));
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pourcent = (t: number) => `${String(t).replace(".", ",")} %`;

function aNoter(r: RdvCloseuse, maintenant: number) {
  return (
    r.statut === "honore" && !r.vente && !r.declinee && !r.raison && bilanPossible(r.debut, maintenant)
  );
}

function telephone(r: RdvCloseuse): string | null {
  const ligne = r.reponses?.find((x) => /t[ée]l[ée]phone/i.test(x.q));
  return ligne?.r ?? null;
}

export function EspaceCloseuseClient({
  orgSlug,
  espace,
  moisDuJour,
  aujourdhui,
  vueDeLouis,
}: {
  orgSlug: string;
  espace: EspaceCloseuse;
  moisDuJour: string;
  aujourdhui: string;
  vueDeLouis: boolean;
}) {
  const [onglet, setOnglet] = useState<Onglet>("rdv");
  const [mois, setMois] = useState(moisDuJour);
  const [aNoterRdv, setANoterRdv] = useState<RdvCloseuse | null>(null);
  const [facture, setFacture] = useState(false);
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

  return (
    <>
      <PageHeader
        title={prenom ? `Bonjour ${prenom}` : "Ton espace"}
        description="Tes rendez-vous, ce que tu as vendu, et ce que tu factures à la fin du mois."
      />

      {vueDeLouis ? (
        <p className="border-line text-muted-foreground mb-6 rounded-md border border-dashed px-3 py-2 text-xs">
          Tu regardes l&apos;espace de {espace.nom || "la closeuse"} tel qu&apos;elle le voit.
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

      <div role="tablist" className="border-line mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b">
        {ONGLETS.map((o) => (
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
          maintenant={maintenant}
          moisDuJour={moisDuJour}
          onNoter={setANoterRdv}
        />
      ) : null}
      {onglet === "ventes" ? <OngletVentes espace={espace} m7={m7} mois={mois} aujourdhui={aujourdhui} /> : null}
      {onglet === "commission" ? (
        <OngletCommission releve={releve} mois={mois} moisDuJour={moisDuJour} onFacture={() => setFacture(true)} />
      ) : null}
      {onglet === "regles" ? <OngletRegles espace={espace} /> : null}

      <Dialog open={aNoterRdv !== null} onOpenChange={(o) => (o ? null : setANoterRdv(null))}>
        <DialogContent>
          {aNoterRdv ? (
            <FormResultat
              key={aNoterRdv.id}
              orgSlug={orgSlug}
              rdv={aNoterRdv}
              aujourdhui={aujourdhui}
              moisDuJour={moisDuJour}
              onFini={() => setANoterRdv(null)}
            />
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
  maintenant,
  moisDuJour,
  onNoter,
}: {
  orgSlug: string;
  rdvs: RdvCloseuse[];
  maintenant: number;
  moisDuJour: string;
  onNoter: (r: RdvCloseuse) => void;
}) {
  const aFaire = rdvs.filter((r) => aNoter(r, maintenant));
  const aVenir = rdvs.filter(
    (r) => r.statut === "confirme" && !bilanPossible(r.debut, maintenant),
  );
  const recontacter = rdvs
    .filter((r) => r.raison?.recontacter && !r.recontactFait && r.raison.recontacter <= moisDuJour)
    .sort((a, b) => (a.raison!.recontacter ?? "").localeCompare(b.raison!.recontacter ?? ""));
  const plusTard = rdvs.filter(
    (r) => r.raison?.recontacter && !r.recontactFait && r.raison.recontacter > moisDuJour,
  ).length;
  const faits = rdvs
    .filter((r) => r.vente || r.declinee || r.raison || r.statut === "no_show" || r.statut === "annule")
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
          aVenir.map((r) => <CarteRdv key={r.id} rdv={r} onNoter={onNoter} />)
        ) : (
          <p className="text-muted-foreground text-sm">Aucun rendez-vous à venir pour l&apos;instant.</p>
        )}
      </Section>

      {recontacter.length || plusTard ? (
        <Section
          titre="À recontacter"
          sousTitre={
            plusTard
              ? `Celles dont le mois est arrivé. ${plusTard} autre${plusTard > 1 ? "s" : ""} plus tard.`
              : "Celles dont le mois est arrivé."
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
                {r.statut !== "annule" ? (
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

function CarteRdv({ rdv, urgent, onNoter }: { rdv: RdvCloseuse; urgent?: boolean; onNoter: (r: RdvCloseuse) => void }) {
  const [ouvert, setOuvert] = useState(false);
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
        </div>
        {urgent ? (
          <Button size="sm" onClick={() => onNoter(rdv)}>
            <PenLine aria-hidden="true" />
            Noter le résultat
          </Button>
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
      {rdv.raison?.recontacter ? <Badge variant="secondary">{libelleMois(rdv.raison.recontacter)}</Badge> : null}
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
  return (
    <Badge variant="secondary">
      Pas de vente{rdv.raison ? ` · ${LIBELLES_MOTIF[rdv.raison.motif]}` : ""}
    </Badge>
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
      texte: "Tu es indépendante : à la fin du mois, tu factures ta commission. Le détail est prêt dans « Ma commission ».",
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
  rdv,
  aujourdhui,
  moisDuJour,
  onFini,
}: {
  orgSlug: string;
  rdv: RdvCloseuse;
  aujourdhui: string;
  moisDuJour: string;
  onFini: () => void;
}) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  const depart: "vente" | "non" | "absente" = rdv.vente ? "vente" : rdv.statut === "no_show" ? "absente" : rdv.raison || rdv.declinee ? "non" : "vente";
  const [type, setType] = useState(depart);
  const [montantSaisi, setMontant] = useState(rdv.vente ? String(rdv.vente.montantCents / 100) : "");
  const jourRdv = rdv.debut.slice(0, 10);
  const [date, setDate] = useState(rdv.vente?.date ?? aujourdhui);
  const [fois, setFois] = useState(rdv.vente?.fois ?? 1);
  const [premier, setPremier] = useState(
    rdv.vente?.premierCents ? String(rdv.vente.premierCents / 100) : "",
  );
  const [motif, setMotif] = useState<Motif>(rdv.raison?.motif ?? "argent");
  const [recontacter, setRecontacter] = useState<string>(rdv.raison?.recontacter ?? "");

  const envoyer = () =>
    startTransition(async () => {
      const resultat =
        type === "vente"
          ? await noterVente(orgSlug, { bookingId: rdv.id, montant: montantSaisi, date, fois, premier })
          : type === "non"
            ? await noterNonVente(orgSlug, { bookingId: rdv.id, motif, recontacter: recontacter || null })
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
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Le rendez-vous avec {rdv.prenom}</DialogTitle>
        <DialogDescription>
          {majuscule(jour(rdv.debut))}, {heure(rdv.debut)}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-3 gap-2">
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
            <Label htmlFor="recontacter">En reparler en</Label>
            <select id="recontacter" className={champ} value={recontacter} onChange={(e) => setRecontacter(e.target.value)}>
              <option value="">Elle n&apos;a pas dit</option>
              {moisProposes(moisDuJour).map((m) => (
                <option key={m} value={m}>
                  {libelleMois(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onFini} disabled={enCours}>
          Annuler
        </Button>
        <Button onClick={envoyer} disabled={enCours || (type === "vente" && !montantSaisi.trim())}>
          Enregistrer
        </Button>
      </DialogFooter>
    </>
  );
}
