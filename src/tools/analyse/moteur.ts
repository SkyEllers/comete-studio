import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import { texteACopier, type Replique } from "@/tools/resultats/enregistrement-format";
import { derniereRaison } from "@/tools/resultats/non-vente";

import { budgetDuQuestionnaire, reponsesPourAnalyse } from "./agregats";
import type { Issue } from "./grille";
import { demanderJson, MODELE } from "./ia";
import { aAnalyser, lireIssue, syntheseDue, type EtatAnalyse, type FaitsIssue, type IssueLue } from "./issue";
import { leconsPourAnalyse, mouvementsDuCarnet, type Lecon } from "./lecons";
import { profilDuClient, CLIENTS_ANALYSES } from "./profils";
import {
  consignesAnalyse,
  consignesSynthese,
  contenuAnalyse,
  contenuSynthese,
  momentAnalyse,
  type AppelPourSynthese,
} from "./prompt";
import { analyseLue, lireFiche, lireRangee, SCHEMA_ANALYSE, SCHEMA_SYNTHESE, syntheseLue, versRangee } from "./schema";

/**
 * Le moteur de l'analyse des diagnostics (0056).
 *
 * - `passerHorloge` : appelé toutes les dix minutes par la base
 *   (`api/analyse/horloge`). Il analyse les appels prêts, un à la fois tant
 *   qu'il a le temps, puis fait la synthèse du lundi.
 * - `analyserUn` : un appel, de la transcription à l'analyse rangée.
 * - `synthetiser` : tous les appels d'un client, le carnet et le portrait.
 *
 * Tout passe par le service role : l'horloge n'a pas de session, et les
 * actions de Louis ont prouvé `requireAdmin()` avant d'arriver ici.
 */

type Admin = SupabaseClient<Database>;

/** Le temps qu'on laisse à Claude pour lire un appel, et pour la synthèse. */
const DELAI_ANALYSE_MS = 240_000;
const DELAI_SYNTHESE_MS = 280_000;

const PARIS = "Europe/Paris";

// ------------------------------------------------------------ Les faits d'un rendez-vous

type FaitsRdv = {
  bookingId: string;
  organizationId: string;
  closeuseId: string | null;
  statut: string;
  debut: string;
  fin: string;
  prenom: string;
  issue: IssueLue;
  faits: FaitsIssue;
  devis: { dureeMois: number; totalCents: number | null; paiement: string; statut: string } | null;
};

/** Les faits qui disent l'issue de chaque rendez-vous : Radar, devis, R2. */
async function faitsDesRdv(admin: Admin, ids: string[]): Promise<Map<string, FaitsRdv>> {
  const sortie = new Map<string, FaitsRdv>();
  if (ids.length === 0) return sortie;

  const [{ data: rdvs }, { data: devis }, { data: activites }] = await Promise.all([
    admin
      .from("radar_bookings_effective")
      .select("id, organization_id, closeuse_id, effective_status, scheduled_start, scheduled_end, invitee_display, sale_amount_cents")
      .in("id", ids),
    admin
      .from("devis")
      .select("booking_id, statut, signe_le, paye_le, duree_mois, total_cents, paiement, envoye_le")
      .in("booking_id", ids)
      .order("envoye_le", { ascending: true }),
    admin
      .from("radar_booking_activities")
      .select("booking_id, type, payload, created_at")
      .in("booking_id", ids)
      .in("type", ["sale.reason", "sale.declined"]),
  ]);
  // 0054 : `radar_r2` n'est pas encore dans les types générés.
  const { data: r2s } = await (admin as unknown as SupabaseClient)
    .from("radar_r2")
    .select("booking_id, resultat")
    .in("booking_id", ids);
  const r2Par = new Map(
    ((r2s ?? []) as { booking_id: string; resultat: "demarrer" | "reflechit" | "non" | null }[]).map((r) => [
      r.booking_id,
      { resultat: r.resultat },
    ]),
  );

  for (const r of rdvs ?? []) {
    if (!r.id || !r.organization_id || !r.scheduled_start || !r.scheduled_end) continue;
    const sesDevis = (devis ?? []).filter((d) => d.booking_id === r.id && d.statut !== "annule");
    const retenu = sesDevis.find((d) => d.paye_le) ?? sesDevis.find((d) => d.signe_le) ?? sesDevis.at(-1) ?? null;
    const sesActivites = (activites ?? []).filter((a) => a.booking_id === r.id);
    const faits: FaitsIssue = {
      statut: r.effective_status ?? "confirme",
      venteCents: r.sale_amount_cents,
      devisSigne: sesDevis.some((d) => d.signe_le),
      devisPaye: sesDevis.some((d) => d.paye_le),
      r2: r2Par.get(r.id) ?? null,
      motif: derniereRaison(sesActivites)?.motif ?? null,
      declinee: sesActivites.some((a) => a.type === "sale.declined"),
    };
    sortie.set(r.id, {
      bookingId: r.id,
      organizationId: r.organization_id,
      closeuseId: r.closeuse_id,
      statut: faits.statut,
      debut: r.scheduled_start,
      fin: r.scheduled_end,
      prenom: r.invitee_display ?? "la cliente",
      issue: lireIssue(faits),
      faits,
      devis: retenu
        ? { dureeMois: retenu.duree_mois, totalCents: retenu.total_cents, paiement: retenu.paiement, statut: retenu.statut }
        : null,
    });
  }
  return sortie;
}

