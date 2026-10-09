"use client";

import {
  BadgeEuro,
  CalendarClock,
  CalendarX2,
  Check,
  CircleSlash,
  FileVideo,
  Pencil,
  PhoneCall,
  PhoneMissed,
  Undo2,
  UserX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  declarerVente,
  marquerStatut,
  noterAppel,
  refuserVente,
} from "@/app/app/[orgSlug]/(tools)/resultats/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  aujourdhuiAParis,
  bilanPossible,
  dateHeure,
  heure,
  jour,
  moisDeLaVente,
  montant,
  nomComplet,
  origineLisible,
  statutLisible,
  venteEncoreImpossible,
} from "./format";
import { derniereReponse, LIBELLES_APPEL, type ReponseAppel } from "./appel-veille";
import { BlocDevis } from "@/tools/devis/bloc-client";
import type { ChoixVente } from "@/tools/devis/offre-vente-choix";
import { BlocRelances } from "@/tools/closeuse/relances-client";
import { CopierDossier } from "@/tools/fiche/copier-dossier-client";
import { BlocParcours } from "@/tools/fiche/parcours-client";

import { BlocEnregistrement, useSuiviTranscriptions } from "./enregistrement-client";
import type { Enregistrement } from "./enregistrement-format";
import {
  attenteExpiree,
  etatsParRendezVous,
  type EtatRecontact,
  type Motif,
} from "./non-vente";
import {
  FormulaireEnAttente,
  FormulaireNonVente,
  texteRaison,
  useNonVente,
} from "./non-vente-client";
import type { Canal, RendezVous } from "./queries";
import { FormulaireVente, ResumeVente, RetirerVente, type Vente } from "./vente";

/**
 * La liste des rendez-vous et la fiche qui s'ouvre dessous.
 *
 * Pensée pour un téléphone : on lit une ligne d'un coup d'œil — l'heure, la
 * séance, d'où elle vient, combien — et on tape pour le détail. Les actions
 * vivent dans la fiche et non dans la liste : marquer « non venu » par erreur
 * en faisant défiler retirerait une séance de la commission sans que personne
 * ne s'en aperçoive.
 */

export type Activite = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
  profiles: { full_name: string } | null;
};

const LIBELLES_ACTIVITE: Record<string, string> = {
  "booking.created": "Rendez-vous reçu de Calendly",
  "booking.imported": "Repris de l'historique Calendly",
  "booking.rescheduled": "Reprogrammé depuis une autre séance",
  "booking.canceled": "Annulé dans Calendly",
  "status.changed": "Statut modifié",
  "channel.changed": "Canal corrigé",
  "sale.recorded": "Vente déclarée",
  "sale.updated": "Vente corrigée",
  "sale.removed": "Vente retirée",
  "sale.declined": "Pas de vente",
  "call.confirmed": "Appel de la veille : a confirmé",
  "call.no_answer": "Appel de la veille : sans réponse",
  "sale.reason": "Raison notée",
  "recontact.done": "Recontactée",
  "recording.added": "Enregistrement déposé",
  "recording.replaced": "Enregistrement remplacé",
  "recording.missing": "Pas d'enregistrement, résumé écrit",
};

/** Le libellé d'une activité ; une raison de non-vente dit laquelle. */
function libelleActivite(activite: Activite): string {
  if (activite.type === "sale.reason") {
    const etat = etatsParRendezVous([{ ...activite, booking_id: activite.id }])[activite.id];
    if (etat) return texteRaison(etat.raison);
  }
  return LIBELLES_ACTIVITE[activite.type] ?? activite.type;
}

/**
 * « Appel de la veille : a confirmé / sans réponse ».
 *
 * Deux boutons plutôt qu'un menu : on répond d'un pouce, téléphone encore à
 * l'oreille. Le choix actif est le seul en couleur ; en retaper un autre le
 * remplace, et l'ancien reste au journal.
 */
function ChoixAppel({
  reponse,
  enCours,
  taille = "sm",
  onChoisir,
}: {
  reponse: ReponseAppel | null;
  enCours: boolean;
  taille?: "xs" | "sm";
  onChoisir: (reponse: ReponseAppel) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Appel de la veille">
      <Button
        variant={reponse === "confirme" ? "default" : "outline"}
        size={taille}
        disabled={enCours}
        aria-pressed={reponse === "confirme"}
        onClick={() => onChoisir("confirme")}
      >
        <PhoneCall aria-hidden="true" />
        {LIBELLES_APPEL.confirme}
      </Button>
      <Button
        variant={reponse === "sans_reponse" ? "default" : "outline"}
        size={taille}
        disabled={enCours}
        aria-pressed={reponse === "sans_reponse"}
        onClick={() => onChoisir("sans_reponse")}
      >
        <PhoneMissed aria-hidden="true" />
        {LIBELLES_APPEL.sans_reponse}
      </Button>
    </div>
  );
}

