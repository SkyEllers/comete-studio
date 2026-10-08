import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { budgetDuQuestionnaire, chiffresPortrait, comparaison, type EntreePortrait } from "./agregats";
import { resteAvantOuverture, SEUIL_OUVERTURE, type Issue } from "./grille";
import { lireCarnet } from "./moteur";
import { profilDuClient, CLIENTS_ANALYSES } from "./profils";
import {
  alertesATrancher,
  alertesSures,
  lireFiche,
  lireRangee,
  lireSynthese,
  type Alerte,
  type AnalyseRangee,
  type Fiche,
  type SyntheseRangee,
} from "./schema";

/**
 * Ce que lisent les écrans de l'analyse. Service role, toujours après la
 * garde de la page (`requireCloseuse`, `requireAdmin`) : une closeuse a le
 * droit de voir les chiffres d'ensemble de l'équipe, pas les lignes des
 * autres, et ces chiffres se calculent ici. La RLS de la 0056 garde les
 * mêmes portes pour qui lirait les tables avec sa session.
 */

export type AppelAnalyse = {
  bookingId: string;
  prenom: string;
  debut: string;
  issue: Issue;
  closeuseId: string | null;
  etat: "a_faire" | "en_cours" | "faite" | "echec";
  analyse: AnalyseRangee | null;
  erreur: string | null;
  faiteLe: string | null;
};

export type PassageVu = { id: string; moment: string; texte: string; pourquoi: string | null; parTitulaire: boolean; vente: boolean };

type LigneAnalyse = {
  booking_id: string;
  closeuse_id: string | null;
  etat: string;
  issue: string | null;
  lecture: unknown;
  erreur: string | null;
  faite_le: string | null;
};

async function versAppels(lignes: LigneAnalyse[]): Promise<AppelAnalyse[]> {
  if (lignes.length === 0) return [];
  const admin = createAdminClient();
  const { data: rdvs } = await admin
    .from("radar_bookings_effective")
    .select("id, invitee_display, scheduled_start")
    .in(
      "id",
      lignes.map((l) => l.booking_id),
    );
  const par = new Map((rdvs ?? []).filter((r) => r.id).map((r) => [r.id as string, r]));
  return lignes
    .map((l) => ({
      bookingId: l.booking_id,
      prenom: par.get(l.booking_id)?.invitee_display ?? "Cliente",
      debut: par.get(l.booking_id)?.scheduled_start ?? "",
      issue: (l.issue ?? "inconnue") as Issue,
      closeuseId: l.closeuse_id,
      etat: l.etat as AppelAnalyse["etat"],
      analyse: lireRangee(l.lecture),
      erreur: l.erreur,
      faiteLe: l.faite_le,
    }))
    .sort((a, b) => b.debut.localeCompare(a.debut));
}

const COLONNES = "booking_id, closeuse_id, etat, issue, lecture, erreur, faite_le";

// ------------------------------------------------------------ La closeuse

export type VueCloseuse =
  | { ouverte: false; tenus: number; reste: number; apercu: false }
  | {
      ouverte: boolean;
      tenus: number;
      reste: number | null;
      /** Louis regarde un onglet encore fermé pour elle. */
      apercu: boolean;
      appels: AppelAnalyse[];
      comparaison: ReturnType<typeof comparaison>;
      nbAppelsEquipe: number;
      passages: PassageVu[];
    };