async function orgsAnalysees(admin: Admin): Promise<{ id: string; slug: string }[]> {
  const { data } = await admin.from("organizations").select("id, slug").in("slug", CLIENTS_ANALYSES);
  return (data ?? []).filter((o): o is { id: string; slug: string } => Boolean(o.slug));
}

/** Les rendez-vous dont l'analyse est à (re)faire, les plus anciens d'abord. */
export async function candidats(admin: Admin, maintenant = Date.now()): Promise<string[]> {
  const orgs = await orgsAnalysees(admin);
  if (orgs.length === 0) return [];

  const { data: enreg } = await admin
    .from("radar_diagnostic_enregistrements")
    .select("booking_id")
    .in(
      "organization_id",
      orgs.map((o) => o.id),
    )
    .eq("transcription_etat", "faite");
  const ids = (enreg ?? []).map((e) => e.booking_id);
  if (ids.length === 0) return [];

  const [faits, { data: analyses }] = await Promise.all([
    faitsDesRdv(admin, ids),
    admin
      .from("radar_analyses")
      .select("booking_id, etat, issue_cle, tentatives, commencee_le, updated_at")
      .in("booking_id", ids),
  ]);
  const etats = new Map<string, EtatAnalyse>(
    (analyses ?? []).map((a) => [
      a.booking_id,
      {
        etat: a.etat as EtatAnalyse["etat"],
        issueCle: a.issue_cle,
        tentatives: a.tentatives,
        commenceeLe: a.commencee_le,
        majLe: a.updated_at,
      },
    ]),
  );

  return [...faits.values()]
    .filter((f) =>
      aAnalyser({
        transcriptionFaite: true,
        statut: f.statut,
        issue: f.issue,
        finRdv: f.fin,
        analyse: etats.get(f.bookingId) ?? null,
        maintenant,
      }),
    )
    .sort((a, b) => a.fin.localeCompare(b.fin))
    .map((f) => f.bookingId);
}

// ------------------------------------------------------------ Le carnet

export async function lireCarnet(admin: Admin, organizationId: string): Promise<Lecon[]> {
  const { data } = await admin
    .from("radar_analyse_lecons")
    .select("id, texte, point, sens, appuis, statut, origine")
    .eq("organization_id", organizationId)
    .order("creee_le");
  return (data ?? []).map((l) => ({
    id: l.id,
    texte: l.texte,
    point: l.point,
    sens: l.sens as Lecon["sens"],
    appuis: l.appuis ?? [],
    statut: l.statut as Lecon["statut"],
    origine: l.origine as Lecon["origine"],
  }));
}

// ------------------------------------------------------------ Un appel

const dateParis = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: PARIS,
});

const euros = (cents: number) => `${Math.round(cents / 100)} €`;

function detailsIssue(f: FaitsRdv): string[] {
  const d: string[] = [];
  if (f.devis) {
    const total = f.devis.totalCents != null ? `, ${euros(f.devis.totalCents)}` : "";
    const duree = f.devis.dureeMois > 0 ? `${f.devis.dureeMois} mois` : "offre sans mensualités";
    d.push(`Devis : ${duree}${total}, paiement ${f.devis.paiement}, ${f.devis.statut}`);
  }
  if (f.faits.devisPaye) d.push("Premier paiement fait");
  if (f.faits.r2) d.push(`R2 avec la titulaire demandé${f.faits.r2.resultat ? ` (résultat : ${f.faits.r2.resultat})` : ", pas encore rappelée"}`);
  if (f.faits.motif) d.push(`Motif noté par la vendeuse : ${f.faits.motif}`);
  return d;
}

