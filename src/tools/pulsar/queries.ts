import "server-only";

import { cache } from "react";

import {
  ajouterJours,
  bornesParis,
  jourParis,
  lundiDeLaSemaine,
} from "@/lib/dates";
import { moisSuivant } from "@/lib/mois";
import { createClient } from "@/lib/supabase/server";

import type { Entree, FicheClient } from "./types";

/**
 * Ce que Pulsar lit, toujours à travers la RLS de l'utilisateur courant.
 *
 * Aucune de ces lectures ne filtre sur l'organisation par politesse : elles le
 * font parce que la même session peut porter plusieurs espaces. La frontière,
 * elle, est tenue par `can_access_temps` dans la base — ce filtre-ci ne fait
 * que poser la bonne question.
 *
 * Mémoïsées par requête : l'en-tête de l'outil et la page qu'il enveloppe
 * posent les mêmes questions, et sans ça chaque rendu partirait en double.
 */

const COLONNES_ENTREE =
  "id, client_id, task, phase, started_at, ended_at, duration_minutes, note, is_manual";

/**
 * Tous les clients du carnet, terminés compris.
 *
 * Les terminés sont ici parce que leurs heures restent affichées : une entrée
 * de la semaine dernière porte son nom, même si le client a été archivé
 * depuis. Ce sont les écrans qui écartent les archivés des puces, avec
 * `clientsActifs`, pas cette requête.
 */
export const getClients = cache(
  async (organizationId: string): Promise<FicheClient[]> => {
    const supabase = await createClient();

    const { data } = await supabase
      .from("pulsar_clients")
      .select(
        "id, name, is_internal, statut, profil, modele, montant_cents, date_debut, fin_engagement",
      )
      .eq("organization_id", organizationId)
      .order("name");

    return data ?? [];
  },
);

/**
 * Le chronomètre en marche, s'il y en a un.
 *
 * Sans borne de date, contrairement à tout le reste : un chronomètre oublié
 * jeudi soir doit se retrouver vendredi matin, et c'est même le seul moment
 * où l'on a vraiment besoin de le voir.
 *
 * Le filtre porte sur l'auteur autant que sur l'organisation. L'index unique
 * de la base est posé sur la personne seule, si bien que la question « qu'est-
 * ce qui tourne ? » n'a qu'une réponse — mais la poser sans dire qui l'on est
 * ferait apparaître, le jour où Louis ne serait plus seul, le chronomètre d'un
 * autre dans son en-tête.
 */
export const getEnCours = cache(
  async (organizationId: string, userId: string): Promise<Entree | null> => {
    const supabase = await createClient();

    const { data } = await supabase
      .from("pulsar_entries")
      .select(COLONNES_ENTREE)
      .eq("organization_id", organizationId)
      .eq("created_by", userId)
      .is("ended_at", null)
      .maybeSingle();

    return data;
  },
);

/**
 * Les entrées depuis le lundi de la semaine en cours, à Paris.
 *
 * La page en tire la journée et la semaine, et les puces de client leur ordre
 * de dernière utilisation. Une seule requête pour trois usages : la fenêtre
 * est courte, et tout le découpage se fait ensuite sur des chaînes de jours,
 * où plus aucun fuseau n'intervient.
 *
 * Le chronomètre en marche y figure s'il a démarré cette semaine ; sa durée
 * est nulle et les totaux l'ignorent.
 */
export const getSemaine = cache(
  async (organizationId: string): Promise<Entree[]> => {
    const supabase = await createClient();
    const lundi = lundiDeLaSemaine(jourParis());

    const { data } = await supabase
      .from("pulsar_entries")
      .select(COLONNES_ENTREE)
      .eq("organization_id", organizationId)
      .gte("started_at", bornesParis(lundi, lundi).debut)
      .order("started_at", { ascending: false })
      .limit(500);

    return data ?? [];
  },
);