export async function getVueCloseuse(organizationId: string, closeuseId: string, vueDeLouis: boolean): Promise<VueCloseuse | null> {
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("slug").eq("id", organizationId).maybeSingle();
  if (!profilDuClient(org?.slug)) return null;

  const { data: tenusLu } = await admin.rpc("radar_analyse_tenus", { org: organizationId, closeuse: closeuseId });
  const tenus = typeof tenusLu === "number" ? tenusLu : 0;
  const ouverte = tenus >= SEUIL_OUVERTURE;
  const reste = resteAvantOuverture(tenus);
  if (!ouverte && !vueDeLouis) return { ouverte: false, tenus, reste: reste ?? 0, apercu: false };

  const [{ data: siennes }, { data: equipe }] = await Promise.all([
    admin.from("radar_analyses").select(COLONNES).eq("organization_id", organizationId).eq("closeuse_id", closeuseId),
    admin
      .from("radar_analyses")
      .select("booking_id, lecture")
      .eq("organization_id", organizationId)
      .eq("etat", "faite")
      .not("closeuse_id", "is", null)
      .neq("closeuse_id", closeuseId),
  ]);
  const appels = await versAppels(siennes ?? []);
  const miens = new Set(appels.map((a) => a.bookingId));

  const { data: passages } = await admin
    .from("radar_analyse_passages")
    .select("id, booking_id, moment, texte, pourquoi, par_titulaire, vente")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(300);

  const analysesEquipe = (equipe ?? []).map((l) => lireRangee(l.lecture)).filter((a): a is AnalyseRangee => a !== null);
  return {
    ouverte,
    tenus,
    reste,
    apercu: !ouverte,
    appels,
    comparaison: comparaison(
      appels.map((a) => a.analyse).filter((a): a is AnalyseRangee => a !== null),
      analysesEquipe,
    ),
    nbAppelsEquipe: analysesEquipe.length,
    passages: (passages ?? [])
      .filter((p) => !miens.has(p.booking_id))
      .map((p) => ({
        id: p.id,
        moment: p.moment,
        texte: p.texte,
        pourquoi: p.pourquoi,
        parTitulaire: p.par_titulaire,
        vente: p.vente,
      })),
  };
}

// ------------------------------------------------------------ Louis

export type Personne = {
  /** L'identifiant de la closeuse, ou « titulaire ». */
  cle: string;
  nom: string;
  parTitulaire: boolean;
  tenus: number | null;
  ouverte: boolean | null;
  analyses: number;
  ventes: number;
  alertes: number;
};

export type LeconVue = {
  id: string;
  texte: string;
  point: string;
  sens: "vend" | "perd" | "conseil";
  nbAppuis: number;
  statut: "proposee" | "active" | "refusee" | "retiree";
  origine: "synthese" | "correction";
  note: string | null;
  creeeLe: string;
};

export type TableauClient = {
  organizationId: string;
  nom: string;
  personnes: Personne[];
  enAttente: number;
  echecs: number;
  carnet: LeconVue[];
  synthese: (SyntheseRangee & { faiteLe: string; nbAppels: number }) | null;
  portrait: ReturnType<typeof chiffresPortrait>;
  coutDuMoisDollars: number;
  /** Les alertes « à vérifier » que Louis n'a pas encore tranchées, appel par appel. */
  aVerifier: { bookingId: string; menePar: string; alertes: Alerte[] }[];
};

/** Le prix d'un appel à Claude Opus 5.5, en dollars : 4 $ et 20 $ le million de jetons, 0,20 $ en lecture de cache. */
export function coutDollars(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  return (n("input_tokens") * 4 + n("cache_creation_input_tokens") * 5 + n("cache_read_input_tokens") * 0.2 + n("output_tokens") * 20) / 1e6;
}

