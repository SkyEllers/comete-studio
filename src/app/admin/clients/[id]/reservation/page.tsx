import { ArrowLeft, CalendarDays } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientTabs } from "@/components/admin/client-tabs";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { heureEnMots, jourEnMots } from "@/tools/agent/temps";
import { diagnosticsAConfier, type LireOccupe } from "@/tools/reservation/a-confier";
import { agendasGoogle, lecteurOccupe } from "@/tools/reservation/agenda";
import { parJour } from "@/tools/reservation/creneaux";
import { depotSupabase } from "@/tools/reservation/depot";
import { identifiants } from "@/tools/reservation/google";
import { creneauxLibres, type Disponibilites } from "@/tools/reservation/moteur";

import {
  AjouterPersonne,
  BasculerPersonne,
  CreerJeton,
  OuvrirBouton,
  PreparerBouton,
  ReecrireDescriptions,
  RevoquerJeton,
} from "./reservation-forms";
import { ConfierBouton } from "./confier-forms";

/**
 * La réservation d'un client, vue par Louis : qui prend des diagnostics,
 * qui a connecté son agenda, leurs réglages, et ce que la page proposerait
 * maintenant (calculé pour de vrai, agendas Google compris, même fermée).
 */

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function heuresParSemaine(plages: { debut: string; fin: string }[]): string {
  const total = plages.reduce((s, p) => s + minutes(p.fin) - minutes(p.debut), 0);
  if (total === 0) return "aucun horaire";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} h${m ? ` ${m}` : ""} par semaine`;
}

type Apercu = Disponibilites | { etat: "erreur"; message: string } | null;

async function apercu(organizationId: string): Promise<Apercu> {
  const ids = identifiants();
  if (!ids) return null;
  const admin = createAdminClient();
  try {
    return await creneauxLibres(organizationId, Date.now(), depotSupabase(admin), agendasGoogle(admin, ids), {
      ignorerActif: true,
    });
  } catch (erreur) {
    return { etat: "erreur", message: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}

/** L'occupé Google d'une personne, pour la liste « Confier » ; null sans identifiants Google. */
function lireOccupe(admin: ReturnType<typeof createAdminClient>): LireOccupe | null {
  const ids = identifiants();
  return ids ? lecteurOccupe(admin, ids) : null;
}

type Profil = { full_name: string | null; email: string } | null;
const nom = (p: Profil) => p?.full_name || p?.email || "Sans nom";

export default async function ReservationAdminPage({ params }: PageProps<"/admin/clients/[id]/reservation">) {
  const { id } = await params;
  await requireAdmin();
  const admin = createAdminClient();

  const { data: org } = await admin.from("organizations").select("id, name, slug").eq("id", id).maybeSingle();
  if (!org) notFound();

  const [radar, reglagesLus, personnesLues, horairesLus, rdvLus, membresLus, jetonsLus] = await Promise.all([
    admin
      .from("organization_tools")
      .select("enabled, tools!inner(slug)")
      .eq("organization_id", org.id)
      .eq("tools.slug", "resultats")
      .maybeSingle(),
    admin.from("reservation_reglages").select("*").eq("organization_id", org.id).maybeSingle(),
    admin
      .from("reservation_personnes")
      .select("id, user_id, role, actif, max_par_jour, google_email, google_agenda, google_connecte_le, profiles(full_name, email)")
      .eq("organization_id", org.id)
      .order("created_at"),
    admin.from("reservation_horaires").select("personne_id, debut, fin").eq("organization_id", org.id),
    admin
      .from("reservation_rendez_vous")
      .select("personne_id")
      .eq("organization_id", org.id)
      .eq("statut", "confirme")
      .gte("debut", new Date().toISOString()),
    admin.from("memberships").select("user_id, role, profiles(full_name, email)").eq("organization_id", org.id),
    admin
      .from("reservation_jetons")
      .select("id, label, created_at, last_used_at, revoked_at")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false }),
  ]);

  const reglages = reglagesLus.data;
  const personnes = personnesLues.data ?? [];
  const horaires = horairesLus.data ?? [];
  const rdv = rdvLus.data ?? [];
  const jetons = jetonsLus.data ?? [];
  const deja = new Set(personnes.map((p) => p.user_id));
  const candidates = (membresLus.data ?? [])
    .filter((m) => !deja.has(m.user_id))
    .map((m) => ({
      userId: m.user_id,
      libelle: `${nom(m.profiles)} (${m.role === "closeuse" ? "closeuse" : "titulaire"})`,
    }));
  const noms = new Map(personnes.map((p) => [p.id, nom(p.profiles)]));
  const [vue, tousAConfier] = await Promise.all([
    reglages ? apercu(org.id) : Promise.resolve(null),
    reglages ? diagnosticsAConfier(admin, org.id, lireOccupe(admin)) : Promise.resolve([]),
  ]);

  const confiables = tousAConfier.filter((r) => r.candidates.length > 0);
  const sansPersonne = tousAConfier.filter((r) => r.candidates.length === 0);

  return (
    <>
      <div className="mb-8 space-y-4">
        <Link
          href="/admin/clients"
          prefetch
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Clients
        </Link>
        <div>
          <h1 className="font-display text-2xl font-semibold">{org.name}</h1>
          <p className="text-muted-foreground font-mono text-xs">{org.slug} · Réservation</p>
        </div>
        <ClientTabs organizationId={org.id} actif="reservation" radarActif={Boolean(radar.data?.enabled)} />
      </div>

      {!reglages ? (
        <div className="space-y-4">
          <EmptyState
            icon={CalendarDays}
            title="La réservation n'est pas préparée pour ce client."
            description="Les réglages se posent fermés : la page ne propose rien tant que tu ne l'ouvres pas."
          />
          <PreparerBouton organizationId={org.id} />
        </div>
      ) : (
        <div className="space-y-10">
          <section className="space-y-2 text-sm">
            <h2 className="text-lg">Réglages</h2>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={reglages.actif ? "default" : "secondary"}>
                {reglages.actif ? "Ouverte au public" : "Fermée : la page ne propose rien"}
              </Badge>
              <OuvrirBouton organizationId={org.id} actif={reglages.actif} nomClient={org.name} />
            </div>
            <p className="text-muted-foreground">
              {reglages.duree_minutes} min, {reglages.pause_minutes} min de pause, un créneau toutes les{" "}
              {reglages.pas_minutes} min, préavis de {reglages.preavis_minutes} min. Fenêtre de {reglages.fenetre_jours}{" "}
              jours, puis de {reglages.fenetre_pas_jours} en {reglages.fenetre_pas_jours} jusqu&apos;à{" "}
              {reglages.fenetre_max_jours}. Débutante sous {reglages.seuil_debutante} rendez-vous honorés ; taux de
              vente sur {reglages.periode_taux_jours} jours.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg">Qui prend des diagnostics</h2>
            {personnes.length === 0 ? (
              <p className="text-muted-foreground text-sm">Personne pour l&apos;instant.</p>
            ) : (
              <div className="border-line overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nom</TableHead>
                      <TableHead>Rôle</TableHead>
                      <TableHead>Agenda Google</TableHead>
                      <TableHead>Horaires</TableHead>
                      <TableHead>Max / jour</TableHead>
                      <TableHead>À venir</TableHead>
                      <TableHead className="text-right">Roulement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {personnes.map((p) => (
                      <TableRow key={p.id} className={p.actif ? undefined : "opacity-60"}>
                        <TableCell>{nom(p.profiles)}</TableCell>
                        <TableCell>{p.role === "titulaire" ? "Titulaire" : "Closeuse"}</TableCell>
                        <TableCell className="text-xs">
                          {p.google_connecte_le && p.google_agenda !== "primary" ? (
                            p.google_email
                          ) : (
                            <span className="text-warning">pas connecté</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {heuresParSemaine(horaires.filter((h) => h.personne_id === p.id))}
                        </TableCell>
                        <TableCell>{p.max_par_jour}</TableCell>
                        <TableCell>{rdv.filter((r) => r.personne_id === p.id).length}</TableCell>
                        <TableCell className="text-right">
                          <BasculerPersonne organizationId={org.id} personneId={p.id} actif={p.actif} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <AjouterPersonne organizationId={org.id} candidates={candidates} />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg">La page du site</h2>
            <p className="text-muted-foreground text-sm">
              Le serveur du site appelle le hub avec un de ces jetons (variable <code>COMETE_RESERVATION_TOKEN</code>{" "}
              dans Vercel). Un jeton ne réserve que chez ce client.
            </p>
            {jetons.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {jetons.map((j) => (
                  <li key={j.id} className={`flex flex-wrap items-center gap-3 ${j.revoked_at ? "opacity-60" : ""}`}>
                    <span className="font-medium">{j.label}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      créé le {new Date(j.created_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}
                      {j.last_used_at
                        ? `, servi le ${new Date(j.last_used_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`
                        : ", jamais servi"}
                      {j.revoked_at ? ", révoqué" : ""}
                    </span>
                    {j.revoked_at ? null : <RevoquerJeton organizationId={org.id} jetonId={j.id} />}
                  </li>
                ))}
              </ul>
            ) : null}
            <CreerJeton organizationId={org.id} />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg">Confier à une closeuse</h2>
            <p className="text-muted-foreground text-sm">
              Les diagnostics à venir de la titulaire, avec chaque closeuse qui peut le prendre : dans ses horaires, hors
              de ses absences, sous son maximum du jour, sans chevaucher ses rendez-vous, et libre dans son agenda Google
              (un événement « Disponible » ne bloque pas). Un clic : l&apos;événement passe de l&apos;agenda de la
              titulaire au sien, avec sa visio ; la cliente reçoit le nouveau lien ; Radar et l&apos;assistante suivent.
              Pris sur Calendly : l&apos;événement reste dans l&apos;agenda de la titulaire. Elle peut le supprimer de
              son agenda Google seulement si « Sync cancellations » est coupé dans Calendly (Calendar connections, Add
              to calendar, Edit) ; sinon, le supprimer annule le rendez-vous chez Calendly (06/10/2026).
            </p>
            {confiables.length ? (
              <ul className="space-y-2">
                {confiables.map((r) => (
                  <li key={r.bookingId} className="border-line flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                    <span className="font-medium">
                      {jourEnMots(r.debut, reglages.fuseau)}, {heureEnMots(r.debut, reglages.fuseau)}
                    </span>
                    <span>{r.prenom}</span>
                    {r.calendly ? <Badge variant="outline">Calendly</Badge> : null}
                    <span className="ml-auto flex flex-wrap gap-2">
                      {r.candidates.map((c) => (
                        <ConfierBouton
                          key={c.personneId}
                          organizationId={org.id}
                          bookingId={r.bookingId}
                          personneId={c.personneId}
                          nom={c.nom}
                        />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Aucun diagnostic à confier pour l&apos;instant.</p>
            )}

            <h3 className="pt-3 text-base">Personne n&apos;est disponible ({sansPersonne.length})</h3>
            <p className="text-muted-foreground text-sm">
              Les diagnostics de la titulaire qu&apos;aucune closeuse ne peut prendre aujourd&apos;hui, et pourquoi.
              Une closeuse qui ouvre ce créneau dans « Mon agenda » le fait passer dans la liste du dessus.
            </p>
            {sansPersonne.length ? (
              <ul className="space-y-2">
                {sansPersonne.map((r) => (
                  <li key={r.bookingId} className="border-line border-t pt-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {jourEnMots(r.debut, reglages.fuseau)}, {heureEnMots(r.debut, reglages.fuseau)}
                      </span>
                      <span>{r.prenom}</span>
                      {r.calendly ? <Badge variant="outline">Calendly</Badge> : null}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {r.ecartees.map((e) => `${e.nom} : ${e.raison}`).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Tous les diagnostics à venir ont une closeuse possible.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg">Les rendez-vous déjà dans Google</h2>
            <p className="text-muted-foreground text-sm">
              Réécrit la description des diagnostics à venir dans l&apos;agenda « Diagnostics » de chacune : le
              numéro, les réponses au formulaire et le lien de la fiche. Pour ceux pris avant le 30/09/2026 ; sans
              risque à relancer.
            </p>
            <ReecrireDescriptions organizationId={org.id} />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg">Ce que la page proposerait maintenant</h2>
            {!vue ? (
              <p className="text-muted-foreground text-sm">Identifiants Google absents du serveur.</p>
            ) : vue.etat === "erreur" ? (
              <p className="text-error text-sm">Calcul impossible : {vue.message}</p>
            ) : vue.etat === "ferme" ? (
              <p className="text-muted-foreground text-sm">Fermée.</p>
            ) : (
              <>
                {vue.ecartees.length > 0 ? (
                  <p className="text-warning text-sm">
                    Écartées :{" "}
                    {vue.ecartees
                      .map(
                        (e) =>
                          `${noms.get(e.personneId) ?? "?"} (${e.raison === "sans_agenda" ? "pas d'agenda connecté" : "agenda illisible"})`,
                      )
                      .join(", ")}
                  </p>
                ) : null}
                {vue.etat === "complet" ? (
                  <p className="text-sm">Complet sur {vue.jours} jours : rien à proposer.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p className="text-muted-foreground">Fenêtre ouverte à {vue.jours} jours.</p>
                    {parJour(vue.creneaux, reglages.fuseau)
                      .slice(0, 5)
                      .map((j) => (
                        <div key={j.jour}>
                          <p className="font-medium first-letter:uppercase">
                            {jourEnMots(j.creneaux[0].debut, reglages.fuseau)}
                          </p>
                          <p className="text-muted-foreground">
                            {j.creneaux
                              .map(
                                (c) =>
                                  `${heureEnMots(c.debut, reglages.fuseau)} (${c.personnes.map((x) => noms.get(x)).join(", ")})`,
                              )
                              .join(" · ")}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