/**
 * Les entrées d'un mois civil parisien.
 *
 * Le mois arrive sous la forme « 2026-09-01 » et se referme sur le dernier
 * jour du mois, 23 h 59 : une entrée du 1er à 00 h 30 et une du 30 à 23 h 30
 * appartiennent toutes deux à septembre, ce qu'un calcul en UTC dirait
 * autrement deux fois par mois.
 */
export const getEntreesDuMois = cache(
  async (organizationId: string, mois: string): Promise<Entree[]> => {
    const supabase = await createClient();
    const dernierJour = ajouterJours(moisSuivant(mois), -1);
    const { debut, fin } = bornesParis(mois, dernierJour);

    const { data } = await supabase
      .from("pulsar_entries")
      .select(COLONNES_ENTREE)
      .eq("organization_id", organizationId)
      .gte("started_at", debut)
      .lte("started_at", fin)
      .order("started_at", { ascending: false })
      .limit(2000);

    return data ?? [];
  },
);

/**
 * Les heures comptées par client, depuis toujours.
 *
 * Le cumul ne se déduit pas du mois affiché : il faut tout relire. On ne
 * rapatrie donc que ce qui sert à additionner — un client, des minutes — et
 * jamais les notes ni les horodatages, qui feraient dix fois le poids pour
 * rien.
 *
 * Le plafond tient plusieurs années d'un carnet tenu tous les jours. S'il
 * devait être atteint, ce serait à une vue SQL de faire la somme, pas au
 * navigateur ; d'ici là, une requête et une addition valent mieux qu'un
 * agrégat à maintenir.
 */
export const getHeuresCumulees = cache(
  async (organizationId: string): Promise<Map<string, number>> => {
    const supabase = await createClient();

    const { data } = await supabase
      .from("pulsar_entries")
      .select("client_id, duration_minutes")
      .eq("organization_id", organizationId)
      .not("duration_minutes", "is", null)
      .limit(20000);

    const total = new Map<string, number>();
    for (const ligne of data ?? []) {
      total.set(
        ligne.client_id,
        (total.get(ligne.client_id) ?? 0) + (ligne.duration_minutes ?? 0),
      );
    }

    return total;
  },
);

/**
 * Les mois qui portent des heures, pour les puces.
 *
 * Même principe que Radar : on ne propose pas une liste figée de douze mois,
 * on propose ceux qui existent — plus le mois en cours, toujours, pour qu'un
 * carnet vide ait quand même une puce.
 */
export const getMoisConnus = cache(
  async (organizationId: string): Promise<string[]> => {
    const supabase = await createClient();

    const { data } = await supabase
      .from("pulsar_entries")
      .select("started_at")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: true })
      .limit(1);

    const premier = data?.[0]?.started_at;
    return premier ? [`${jourParis(premier).slice(0, 7)}-01`] : [];
  },
);

/** Les deux seuils d'alerte. Absents, ce sont ceux de la migration. */
export const getReglages = cache(
  async (
    organizationId: string,
  ): Promise<{ taux_alerte_cents: number; heures_pilotage_alerte: number }> => {
    const supabase = await createClient();

    const { data } = await supabase
      .from("pulsar_settings")
      .select("taux_alerte_cents, heures_pilotage_alerte")
      .eq("organization_id", organizationId)
      .maybeSingle();

    return data ?? { taux_alerte_cents: 4000, heures_pilotage_alerte: 10 };
  },
);

/**
 * Les quatre dernières semaines, pour l'ordre des puces.
 *
 * La semaine seule suffirait un jeudi et mentirait un lundi matin, où elle ne
 * contient rien : les clients tomberaient alors dans l'ordre alphabétique, et
 * le premier tap deviendrait une lecture.
 */
export const getRecence = cache(
  async (
    organizationId: string,
  ): Promise<{ client_id: string; started_at: string }[]> => {
    const supabase = await createClient();
    const depuis = ajouterJours(jourParis(), -28);

    const { data } = await supabase
      .from("pulsar_entries")
      .select("client_id, started_at")
      .eq("organization_id", organizationId)
      .gte("started_at", bornesParis(depuis, depuis).debut)
      .order("started_at", { ascending: false })
      .limit(300);

    return data ?? [];
  },
);