function debutDuMois(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function getTableauAdmin(): Promise<TableauClient[]> {
  const admin = createAdminClient();
  const { data: orgs } = await admin.from("organizations").select("id, name, slug").in("slug", CLIENTS_ANALYSES);
  const sortie: TableauClient[] = [];

  for (const org of orgs ?? []) {
    const profil = profilDuClient(org.slug);
    if (!profil) continue;

    const [{ data: closeuses }, { data: analyses }, { data: fiches }, carnet, { data: lecons }, { data: synthese }, { data: syntheses }] =
      await Promise.all([
        admin.from("radar_closeuses").select("user_id, created_at").eq("organization_id", org.id).order("created_at"),
        admin.from("radar_analyses").select("booking_id, closeuse_id, etat, issue, lecture, faite_le, usage").eq("organization_id", org.id),
        admin.from("radar_analyse_fiches").select("booking_id, fiche").eq("organization_id", org.id),
        lireCarnet(admin, org.id),
        admin.from("radar_analyse_lecons").select("id, note, creee_le, nb_appuis, booking_id").eq("organization_id", org.id),
        admin
          .from("radar_analyse_syntheses")
          .select("contenu, faite_le, nb_appels")
          .eq("organization_id", org.id)
          .order("faite_le", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin.from("radar_analyse_syntheses").select("usage").eq("organization_id", org.id).gte("faite_le", debutDuMois()),
      ]);

    const ids = (closeuses ?? []).map((c) => c.user_id);
    const { data: profils } = ids.length
      ? await admin.from("profiles").select("id, full_name, email").in("id", ids)
      : { data: [] as { id: string; full_name: string | null; email: string }[] };
    const tenus = await Promise.all(
      ids.map(async (id) => {
        const { data } = await admin.rpc("radar_analyse_tenus", { org: org.id, closeuse: id });
        return typeof data === "number" ? data : 0;
      }),
    );

    const lignes = analyses ?? [];
    const faites = lignes.filter((l) => l.etat === "faite");
    const resume = (cle: string | null) => {
      const siennes = faites.filter((l) => l.closeuse_id === cle);
      return {
        analyses: siennes.length,
        ventes: siennes.filter((l) => l.issue === "vente").length,
        alertes: siennes.reduce((s, l) => s + alertesSures(lireRangee(l.lecture)?.alertes ?? []).length, 0),
      };
    };

    const personnes: Personne[] = [
      ...ids.map((id, i) => {
        const p = (profils ?? []).find((x) => x.id === id);
        return {
          cle: id,
          nom: p?.full_name || p?.email || "Closeuse",
          parTitulaire: false,
          tenus: tenus[i],
          ouverte: tenus[i] >= SEUIL_OUVERTURE,
          ...resume(id),
        };
      }),
      { cle: "titulaire", nom: profil.titulaire, parTitulaire: true, tenus: null, ouverte: null, ...resume(null) },
    ];

    const { data: reponses } = faites.length
      ? await admin
          .from("radar_booking_answers")
          .select("booking_id, answers")
          .in(
            "booking_id",
            faites.map((l) => l.booking_id),
          )
      : { data: [] as { booking_id: string; answers: unknown }[] };
    const entrees: EntreePortrait[] = faites.map((l) => {
      const answers = (reponses ?? []).find((r) => r.booking_id === l.booking_id)?.answers;
      return {
        issue: (l.issue ?? "inconnue") as Issue,
        fiche: lireFiche((fiches ?? []).find((f) => f.booking_id === l.booking_id)?.fiche) as Fiche | null,
        budget: budgetDuQuestionnaire(Array.isArray(answers) ? (answers as { q: string; r: string }[]) : null),
      };
    });

    const mois = debutDuMois();
    const cout =
      lignes.filter((l) => l.faite_le && l.faite_le >= mois).reduce((s, l) => s + coutDollars(l.usage), 0) +
      (syntheses ?? []).reduce((s, l) => s + coutDollars(l.usage), 0);

    const trancheesPar = new Map<string, Set<string>>();
    for (const l of lecons ?? []) {
      if (!l.booking_id || !l.note?.startsWith("alerte ")) continue;
      trancheesPar.set(l.booking_id, (trancheesPar.get(l.booking_id) ?? new Set()).add(l.note));
    }
    const nomDe = (cle: string | null) => personnes.find((p) => p.cle === (cle ?? "titulaire"))?.nom ?? "Closeuse";
    const aVerifier = faites
      .map((l) => ({
        bookingId: l.booking_id,
        menePar: nomDe(l.closeuse_id),
        alertes: alertesATrancher(lireRangee(l.lecture)?.alertes ?? [], trancheesPar.get(l.booking_id) ?? new Set()),
      }))
      .filter((x) => x.alertes.length);

    const contenu = synthese ? lireSynthese(synthese.contenu) : null;
    sortie.push({
      organizationId: org.id,
      nom: org.name,
      personnes,
      enAttente: lignes.filter((l) => l.etat === "a_faire" || l.etat === "en_cours").length,
      echecs: lignes.filter((l) => l.etat === "echec").length,
      carnet: carnet.map((l) => {
        const extra = (lecons ?? []).find((x) => x.id === l.id);
        return {
          id: l.id,
          texte: l.texte,
          point: l.point,
          sens: l.sens,
          nbAppuis: extra?.nb_appuis ?? l.appuis.length,
          statut: l.statut,
          origine: l.origine,
          note: extra?.note ?? null,
          creeeLe: extra?.creee_le ?? "",
        };
      }),
      synthese: contenu && synthese ? { ...contenu, faiteLe: synthese.faite_le, nbAppels: synthese.nb_appels } : null,
      portrait: chiffresPortrait(entrees),
      coutDuMoisDollars: cout,
      aVerifier,
    });
  }
  return sortie;
}

export type VuePersonne = {
  organizationId: string;
  client: string;
  nom: string;
  parTitulaire: boolean;
  appels: AppelAnalyse[];
  comparaison: ReturnType<typeof comparaison>;
  nbAppelsEquipe: number;
};

/** Une closeuse (ou la titulaire, `personne = "titulaire"`) vue par Louis. */
export async function getVuePersonne(organizationId: string, personne: string): Promise<VuePersonne | null> {
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("name, slug").eq("id", organizationId).maybeSingle();
  const profil = profilDuClient(org?.slug);
  if (!org || !profil) return null;

  const parTitulaire = personne === "titulaire";
  let nom = profil.titulaire;
  if (!parTitulaire) {
    const { data: c } = await admin
      .from("radar_closeuses")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", personne)
      .maybeSingle();
    if (!c) return null;
    const { data: p } = await admin.from("profiles").select("full_name, email").eq("id", personne).maybeSingle();
    nom = p?.full_name || p?.email || "Closeuse";
  }

  const siennesReq = admin.from("radar_analyses").select(COLONNES).eq("organization_id", organizationId);
  const { data: siennes } = await (parTitulaire ? siennesReq.is("closeuse_id", null) : siennesReq.eq("closeuse_id", personne));
  let equipeReq = admin
    .from("radar_analyses")
    .select("lecture")
    .eq("organization_id", organizationId)
    .eq("etat", "faite")
    .not("closeuse_id", "is", null);
  if (!parTitulaire) equipeReq = equipeReq.neq("closeuse_id", personne);
  const { data: equipe } = await equipeReq;

  const appels = await versAppels(siennes ?? []);
  const analysesEquipe = (equipe ?? []).map((l) => lireRangee(l.lecture)).filter((a): a is AnalyseRangee => a !== null);
  return {
    organizationId,
    client: org.name,
    nom,
    parTitulaire,
    appels,
    comparaison: comparaison(
      appels.map((a) => a.analyse).filter((a): a is AnalyseRangee => a !== null),
      analysesEquipe,
    ),
    nbAppelsEquipe: analysesEquipe.length,
  };
}

export type VueAppel = {
  appel: AppelAnalyse;
  organizationId: string;
  menePar: string;
  titulaire: string;
  fiche: Fiche | null;
  passages: PassageVu[];
  corrections: LeconVue[];
  /** Les étiquettes des alertes « à vérifier » déjà tranchées par Louis. */
  tranchees: string[];
  modele: string | null;
  coutDollars: number;
};

export async function getVueAppel(bookingId: string): Promise<VueAppel | null> {
  const admin = createAdminClient();
  const { data: ligne } = await admin
    .from("radar_analyses")
    .select(`${COLONNES}, organization_id, modele, usage`)
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (!ligne) return null;
  const [appel] = await versAppels([ligne]);

  const [{ data: fiche }, { data: passages }, { data: corrections }, { data: org }, { data: closeuse }] = await Promise.all([
    admin.from("radar_analyse_fiches").select("fiche").eq("booking_id", bookingId).maybeSingle(),
    admin
      .from("radar_analyse_passages")
      .select("id, moment, texte, pourquoi, par_titulaire, vente")
      .eq("booking_id", bookingId),
    admin
      .from("radar_analyse_lecons")
      .select("id, texte, point, sens, nb_appuis, statut, origine, note, creee_le")
      .eq("booking_id", bookingId)
      .order("creee_le"),
    admin.from("organizations").select("slug").eq("id", ligne.organization_id).maybeSingle(),
    ligne.closeuse_id
      ? admin.from("profiles").select("full_name").eq("id", ligne.closeuse_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    appel,
    organizationId: ligne.organization_id,
    menePar: ligne.closeuse_id ? (closeuse?.full_name ?? "Closeuse") : (profilDuClient(org?.slug)?.titulaire ?? "La titulaire"),
    titulaire: profilDuClient(org?.slug)?.titulaire ?? "La titulaire",
    fiche: lireFiche(fiche?.fiche),
    passages: (passages ?? []).map((p) => ({
      id: p.id,
      moment: p.moment,
      texte: p.texte,
      pourquoi: p.pourquoi,
      parTitulaire: p.par_titulaire,
      vente: p.vente,
    })),
    corrections: (corrections ?? []).map((l) => ({
      id: l.id,
      texte: l.texte,
      point: l.point,
      sens: l.sens as LeconVue["sens"],
      nbAppuis: l.nb_appuis,
      statut: l.statut as LeconVue["statut"],
      origine: l.origine as LeconVue["origine"],
      note: l.note,
      creeeLe: l.creee_le,
    })),
    tranchees: (corrections ?? []).map((l) => l.note ?? "").filter((n) => n.startsWith("alerte ")),
    modele: ligne.modele,
    coutDollars: coutDollars(ligne.usage),
  };
}