/**
 * Prend la main sur l'analyse d'un rendez-vous, sans marcher sur un autre
 * passage : la ligne passe « en cours » seulement si elle n'a pas bougé
 * depuis qu'on l'a lue.
 */
async function reserver(admin: Admin, f: FaitsRdv): Promise<number | null> {
  await admin
    .from("radar_analyses")
    .upsert(
      { booking_id: f.bookingId, organization_id: f.organizationId, closeuse_id: f.closeuseId },
      { onConflict: "booking_id", ignoreDuplicates: true },
    );
  const { data: ligne } = await admin
    .from("radar_analyses")
    .select("tentatives, updated_at")
    .eq("booking_id", f.bookingId)
    .maybeSingle();
  if (!ligne) return null;
  const tentatives = ligne.tentatives + 1;
  const { data: prise } = await admin
    .from("radar_analyses")
    .update({ etat: "en_cours", commencee_le: new Date().toISOString(), tentatives })
    .eq("booking_id", f.bookingId)
    .eq("updated_at", ligne.updated_at)
    .select("booking_id");
  return prise?.length ? tentatives : null;
}

export type ResultatAnalyse = { ok: true } | { ok: false; erreur: string };

export async function analyserUn(admin: Admin, bookingId: string): Promise<ResultatAnalyse> {
  const f = (await faitsDesRdv(admin, [bookingId])).get(bookingId);
  if (!f) return { ok: false, erreur: "rendez-vous introuvable" };

  const { data: org } = await admin.from("organizations").select("slug").eq("id", f.organizationId).maybeSingle();
  const profil = profilDuClient(org?.slug);
  if (!profil) return { ok: false, erreur: "pas de profil d'analyse pour ce client" };

  const [{ data: enreg }, { data: reponses }, { data: closeuse }, carnet] = await Promise.all([
    admin
      .from("radar_diagnostic_enregistrements")
      .select("transcription, transcription_etat")
      .eq("booking_id", bookingId)
      .maybeSingle(),
    admin.from("radar_booking_answers").select("answers").eq("booking_id", bookingId).maybeSingle(),
    f.closeuseId
      ? admin.from("profiles").select("full_name").eq("id", f.closeuseId).maybeSingle()
      : Promise.resolve({ data: null }),
    lireCarnet(admin, f.organizationId),
  ]);
  const repliques = Array.isArray(enreg?.transcription) ? (enreg.transcription as unknown as Replique[]) : [];
  if (enreg?.transcription_etat !== "faite" || repliques.length === 0) {
    return { ok: false, erreur: "pas de transcription prête" };
  }

  if ((await reserver(admin, f)) === null) return { ok: false, erreur: "analyse déjà en cours" };

  const lecons = leconsPourAnalyse(carnet);
  const parTitulaire = f.closeuseId === null;
  const reponsesLues = Array.isArray(reponses?.answers) ? (reponses.answers as { q: string; r: string }[]) : [];

  const resultat = await demanderJson(
    {
      stables: consignesAnalyse(profil),
      moment: momentAnalyse(lecons),
      contenu: contenuAnalyse({
        menePar: parTitulaire ? profil.titulaire : (closeuse?.full_name?.split(" ")[0] ?? "la closeuse"),
        parTitulaire,
        prenomCliente: f.prenom,
        dateRdv: dateParis.format(new Date(f.debut)),
        issue: f.issue.issue,
        detailsIssue: detailsIssue(f),
        reponses: reponsesPourAnalyse(reponsesLues),
        transcription: texteACopier(repliques),
      }),
      schema: SCHEMA_ANALYSE,
      maxTokens: 32_000,
      delaiMs: DELAI_ANALYSE_MS,
    },
    analyseLue,
  );

  if (!resultat.ok) {
    console.error(`[analyse] ${bookingId} : ${resultat.erreur}`);
    await admin
      .from("radar_analyses")
      .update({ etat: "echec", erreur: resultat.erreur.slice(0, 500) })
      .eq("booking_id", bookingId);
    return { ok: false, erreur: resultat.erreur };
  }

  const a = resultat.valeur;
  const { error } = await admin
    .from("radar_analyses")
    .update({
      etat: "faite",
      closeuse_id: f.closeuseId,
      issue: f.issue.issue,
      issue_cle: f.issue.cle,
      lecture: versRangee(a) as unknown as Json,
      erreur: null,
      faite_le: new Date().toISOString(),
      modele: MODELE,
      usage: resultat.usage as unknown as Json,
      lecons_actives: lecons.length,
    })
    .eq("booking_id", bookingId);
  if (error) {
    console.error(`[analyse] ${bookingId} : rangement raté (${error.message})`);
    return { ok: false, erreur: "rangement raté" };
  }

  await admin
    .from("radar_analyse_fiches")
    .upsert({ booking_id: bookingId, organization_id: f.organizationId, fiche: a.fiche as unknown as Json }, { onConflict: "booking_id" });
  await admin.from("radar_analyse_passages").delete().eq("booking_id", bookingId);
  if (a.passages.length) {
    await admin.from("radar_analyse_passages").insert(
      a.passages.map((p) => ({
        booking_id: bookingId,
        organization_id: f.organizationId,
        par_titulaire: parTitulaire,
        moment: p.moment,
        texte: p.texte,
        pourquoi: p.pourquoi || null,
        vente: f.issue.issue === "vente",
      })),
    );
  }
  return { ok: true };
}