/** Le même geste depuis n'importe quel bloc : noter, dire que c'est noté, relire. */
function useNoterAppel(orgSlug: string) {
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  const noter = (bookingId: string, reponse: ReponseAppel) =>
    startTransition(async () => {
      const resultat = await noterAppel(orgSlug, { bookingId, reponse });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      router.refresh();
    });

  return { enCoursAppel: enCours, noter };
}

/**
 * Ce qu'on dit d'un rendez-vous qui n'a pas de nom.
 *
 * Radar a tourné plusieurs mois avant de savoir qui venait, et Calendly ne
 * sera pas réinterrogé pour combler l'histoire. Ces séances-là resteront
 * anonymes ; le dire est plus honnête que de laisser croire à un bug.
 */
const AVANT_IDENTITE = "Reçu avant que Radar enregistre les noms";

export function ListeRendezVous({
  orgSlug,
  organizationId,
  enregistrements = {},
  rendezVous,
  canaux,
  activites,
  sourcesAttribution,
  moisClotures,
  suiviAppel = false,
  ouvrirAuDepart,
  offre = null,
}: {
  orgSlug: string;
  organizationId: string;
  /** L'enregistrement de chaque diagnostic, ou son résumé écrit (0049). */
  enregistrements?: Record<string, Enregistrement>;
  rendezVous: RendezVous[];
  canaux: Canal[];
  activites: Record<string, Activite[]>;
  /** Date de la séance qui a transmis son canal, par identifiant. */
  sourcesAttribution: Record<string, string>;
  /**
   * Les mois dont le relevé est clôturé. Une liste et non un booléen : une
   * recherche par nom traverse les mois, et chaque ligne a le sien.
   */
  moisClotures: string[];
  /** L'espace note ce qu'a donné l'appel de la veille (réglage de Louis). */
  suiviAppel?: boolean;
  /** La fiche à ouvrir d'emblée : le lien de l'événement Google ou du mail de réservation. */
  ouvrirAuDepart?: string;
  /** L'offre du devis de l'espace, pour noter une vente dessus (`offre-vente.ts`). */
  offre?: ChoixVente[] | null;
}) {
  const [ouvert, setOuvert] = useState<string | null>(ouvrirAuDepart ?? null);
  const [enCours, startTransition] = useTransition();
  const { enCoursAppel, noter } = useNoterAppel(orgSlug);
  const { enCoursNonVente, noterRaison, mettreEnAttente } = useNonVente(orgSlug);
  const router = useRouter();

  const parCanal = new Map(canaux.map((canal) => [canal.id, canal]));
  const sources = new Map(Object.entries(sourcesAttribution));
  const choisi = rendezVous.find((rdv) => rdv.id === ouvert) ?? null;
  useSuiviTranscriptions(
    choisi === null && Object.values(enregistrements).some((e) => e.transcriptionEtat === "en_cours"),
  );

  const changer = (bookingId: string, statut: string) =>
    startTransition(async () => {
      const resultat = await marquerStatut(orgSlug, { bookingId, statut });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      setOuvert(null);
      router.refresh();
    });

  /** Déclarer, corriger, ou — avec `null` — retirer. */
  const enregistrerVente = (bookingId: string, vente: Vente | null) =>
    startTransition(async () => {
      const resultat = await declarerVente(
        orgSlug,
        vente
          ? { bookingId, montant: vente.montant, date: vente.date, note: vente.note, choix: vente.choix }
          : { bookingId },
      );
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success(vente ? "Vente enregistrée" : "Vente retirée");
      router.refresh();
    });

  /** « Pas de vente » sans raison, depuis la fiche. */
  const refuser = (bookingId: string) =>
    startTransition(async () => {
      const resultat = await refuserVente(orgSlug, { bookingId });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      router.refresh();
    });

  // Groupées par jour : c'est ainsi qu'on se souvient d'une semaine.
  const parJour = new Map<string, RendezVous[]>();
  for (const rdv of rendezVous) {
    const cle = jour(rdv.scheduled_start);
    parJour.set(cle, [...(parJour.get(cle) ?? []), rdv]);
  }

  return (
    <>
      <div className="space-y-6">
        {[...parJour.entries()].map(([date, lignes]) => (
          <section key={date} className="space-y-2">
            <h2 className="text-muted-foreground font-mono text-xs">{date}</h2>
            <ul className="border-line divide-line divide-y overflow-hidden rounded-lg border">
              {lignes.map((rdv) => {
                const canal = rdv.channel_id ? parCanal.get(rdv.channel_id) : null;
                const declareDiverge =
                  rdv.declared_source &&
                  canal &&
                  !canal.label.toLowerCase().includes(rdv.declared_source.toLowerCase());

                return (
                  <li key={rdv.id}>
                    <button
                      type="button"
                      onClick={() => setOuvert(rdv.id)}
                      className="hover:bg-surface-2 flex w-full items-start gap-3 p-3 text-left transition-colors"
                    >
                      <span className="text-muted-foreground w-12 shrink-0 font-mono text-xs">
                        {heure(rdv.scheduled_start)}
                      </span>

                      <span className="min-w-0 flex-1">
                        {/* Le nom d'abord : c'est ce qu'on cherche des yeux
                            quand on parcourt trente séances d'une semaine. */}
                        <span
                          className={cn(
                            "block truncate text-sm font-medium",
                            rdv.invitee_first_name === "" &&
                              rdv.invitee_last_name === "" &&
                              "text-muted-foreground",
                          )}
                        >
                          {rdv.invitee_display}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {rdv.event_type_name}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant={canal?.is_comete ? "default" : "outline"}>
                            {canal?.label ?? "Sans canal"}
                          </Badge>
                          {rdv.has_sale ? (
                            <Badge variant="outline" className="border-success text-success">
                              Vente
                            </Badge>
                          ) : null}
                          {enregistrements[rdv.id] ? (
                            enregistrements[rdv.id].sansEnregistrement ? (
                              <Badge variant="outline">Sans enregistrement</Badge>
                            ) : (
                              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                                <FileVideo aria-hidden="true" className="size-3.5" />
                                Enregistrement
                              </span>
                            )
                          ) : null}
                          {suiviAppel &&
                          derniereReponse(activites[rdv.id] ?? []) === "sans_reponse" ? (
                            <Badge variant="outline">Sans réponse à l&apos;appel</Badge>
                          ) : null}
                          {declareDiverge ? (
                            <span className="text-muted-foreground text-xs">
                              déclaré : {rdv.declared_source}
                            </span>
                          ) : null}
                        </span>
                      </span>

                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-sm tabular-nums">
                          {montant(rdv.amount_cents, rdv.currency)}
                        </span>
                        {/* Trois teintes pour trois issues. Annulé reste gris —
                            la séance n'a pas eu lieu, et personne n'y est pour
                            rien. Non venu passe en ambre : c'est un créneau
                            perdu, et c'est celui-là qu'on veut voir de loin. */}
                        <span
                          className={cn(
                            "mt-1 block text-xs",
                            rdv.effective_status === "honore" && "text-success",
                            rdv.effective_status === "annule" && "text-muted-foreground",
                            rdv.effective_status === "no_show" && "text-warning",
                          )}
                        >
                          {statutLisible(rdv.effective_status)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <Sheet open={choisi !== null} onOpenChange={(valeur) => !valeur && setOuvert(null)}>
        <SheetContent side="bottom" className="max-h-[88svh] overflow-y-auto">
          {choisi ? (
            <FicheRendezVous
              orgSlug={orgSlug}
              organizationId={organizationId}
              enregistrement={enregistrements[choisi.id]}
              rdv={choisi}
              canal={choisi.channel_id ? (parCanal.get(choisi.channel_id) ?? null) : null}
              activites={activites[choisi.id] ?? []}
              sources={sources}
              moisClotures={moisClotures}
              enCours={enCours || enCoursAppel || enCoursNonVente}
              onChanger={changer}
              onVente={enregistrerVente}
              suiviAppel={suiviAppel}
              reponseAppel={derniereReponse(activites[choisi.id] ?? [])}
              onAppel={noter}
              onRaison={noterRaison}
              onAttente={mettreEnAttente}
              onRefuser={refuser}
              offre={offre}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Ligne({ label, valeur }: { label: string; valeur: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="text-right text-sm">{valeur}</dd>
    </div>
  );
}

function FicheRendezVous({
  orgSlug,
  organizationId,
  enregistrement,
  rdv,
  canal,
  activites,
  sources,
  moisClotures,
  enCours,
  onChanger,
  onVente,
  suiviAppel,
  reponseAppel,
  onAppel,
  onRaison,
  onAttente,
  onRefuser,
  offre,
}: {
  orgSlug: string;
  organizationId: string;
  enregistrement: Enregistrement | undefined;
  rdv: RendezVous;
  canal: Canal | null;
  activites: Activite[];
  sources: Map<string, string>;
  moisClotures: string[];
  enCours: boolean;
  onChanger: (bookingId: string, statut: string) => void;
  onVente: (bookingId: string, vente: Vente | null) => void;
  suiviAppel: boolean;
  reponseAppel: ReponseAppel | null;
  onAppel: (bookingId: string, reponse: ReponseAppel) => void;
  onRaison: (bookingId: string, motif: Motif, recontacter: string | null, apres?: () => void) => void;
  onAttente: (bookingId: string, recontacterLe: string | null, apres?: () => void) => void;
  onRefuser: (bookingId: string) => void;
  offre: ChoixVente[] | null;
}) {
  const [saisie, setSaisie] = useState(false);
  const [raisonOuverte, setRaisonOuverte] = useState(false);
  const [attenteOuverte, setAttenteOuverte] = useState(false);

  const modifiable = rdv.status !== "honore";
  const nom = nomComplet(rdv.invitee_first_name, rdv.invitee_last_name);
  const moisCloture = moisClotures.includes(rdv.mois);

  /*
   * Sur une séance annulée ou non venue, jamais de vente — c'est la règle que
   * `radar_set_sale` fait respecter en base.
   */
  const vendable = rdv.status !== "annule" && rdv.status !== "no_show";

  /*
   * Et pas avant le jour de la séance. La base le refusait déjà ; l'écran, lui,
   * ouvrait un formulaire dont la date minimale tombait après la date maximale,
   * et le navigateur répondait par un message que personne ne pouvait
   * comprendre. On dit maintenant pourquoi, avant de rien proposer.
   */
  const tropTot = venteEncoreImpossible(rdv.scheduled_start);

  /*
   * Une vente se fige avec le relevé de *son* mois, pas de celui de la séance.
   * Un diagnostic de juillet vendu en septembre reste modifiable tant que
   * septembre est ouvert, même si juillet est clôturé depuis longtemps.
   */
  const venteFigee =
    rdv.sale_date !== null && moisClotures.includes(moisDeLaVente(rdv.sale_date));

  /*
   * « Pas de vente » et sa raison : seulement en mode `ventes`, sur une séance
   * honorée qui n'a pas vendu. Pas de verrou de relevé — la raison ne déplace
   * pas un centime — si bien qu'une séance d'un mois clôturé peut encore dire
   * pourquoi, et quand en reparler.
   */
  /*
   * `status` et non `effective_status` : une séance ne devient « honorée »
   * qu'une fois son créneau terminé, et la question de la vente attendait donc
   * 45 minutes. Dix suffisent (voir `bilanPossible`), et les deux statuts
   * écartent de la même façon l'annulée et la non-venue.
   */
  const questionVente =
    rdv.commission_basis === "ventes" &&
    rdv.status === "confirme" &&
    bilanPossible(rdv.scheduled_start) &&
    !rdv.has_sale &&
    !tropTot;
  const declinee = activites.some((activite) => activite.type === "sale.declined");
  const etatNonVente: EtatRecontact | undefined = etatsParRendezVous(
    activites.map((activite) => ({ ...activite, booking_id: rdv.id })),
  )[rdv.id];

  return (
    <>
      <SheetHeader>
        {/* Le nom entier ici, pas l'abrégé de la liste : c'est le moment où
            l'on vérifie qu'on parle de la bonne personne avant de la marquer
            « non venue ». */}
        <SheetTitle>{nom ?? "Invité·e"}</SheetTitle>
        <SheetDescription>
          {rdv.event_type_name} · {dateHeure(rdv.scheduled_start)}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-6">
        {nom === null ? (
          <p className="text-muted-foreground text-xs">{AVANT_IDENTITE}</p>
        ) : null}

        {/* La vente en tête de fiche : c'est l'information qui a changé la
            journée de quelqu'un, elle passe avant le détail de l'attribution. */}
        {rdv.has_sale ? (
          <section className="border-success/40 bg-surface-2 space-y-3 rounded-lg border p-3">
            <ResumeVente rdv={rdv} className="text-sm" />

            {venteFigee ? (
              <p className="text-muted-foreground text-xs">
                Le relevé du mois de cette vente est clôturé : elle ne change plus.
              </p>
            ) : saisie ? (
              <FormulaireVente
                rdv={rdv}
                offre={offre}
                enCours={enCours}
                onEnregistrer={(vente) => {
                  onVente(rdv.id, vente);
                  setSaisie(false);
                }}
                onAnnuler={() => setSaisie(false)}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={enCours}
                  onClick={() => setSaisie(true)}
                >
                  <Pencil aria-hidden="true" />
                  Modifier
                </Button>
                <RetirerVente enCours={enCours} onRetirer={() => onVente(rdv.id, null)} />
              </div>
            )}
          </section>
        ) : vendable && tropTot ? (
          <p className="text-muted-foreground text-xs">
            La vente pourra être déclarée après la séance.
          </p>
        ) : vendable && !moisCloture ? (
          saisie ? (
            <FormulaireVente
              rdv={rdv}
              offre={offre}
              enCours={enCours}
              onEnregistrer={(vente) => {
                onVente(rdv.id, vente);
                setSaisie(false);
              }}
              onAnnuler={() => setSaisie(false)}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setSaisie(true)}>
              <BadgeEuro aria-hidden="true" />
              Vente conclue
            </Button>
          )
        ) : null}

        {questionVente ? (
          attenteOuverte ? (
            <FormulaireEnAttente
              raison={etatNonVente?.raison ?? null}
              enCours={enCours}
              onEnregistrer={(recontacterLe) =>
                onAttente(rdv.id, recontacterLe, () => setAttenteOuverte(false))
              }
              onAnnuler={() => setAttenteOuverte(false)}
            />
          ) : raisonOuverte ? (
            <FormulaireNonVente
              idBase={rdv.id}
              raison={etatNonVente?.raison ?? null}
              enCours={enCours}
              onEnregistrer={(motif, recontacter) =>
                onRaison(rdv.id, motif, recontacter, () => setRaisonOuverte(false))
              }
              onSansRaison={
                declinee
                  ? undefined
                  : () => {
                      onRefuser(rdv.id);
                      setRaisonOuverte(false);
                    }
              }
              onAnnuler={() => setRaisonOuverte(false)}
            />
          ) : etatNonVente?.raison.motif === "pas_encore" &&
            !attenteExpiree(etatNonVente.raison, aujourdhuiAParis()) ? (
            /* En attente : elle peut encore acheter (« Vente conclue » reste
               plus haut) ou dire non ; la date se déplace. */
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm">{texteRaison(etatNonVente.raison, etatNonVente.fait)}</p>
              <Button
                variant="ghost"
                size="sm"
                disabled={enCours}
                onClick={() => setAttenteOuverte(true)}
              >
                <Pencil aria-hidden="true" />
                Modifier
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={enCours}
                onClick={() => setRaisonOuverte(true)}
              >
                <CircleSlash aria-hidden="true" />
                Pas de vente
              </Button>
            </div>
          ) : etatNonVente ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm">{texteRaison(etatNonVente.raison, etatNonVente.fait)}</p>
              <Button
                variant="ghost"
                size="sm"
                disabled={enCours}
                onClick={() => setRaisonOuverte(true)}
              >
                <Pencil aria-hidden="true" />
                Modifier
              </Button>
            </div>
          ) : declinee ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-muted-foreground text-sm">Pas de vente, sans raison notée.</p>
              <Button
                variant="outline"
                size="sm"
                disabled={enCours}
                onClick={() => setRaisonOuverte(true)}
              >
                Dire pourquoi
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={enCours}
                onClick={() => setAttenteOuverte(true)}
              >
                <CalendarClock aria-hidden="true" />
                En attente
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={enCours}
                onClick={() => setRaisonOuverte(true)}
              >
                <CircleSlash aria-hidden="true" />
                Pas de vente
              </Button>
            </div>
          )
        ) : null}

        {/* Son parcours (P16) : sa réservation et ses réponses, puis
            l'assistante WhatsApp. La fiche du rendez-vous est la fiche de la
            cliente. */}
        {/* Tout en un texte, pour ChatGPT (Louis, 08/10/2026) : c'est là que
            mène le lien du mail et de l'agenda du premier rendez-vous. */}
        <CopierDossier orgSlug={orgSlug} bookingId={rdv.id} titre={`Dossier de ${nom ?? "la cliente"}`} />

        <BlocParcours orgSlug={orgSlug} bookingId={rdv.id} />

        {/* L'enregistrement du diagnostic : la vidéo, sa transcription, ou le
            résumé écrit à sa place. Dès que la séance a pu avoir lieu. */}
        {enregistrement || (vendable && bilanPossible(rdv.scheduled_start)) ? (
          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs">L&apos;enregistrement du diagnostic</h3>
            <BlocEnregistrement
              orgSlug={orgSlug}
              organizationId={organizationId}
              bookingId={rdv.id}
              enregistrement={enregistrement}
              titreCopie={`Diagnostic de ${nom ?? "l'invitée"}, ${jour(rdv.scheduled_start)}`}
            />
          </section>
        ) : null}

        {/* Le devis signé en ligne (P16) : après le diagnostic, jamais sur une
            séance annulée ou manquée. Le bloc ne s'affiche que pour un espace
            qui a son modèle de devis, et se cache quand une vente est déjà
            notée à la main (Louis, 08/10/2026). */}
        {vendable && bilanPossible(rdv.scheduled_start) ? (
          <BlocDevis orgSlug={orgSlug} bookingId={rdv.id} venteNotee={rdv.has_sale} />
        ) : null}

        {/* Avant le détail : c'est la question du test, et elle se pose la
            veille, quand le reste de la fiche n'a encore rien à dire. */}
        {suiviAppel ? (
          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs">Appel de la veille</h3>
            <ChoixAppel
              reponse={reponseAppel}
              enCours={enCours}
              onChoisir={(reponse) => onAppel(rdv.id, reponse)}
            />
          </section>
        ) : null}

        <dl className="divide-line divide-y">
          <Ligne label="Statut" valeur={statutLisible(rdv.effective_status)} />
          <Ligne label="D'où elle vient" valeur={origineLisible(rdv, canal, sources)} />
          {rdv.declared_source ? (
            <Ligne label="Réponse à « comment m'avez-vous connu ? »" valeur={rdv.declared_source} />
          ) : null}
          <Ligne label="Montant" valeur={montant(rdv.amount_cents, rdv.currency)} />
          <Ligne
            label="Paiement"
            valeur={rdv.payment_ok ? "Réussi" : "Aucun paiement enregistré"}
          />
          {rdv.payment_ref ? (
            <Ligne
              label="Référence"
              valeur={<span className="font-mono text-xs">{rdv.payment_ref}</span>}
            />
          ) : null}
          <Ligne
            label="Compte dans la commission"
            valeur={rdv.counts_for_commission ? "Oui" : "Non"}
          />
          {rdv.status_note ? <Ligne label="Note" valeur={rdv.status_note} /> : null}
          <BlocRelances orgSlug={orgSlug} bookingId={rdv.id} />
        </dl>

        {moisCloture ? (
          <p className="border-line text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            Le relevé de ce mois est clôturé : les statuts n&apos;y changent plus.
            Si quelque chose te semble faux, conteste le relevé : Louis le corrigera
            et le clôturera de nouveau.
          </p>
        ) : modifiable ? (
          /*
           * Une séance vendue ne s'annule pas d'un geste : la vente resterait
           * derrière, facturable, accrochée à un rendez-vous qui n'a pas eu
           * lieu. `radar_client_set_status` refuse en base ; ici on retire les
           * boutons et on dit pourquoi, plutôt que de les laisser échouer.
           */
          rdv.has_sale ? (
            <p className="border-line text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
              Cette séance porte une vente. Pour la marquer annulée ou non venue,
              retire d&apos;abord la vente.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {rdv.status !== "no_show" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={enCours}
                  onClick={() => onChanger(rdv.id, "no_show")}
                >
                  <UserX aria-hidden="true" />
                  Elle n&apos;est pas venue
                </Button>
              ) : null}

              {rdv.status !== "annule" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={enCours}
                  onClick={() => onChanger(rdv.id, "annule")}
                >
                  <CalendarX2 aria-hidden="true" />
                  Annulée
                </Button>
              ) : null}

              {rdv.status !== "confirme" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={enCours}
                  onClick={() => onChanger(rdv.id, "confirme")}
                >
                  <Undo2 aria-hidden="true" />
                  Rétablir
                </Button>
              ) : null}
            </div>
          )
        ) : null}

        {activites.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs">Ce qui s&apos;est passé</h3>
            <ul className="space-y-2">
              {activites.map((activite) => (
                <li key={activite.id} className="flex items-start gap-2 text-xs">
                  <Check
                    aria-hidden="true"
                    className="text-muted-foreground mt-0.5 size-3 shrink-0"
                  />
                  <span>
                    {libelleActivite(activite)}
                    <span className="text-muted-foreground">
                      {" · "}
                      {dateHeure(activite.created_at)}
                      {activite.profiles?.full_name ? ` · ${activite.profiles.full_name}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

/**
 * Le bloc « À vérifier » du tableau de bord.
 *
 * Une séance passée que personne n'a contestée compte comme honorée, donc dans
 * la commission. La montrer ici, avec un bouton direct, c'est laisser au client
 * l'occasion de dire non avant que le mois se clôture.
 */
export function AVerifier({
  orgSlug,
  lignes,
  canaux,
  /**
   * En mode « ventes », chaque ligne pose une question de plus : « et
   * celle-là, elle a vendu ? ». On y répond ici, sans changer de page — la
   * réponse est la moitié du relevé du mois.
   */
  demanderLaVente = false,
  suiviAppel = false,
  appels = {},
  offre = null,
}: {
  orgSlug: string;
  lignes: RendezVous[];
  canaux: Canal[];
  demanderLaVente?: boolean;
  /** L'offre du devis de l'espace, pour noter une vente dessus (`offre-vente.ts`). */
  offre?: ChoixVente[] | null;
  /** L'espace note ce qu'a donné l'appel de la veille : la question se pose aussi ici. */
  suiviAppel?: boolean;
  appels?: Record<string, ReponseAppel>;
}) {
  const [enCoursStatut, startTransition] = useTransition();
  const { enCoursAppel, noter } = useNoterAppel(orgSlug);
  const { enCoursNonVente, noterRaison, mettreEnAttente } = useNonVente(orgSlug);
  const enCours = enCoursStatut || enCoursAppel || enCoursNonVente;
  const [saisie, setSaisie] = useState<string | null>(null);
  /** La ligne dont on dit pourquoi elle n'a pas vendu. */
  const [raison, setRaison] = useState<string | null>(null);
  /** La ligne mise « En attente », dont on choisit le jour de relance. */
  const [attente, setAttente] = useState<string | null>(null);
  const router = useRouter();
  const parCanal = new Map(canaux.map((canal) => [canal.id, canal]));

  const marquer = (bookingId: string) =>
    startTransition(async () => {
      const resultat = await marquerStatut(orgSlug, { bookingId, statut: "no_show" });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      router.refresh();
    });

  const vendre = (bookingId: string, vente: Vente) =>
    startTransition(async () => {
      const resultat = await declarerVente(orgSlug, {
        bookingId,
        montant: vente.montant,
        date: vente.date,
        note: vente.note,
        choix: vente.choix,
      });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("Vente enregistrée");
      setSaisie(null);
      router.refresh();
    });

  const refuser = (bookingId: string) =>
    startTransition(async () => {
      const resultat = await refuserVente(orgSlug, { bookingId });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("C'est noté");
      router.refresh();
    });

  return (
    <ul className="border-line divide-line divide-y overflow-hidden rounded-lg border">
      {lignes.map((rdv) => (
        <li key={rdv.id} className="p-3">
          <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {/* « Camille D. — mardi 14:00 — Non venue ? » : sans le nom, ce
                bloc demandait de décider du sort d'une séance sans savoir de
                qui il s'agissait. */}
            <p
              className={cn(
                "truncate text-sm font-medium",
                rdv.invitee_first_name === "" &&
                  rdv.invitee_last_name === "" &&
                  "text-muted-foreground",
              )}
            >
              {rdv.invitee_display}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {rdv.event_type_name}
            </p>
            <p className="text-muted-foreground font-mono text-xs">
              {dateHeure(rdv.scheduled_start)} ·{" "}
              {parCanal.get(rdv.channel_id ?? "")?.label ?? "Sans canal"}
            </p>
          </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {/* Une séance vendue n'a plus de question en attente : ni « a-t-elle
                  eu lieu ? » — une vente le dit — ni « a-t-elle vendu ? ». En
                  mode `ventes`, elle sort de la liste (`a-regarder.ts`) ; le
                  résumé ne sert plus qu'au temps du rechargement. */}
              {rdv.has_sale ? (
                <ResumeVente rdv={rdv} className="text-success text-xs" />
              ) : null}

              {rdv.has_sale ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={enCours}
                  onClick={() => marquer(rdv.id)}
                >
                  <UserX aria-hidden="true" />
                  Non venue
                </Button>
              )}

              {demanderLaVente && !rdv.has_sale ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={enCours}
                    onClick={() => {
                      setRaison(null);
                      setAttente(null);
                      setSaisie(saisie === rdv.id ? null : rdv.id);
                    }}
                  >
                    <BadgeEuro aria-hidden="true" />
                    Vente conclue
                  </Button>
                  {/* Ni oui ni non en sortant du rendez-vous : le cas le plus
                      fréquent chez Peggy. Un jour de relance, pas un refus. */}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={enCours}
                    aria-expanded={attente === rdv.id}
                    onClick={() => {
                      setSaisie(null);
                      setRaison(null);
                      setAttente(attente === rdv.id ? null : rdv.id);
                    }}
                  >
                    <CalendarClock aria-hidden="true" />
                    En attente
                  </Button>
                  {/* Plus d'enregistrement direct : on demande d'abord pourquoi,
                      et « Sans raison » reste à portée pour qui ne veut rien dire. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={enCours}
                    aria-expanded={raison === rdv.id}
                    onClick={() => {
                      setSaisie(null);
                      setAttente(null);
                      setRaison(raison === rdv.id ? null : rdv.id);
                    }}
                  >
                    Pas de vente
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {suiviAppel ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">Appel de la veille</span>
              <ChoixAppel
                taille="xs"
                reponse={appels[rdv.id] ?? null}
                enCours={enCours}
                onChoisir={(reponse) => noter(rdv.id, reponse)}
              />
            </div>
          ) : null}

          {saisie === rdv.id ? (
            <div className="mt-3">
              <FormulaireVente
                rdv={rdv}
                offre={offre}
                enCours={enCours}
                onEnregistrer={(vente) => vendre(rdv.id, vente)}
                onAnnuler={() => setSaisie(null)}
              />
            </div>
          ) : null}

          {attente === rdv.id ? (
            <div className="mt-3">
              <FormulaireEnAttente
                raison={null}
                enCours={enCours}
                onEnregistrer={(recontacterLe) =>
                  mettreEnAttente(rdv.id, recontacterLe, () => setAttente(null))
                }
                onAnnuler={() => setAttente(null)}
              />
            </div>
          ) : null}

          {raison === rdv.id ? (
            <div className="mt-3">
              <FormulaireNonVente
                idBase={rdv.id}
                raison={null}
                enCours={enCours}
                onEnregistrer={(motif, recontacter) =>
                  noterRaison(rdv.id, motif, recontacter, () => setRaison(null))
                }
                onSansRaison={() => {
                  refuser(rdv.id);
                  setRaison(null);
                }}
                onAnnuler={() => setRaison(null)}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Les rendez-vous de demain, pour la tournée d'appels.
 *
 * Le client appelle chaque personne la veille. Ce bloc lui met la liste sous
 * les yeux, et la réponse se note à côté du nom, sans ouvrir de fiche. Il ne
 * s'affiche que si l'espace suit l'appel de la veille.
 */
export function AppelsDeDemain({
  orgSlug,
  lignes,
  appels,
}: {
  orgSlug: string;
  lignes: RendezVous[];
  appels: Record<string, ReponseAppel>;
}) {
  const { enCoursAppel, noter } = useNoterAppel(orgSlug);

  if (lignes.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Aucun rendez-vous demain.</p>
    );
  }

  return (
    <ul className="border-line divide-line divide-y overflow-hidden rounded-lg border">
      {lignes.map((rdv) => (
        <li key={rdv.id} className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-muted-foreground w-12 shrink-0 font-mono text-xs">
            {heure(rdv.scheduled_start)}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-sm font-medium",
                rdv.invitee_first_name === "" &&
                  rdv.invitee_last_name === "" &&
                  "text-muted-foreground",
              )}
            >
              {rdv.invitee_display}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {rdv.event_type_name}
            </span>
          </span>
          <ChoixAppel
            taille="xs"
            reponse={appels[rdv.id] ?? null}
            enCours={enCoursAppel}
            onChoisir={(reponse) => noter(rdv.id, reponse)}
          />
        </li>
      ))}
    </ul>
  );
}
