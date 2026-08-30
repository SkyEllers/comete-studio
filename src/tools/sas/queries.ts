import "server-only";

import { tempsRelatif } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import { grouperParJour, heure, motifRecherche, type Jour } from "./jours";
import type { Boite } from "./types";

/**
 * Ce que Sas lit.
 *
 * Tout passe par la session, jamais par la clé secrète : c'est la RLS qui
 * décide, et `can_access_sas` rend tout vide dès que l'outil est coupé.
 *
 * Les libellés de date sont fabriqués ici, côté serveur, et voyagent en
 * texte : un « il y a 3 heures » recalculé à l'hydratation diverge de celui
 * du rendu, et React le signale bruyamment.
 */

/** Plafond de sécurité : personne n'a mille boîtes, mais la requête est bornée. */
const PLAFOND_BOITES = 200;

/**
 * Plafond d'une liste. Au-delà, l'écran le dit plutôt que de faire croire
 * qu'il montre tout — c'est la recherche qui sert à retrouver le reste.
 */
const PLAFOND_NOTES = 300;
const PLAFOND_RECHERCHE = 50;

export async function getBoites(organizationId: string): Promise<Boite[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("sas_boxes")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name")
    .limit(PLAFOND_BOITES);

  return data ?? [];
}

// -------------------------------- Les tuiles --------------------------------

export type Compteur = {
  notes: number;
  /** « il y a 3 heures », ou `null` si la place est vide. */
  derniereLabel: string | null;
};

export type BoiteResume = Boite & Compteur;

export type Etageres = {
  boites: BoiteResume[];
  perso: Compteur;
  aRanger: Compteur;
};

/**
 * Les boîtes et leurs compteurs, en deux requêtes : la liste des boîtes, et
 * l'agrégat que `sas_compteurs` calcule dans la base.
 *
 * Une boîte vide reste affichée — c'est un tiroir qu'on a ouvert exprès, et le
 * faire disparaître parce qu'on vient d'en sortir la dernière idée serait
 * déroutant. « À ranger », elle, n'existe que tant qu'elle contient quelque
 * chose : ce n'est pas un tiroir, c'est un reste.
 */
export async function getEtageres(organizationId: string): Promise<Etageres> {
  const supabase = await createClient();

  const [boites, compteurs] = await Promise.all([
    getBoites(organizationId),
    supabase.rpc("sas_compteurs", { org: organizationId }),
  ]);

  const maintenant = new Date();
  const vide: Compteur = { notes: 0, derniereLabel: null };

  const lignes = compteurs.data ?? [];
  const parBoite = new Map<string, Compteur>();
  let perso = vide;
  let aRanger = vide;

  for (const ligne of lignes) {
    const compteur: Compteur = {
      notes: Number(ligne.notes),
      derniereLabel: ligne.derniere ? tempsRelatif(ligne.derniere, maintenant) : null,
    };

    if (ligne.box_id) parBoite.set(ligne.box_id, compteur);
    else if (ligne.realm === "perso") perso = compteur;
    else aRanger = compteur;
  }

  return {
    boites: boites.map((boite) => ({ ...boite, ...(parBoite.get(boite.id) ?? vide) })),
    perso,
    aRanger,
  };
}

// -------------------------------- Les listes --------------------------------

export type NoteSas = {
  id: string;
  content: string;
  realm: "pro" | "perso";
  box_id: string | null;
  captured_at: string;
  is_archived: boolean;
  /** `14:11`, en heure de Paris, calculé au serveur. */
  heureLabel: string;
};

export type Filtre =
  | { type: "boite"; boxId: string }
  | { type: "perso" }
  | { type: "aranger" };

export type Liste = {
  jours: Jour<NoteSas>[];
  archivees: NoteSas[];
  actives: number;
  /** Vrai si la liste a été coupée au plafond : l'écran doit le dire. */
  tronquee: boolean;
};

const COLONNES = "id, content, realm, box_id, captured_at, is_archived";

type LigneBrute = {
  id: string;
  content: string;
  realm: "pro" | "perso";
  box_id: string | null;
  captured_at: string;
  is_archived: boolean;
};

const habiller = (ligne: LigneBrute): NoteSas => ({
  ...ligne,
  heureLabel: heure(ligne.captured_at),
});

/**
 * Les idées d'une place : les actives groupées par jour, les archivées à part.
 *
 * Deux requêtes plutôt qu'une : une seule, plafonnée, laisserait de vieilles
 * archives chasser des idées actives de la liste. Ce sont deux questions
 * différentes, elles méritent deux réponses.
 */
export async function getListe(
  organizationId: string,
  filtre: Filtre,
  maintenant = new Date(),
): Promise<Liste> {
  const supabase = await createClient();

  /** La même question, posée une fois sur les actives, une fois sur les archivées. */
  const requete = (archive: boolean) => {
    const base = supabase
      .from("sas_notes")
      .select(COLONNES)
      .eq("organization_id", organizationId)
      .eq("is_archived", archive)
      .order("captured_at", { ascending: false })
      .limit(PLAFOND_NOTES);

    if (filtre.type === "boite") return base.eq("box_id", filtre.boxId);
    if (filtre.type === "perso") return base.eq("realm", "perso").is("box_id", null);
    return base.eq("realm", "pro").is("box_id", null);
  };

  const [actives, archivees] = await Promise.all([requete(false), requete(true)]);

  const vivantes = (actives.data ?? []).map(habiller);

  return {
    jours: grouperParJour(vivantes, maintenant),
    archivees: (archivees.data ?? []).map(habiller),
    actives: vivantes.length,
    tronquee: vivantes.length === PLAFOND_NOTES,
  };
}

/** Une boîte par son identifiant, ou `null` — la RLS répond pour nous. */
export async function getBoite(
  organizationId: string,
  boxId: string,
): Promise<Boite | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("sas_boxes")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("id", boxId)
    .maybeSingle();

  return data ?? null;
}

// ------------------------------- La recherche -------------------------------

export type Resultat = NoteSas & {
  /** Le nom de la boîte, « Perso » ou « À ranger » : où l'idée se trouve. */
  placeLabel: string;
  /** Où mène le résultat. */
  href: string;
};

/**
 * Cherche partout : les deux univers, toutes les boîtes, les archives
 * comprises — parce qu'on cherche justement ce qu'on ne sait plus où l'on a
 * rangé, et qu'une idée archivée reste une idée qu'on a eue.
 */
export async function rechercher(
  organizationId: string,
  orgSlug: string,
  recherche: string,
): Promise<Resultat[]> {
  const motif = motifRecherche(recherche);
  if (motif === "%%") return [];

  const supabase = await createClient();

  const [notes, boites] = await Promise.all([
    supabase
      .from("sas_notes")
      .select(COLONNES)
      .eq("organization_id", organizationId)
      .ilike("content", motif)
      .order("captured_at", { ascending: false })
      .limit(PLAFOND_RECHERCHE),
    getBoites(organizationId),
  ]);

  const noms = new Map(boites.map((boite) => [boite.id, boite.name]));
  const racine = `/app/${orgSlug}/sas`;

  return (notes.data ?? []).map((ligne) => {
    const note = habiller(ligne);

    if (note.box_id) {
      return {
        ...note,
        placeLabel: noms.get(note.box_id) ?? "Boîte",
        href: `${racine}/boites/${note.box_id}`,
      };
    }

    if (note.realm === "perso") {
      return { ...note, placeLabel: "Perso", href: `${racine}/perso` };
    }

    return { ...note, placeLabel: "À ranger", href: `${racine}/boites/a-ranger` };
  });
}