// ------------------------------------------------------------ La synthèse

export async function synthetiser(admin: Admin, organizationId: string): Promise<ResultatAnalyse & { appels?: number }> {
  const { data: org } = await admin.from("organizations").select("slug").eq("id", organizationId).maybeSingle();
  const profil = profilDuClient(org?.slug);
  if (!profil) return { ok: false, erreur: "pas de profil d'analyse pour ce client" };

  const { data: lignes } = await admin
    .from("radar_analyses")
    .select("booking_id, closeuse_id, issue, lecture")
    .eq("organization_id", organizationId)
    .eq("etat", "faite");
  const faites = lignes ?? [];
  if (faites.length === 0) return { ok: false, erreur: "aucun appel analysé" };

  const ids = faites.map((l) => l.booking_id);
  const closeuses = [...new Set(faites.map((l) => l.closeuse_id).filter((c): c is string => Boolean(c)))];
  const [{ data: fiches }, { data: reponses }, { data: profils }, { data: rdvs }, carnet] = await Promise.all([
    admin.from("radar_analyse_fiches").select("booking_id, fiche").in("booking_id", ids),
    admin.from("radar_booking_answers").select("booking_id, answers").in("booking_id", ids),
    closeuses.length ? admin.from("profiles").select("id, full_name").in("id", closeuses) : Promise.resolve({ data: [] }),
    admin.from("radar_bookings").select("id, scheduled_start").in("id", ids),
    lireCarnet(admin, organizationId),
  ]);

  const debutPar = new Map((rdvs ?? []).map((r) => [r.id, r.scheduled_start ?? ""]));
  const tries = [...faites].sort((a, b) => (debutPar.get(a.booking_id) ?? "").localeCompare(debutPar.get(b.booking_id) ?? ""));
  const parCode = new Map<string, string>();
  const appels: AppelPourSynthese[] = tries.map((l, i) => {
    const code = `R${i + 1}`;
    parCode.set(code, l.booking_id);
    const analyse = lireRangee(l.lecture);
    const nom = l.closeuse_id
      ? (profils ?? []).find((p) => p.id === l.closeuse_id)?.full_name?.split(" ")[0] ?? "une closeuse"
      : profil.titulaire;
    const answers = (reponses ?? []).find((r) => r.booking_id === l.booking_id)?.answers;
    return {
      code,
      menePar: nom,
      issue: (l.issue ?? "inconnue") as Issue,
      date: (debutPar.get(l.booking_id) ?? "").slice(0, 10),
      // Ce qui compte pour comparer, sans les extraits mot pour mot : la synthèse reste légère.
      analyse: analyse
        ? {
            reperes: Object.fromEntries(analyse.points.map((p) => [p.cle, p.repere])),
            constats: Object.fromEntries(analyse.points.filter((p) => p.constat).map((p) => [p.cle, p.constat])),
            alertes: analyse.alertes.map((x) => x.cle),
            pas_su: analyse.pas_su.map((x) => x.question),
            pourquoi: analyse.pourquoi,
          }
        : null,
      fiche: lireFiche((fiches ?? []).find((x) => x.booking_id === l.booking_id)?.fiche),
      budget: budgetDuQuestionnaire(Array.isArray(answers) ? (answers as { q: string; r: string }[]) : null),
    };
  });

  const resultat = await demanderJson(
    {
      stables: consignesSynthese(profil),
      moment: "Voici l'état du carnet et les rendez-vous.",
      contenu: contenuSynthese(appels, carnet),
      schema: SCHEMA_SYNTHESE,
      maxTokens: 32_000,
      delaiMs: DELAI_SYNTHESE_MS,
    },
    syntheseLue,
  );
  if (!resultat.ok) {
    console.error(`[analyse] synthèse ${organizationId} : ${resultat.erreur}`);
    return { ok: false, erreur: resultat.erreur };
  }

  const s = resultat.valeur;
  const { nouvelles, majs, retraits } = mouvementsDuCarnet(s, carnet, parCode);
  const maintenant = new Date().toISOString();

  if (nouvelles.length) {
    await admin.from("radar_analyse_lecons").insert(
      nouvelles.map((n) => ({
        organization_id: organizationId,
        texte: n.texte,
        point: n.point,
        sens: n.sens,
        appuis: n.appuis,
        nb_appuis: n.appuis.length,
        statut: n.statut,
        origine: "synthese",
        decidee_le: n.statut === "active" ? maintenant : null,
      })),
    );
  }
  for (const m of majs) {
    const avant = carnet.find((l) => l.id === m.id);
    await admin
      .from("radar_analyse_lecons")
      .update({
        appuis: m.appuis,
        nb_appuis: m.appuis.length,
        statut: m.statut,
        ...(avant && avant.statut !== m.statut ? { decidee_le: maintenant } : {}),
      })
      .eq("id", m.id)
      .eq("organization_id", organizationId);
  }
  for (const r of retraits) {
    await admin
      .from("radar_analyse_lecons")
      .update({ statut: "retiree", note: r.note || null, decidee_le: maintenant })
      .eq("id", r.id)
      .eq("organization_id", organizationId);
  }

  await admin.from("radar_analyse_syntheses").insert({
    organization_id: organizationId,
    nb_appels: appels.length,
    contenu: { portrait: s.portrait, recrutement: s.recrutement, equipe: s.equipe } as unknown as Json,
    modele: MODELE,
    usage: resultat.usage as unknown as Json,
  });

  return { ok: true, appels: appels.length };
}

