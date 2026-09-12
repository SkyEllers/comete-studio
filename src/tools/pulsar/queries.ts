import "server-only";

import { cache } from "react";

import {
  ajouterJours,
  bornesParis,
  jourParis,
  lundiDeLaSemaine,
} from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import type { ClientPulsar, Entree } from "./types";

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
  async (organizationId: string): Promise<ClientPulsar[]> => {
    const supabase = await createClient();

    const { data } = await supabase
      .from("pulsar_clients")
      .select("id, name, is_internal, statut")
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