async function synthesesDues(admin: Admin, maintenant: Date): Promise<string[]> {
  const dues: string[] = [];
  for (const org of await orgsAnalysees(admin)) {
    const { data: derniere } = await admin
      .from("radar_analyse_syntheses")
      .select("faite_le")
      .eq("organization_id", org.id)
      .order("faite_le", { ascending: false })
      .limit(1)
      .maybeSingle();
    let requete = admin
      .from("radar_analyses")
      .select("booking_id", { count: "exact", head: true })
      .eq("organization_id", org.id)
      .eq("etat", "faite");
    if (derniere?.faite_le) requete = requete.gt("faite_le", derniere.faite_le);
    const { count } = await requete;
    if (syntheseDue(derniere?.faite_le ?? null, count ?? 0, maintenant)) dues.push(org.id);
  }
  return dues;
}

// ------------------------------------------------------------ L'horloge

/**
 * Un passage : des analyses tant qu'il reste de quoi en finir une avant la
 * coupure de la fonction, puis la synthèse si elle est due et qu'il reste du
 * temps. Le passage suivant reprend où celui-ci s'est arrêté.
 */
export async function passerHorloge(
  admin: Admin,
  budgetMs: number,
  maintenant = new Date(),
): Promise<{ analyses: number; echecs: number; syntheses: number; restants: number }> {
  const debut = Date.now();
  const reste = () => budgetMs - (Date.now() - debut);
  const file = await candidats(admin, maintenant.getTime());

  let analyses = 0;
  let echecs = 0;
  while (file.length && reste() > DELAI_ANALYSE_MS) {
    const id = file.shift() as string;
    const r = await analyserUn(admin, id);
    if (r.ok) analyses += 1;
    else echecs += 1;
  }

  let syntheses = 0;
  if (file.length === 0 && reste() > DELAI_SYNTHESE_MS) {
    for (const orgId of await synthesesDues(admin, maintenant)) {
      if (reste() <= DELAI_SYNTHESE_MS) break;
      const r = await synthetiser(admin, orgId);
      if (r.ok) syntheses += 1;
    }
  }
  return { analyses, echecs, syntheses, restants: file.length };
}
