import { ajouterJours, instantLocal, jourLocal } from "../agent/temps.ts";

import { ordonner, type Candidate } from "./choix.ts";
import {
  calculerCreneaux,
  personnesLibresA,
  type Absence,
  type Intervalle,
  type PersonneDispo,
  type Plage,
  type Regles,
  type Resultat,
} from "./creneaux.ts";

/**
 * Le moteur : il lit ce qu'il faut (base, agendas), calcule, et réserve.
 *
 * Il ne connaît ni Supabase ni Google : le dépôt et les agendas arrivent en
 * paramètres. Les tests lui passent des doublures, le serveur les vrais.
 */

export type ReglagesLus = Regles & {
  actif: boolean;
  seuilDebutante: number;
  periodeTauxJours: number;
};

export type PersonneLue = {
  id: string;
  userId: string;
  role: "closeuse" | "titulaire";
  fuseau: string;
  maxParJour: number;
  plages: Plage[];
  absences: Absence[];
  /** Sans agenda Google connecté, pas de créneau : on ne pourrait ni lire son occupé ni écrire le rendez-vous. */
  agendaConnecte: boolean;
  /** L'agenda « Diagnostics » où s'écrivent ses rendez-vous. */
  googleAgenda: string;
};

export type Diagnostic = { id: string; personneId: string; debut: number; fin: number };

export type StatsRadar = { honoresTotal: number; honoresPeriode: number; ventesPeriode: number };

export type DonneesReservation = {
  origine: "page" | "agent" | "admin" | "essai";
  prenom: string;
  nom?: string | null;
  email: string;
  telephone?: string | null;
  fuseauCliente: string;
  reponses: { question: string; reponse: string }[];
  utm: Record<string, string>;
  /** Le premier rendez-vous d'un devis n'a pas de lien personnel : il se gère par le lien du devis. */
  jetonHash: string | null;
  /** « premier » : le premier rendez-vous avec la titulaire, après un devis payé (0055). Diagnostic sinon. */
  genre?: "diagnostic" | "premier";
  devisId?: string;
  /** Sa durée à lui ; sans elle, celle des réglages du client. */
  dureeMinutes?: number;
};

export type Echec = "deja_pris" | "maximum" | "indisponible" | "passe" | "introuvable" | "erreur";

export type Prise = { ok: true; id: string } | { ok: false; raison: Echec; message?: string };

export type Depot = {
  reglages(org: string): Promise<ReglagesLus | null>;
  /**
   * Les personnes actives du client. `titulaireInactive` : la titulaire en plus,
   * même passée inactive (elle ne prend plus de diagnostics mais reçoit les
   * premiers rendez-vous après un devis, Louis, 07/10/2026).
   */
  personnes(org: string, o?: { titulaireInactive?: boolean }): Promise<PersonneLue[]>;
  /** Les rendez-vous confirmés qui touchent cette période. */
  diagnostics(org: string, de: number, a: number): Promise<Diagnostic[]>;
  /** Un rendez-vous confirmé de ce client, ou null. */
  rendezVous(org: string, id: string): Promise<Diagnostic | null>;
  /** Par utilisateur : ses rendez-vous honorés et ses ventes, lus dans Radar. */
  stats(org: string, userIds: string[], depuis: number): Promise<Map<string, StatsRadar>>;
  /** Par personne : le dernier rendez-vous que l'outil lui a donné. */
  dernieresAttributions(org: string): Promise<Map<string, number>>;
  prendre(personneId: string, debut: string, donnees: DonneesReservation): Promise<Prise>;
  reporter(ancienId: string, personneId: string, debut: string, par: Auteur): Promise<Prise>;
};

export type Auteur = "cliente" | "agent" | "personne" | "admin";

export type Agendas = {
  occupe(personne: PersonneLue, de: number, a: number): Promise<Intervalle[]>;
};

export type Ecartee = { personneId: string; raison: "sans_agenda" | "agenda_illisible" };

export type Disponibilites =
  | { etat: "ferme" }
  | (Resultat & { ecartees: Ecartee[] });

const JOUR = 86_400_000;

/**
 * Pour qui on cherche (0055). Par défaut, un diagnostic : toutes les
 * personnes, la durée du client. Le premier rendez-vous après un devis :
 * la titulaire seule, sa durée à lui (30 min, 15 pour un bilan microbiote).
 */
export type Options = {
  ignorerActif?: boolean;
  titulaireSeule?: boolean;
  dureeMinutes?: number;
};

type Etat = {
  regles: ReglagesLus;
  personnes: PersonneLue[];
  dispos: PersonneDispo[];
  diagnostics: Diagnostic[];
  ecartees: Ecartee[];
};

/** Tout ce que le calcul demande, lu une fois. */
async function lire(
  org: string,
  maintenant: number,
  depot: Depot,
  agendas: Agendas,
  options: Options & { sauf?: string } = {},
): Promise<Etat | null> {
  const lus = await depot.reglages(org);
  if (!lus || (!lus.actif && !options.ignorerActif)) return null;
  const regles = options.dureeMinutes ? { ...lus, dureeMinutes: options.dureeMinutes } : lus;

  const ecartees: Ecartee[] = [];
  const toutes = (await depot.personnes(org, { titulaireInactive: options.titulaireSeule })).filter(
    (p) => !options.titulaireSeule || p.role === "titulaire",
  );
  const personnes = toutes.filter((p) => {
    if (!p.agendaConnecte) ecartees.push({ personneId: p.id, raison: "sans_agenda" });
    return p.agendaConnecte;
  });

  const aujourdhui = jourLocal(maintenant, regles.fuseau);
  const de = maintenant - JOUR;
  const a = instantLocal(ajouterJours(aujourdhui, regles.fenetreMaxJours + 2), 0, 0, regles.fuseau);

  const diagnostics = (await depot.diagnostics(org, de, a)).filter((d) => d.id !== options.sauf);

  const lues = await Promise.all(
    personnes.map(async (p) => {
      try {
        return { p, occupe: await agendas.occupe(p, de, a) };
      } catch {
        // Un agenda qu'on ne lit pas, c'est un risque de double rendez-vous
        // avec sa vie perso : on ne propose rien chez elle.
        ecartees.push({ personneId: p.id, raison: "agenda_illisible" });
        return null;
      }
    }),
  );

  const retenues = lues.filter((x): x is { p: PersonneLue; occupe: Intervalle[] } => x !== null);

  return {
    regles,
    personnes: retenues.map((x) => x.p),
    diagnostics,
    ecartees,
    dispos: retenues.map(({ p, occupe }) => ({
      id: p.id,
      fuseau: p.fuseau,
      maxParJour: p.maxParJour,
      plages: p.plages,
      absences: p.absences,
      occupe,
      diagnostics: diagnostics
        .filter((d) => d.personneId === p.id)
        .map((d) => ({ debut: d.debut, fin: d.fin })),
    })),
  };
}

/** Les créneaux à montrer sur la page, ou « complet », ou « fermé ». */
export async function creneauxLibres(
  org: string,
  maintenant: number,
  depot: Depot,
  agendas: Agendas,
  options: Options = {},
): Promise<Disponibilites> {
  const etat = await lire(org, maintenant, depot, agendas, options);
  if (!etat) return { etat: "ferme" };
  return { ...calculerCreneaux(etat.dispos, etat.regles, maintenant), ecartees: etat.ecartees };
}

/** Les personnes libres à ce créneau, de la première servie à la dernière. */
async function candidatesOrdonnees(
  org: string,
  etat: Etat,
  libres: string[],
  maintenant: number,
  depot: Depot,
): Promise<Candidate[]> {
  const retenues = etat.personnes.filter((p) => libres.includes(p.id));
  const closeuses = retenues.filter((p) => p.role === "closeuse").map((p) => p.userId);
  const depuis = maintenant - etat.regles.periodeTauxJours * JOUR;

  const [stats, dernieres] = await Promise.all([
    closeuses.length > 0 ? depot.stats(org, closeuses, depuis) : Promise.resolve(new Map<string, StatsRadar>()),
    depot.dernieresAttributions(org),
  ]);

  return ordonner(
    retenues.map((p) => {
      const s = stats.get(p.userId);
      return {
        id: p.id,
        role: p.role,
        honoresTotal: s?.honoresTotal ?? 0,
        honoresPeriode: s?.honoresPeriode ?? 0,
        ventesPeriode: s?.ventesPeriode ?? 0,
        derniereAttribution: dernieres.get(p.id) ?? null,
      };
    }),
    etat.regles.seuilDebutante,
  );
}

export type Reservation =
  | { ok: true; id: string; personneId: string }
  | { ok: false; raison: "ferme" | "plus_libre" | "erreur"; message?: string };

/**
 * Réserver le créneau qui commence à `debut` (ISO). Le créneau est recalculé
 * maintenant, agendas compris : ce que la page a montré il y a cinq minutes
 * ne fait pas foi. La base a le dernier mot (chevauchement, maximum) : si
 * elle refuse la première personne, on essaie la suivante.
 */
export async function reserver(
  org: string,
  debut: string,
  donnees: DonneesReservation,
  maintenant: number,
  depot: Depot,
  agendas: Agendas,
  options: Options = {},
): Promise<Reservation> {
  const etat = await lire(org, maintenant, depot, agendas, options);
  if (!etat) return { ok: false, raison: "ferme" };

  const instant = Date.parse(debut);
  if (Number.isNaN(instant)) return { ok: false, raison: "plus_libre" };

  const libres = personnesLibresA(etat.dispos, etat.regles, maintenant, instant);
  if (libres.length === 0) return { ok: false, raison: "plus_libre" };

  const ordre = await candidatesOrdonnees(org, etat, libres, maintenant, depot);
  const iso = new Date(instant).toISOString();

  for (const c of ordre) {
    const prise = await depot.prendre(c.id, iso, donnees);
    if (prise.ok) return { ok: true, id: prise.id, personneId: c.id };
    if (prise.raison === "deja_pris" || prise.raison === "maximum" || prise.raison === "indisponible") continue;
    return { ok: false, raison: "erreur", message: prise.message };
  }

  return { ok: false, raison: "plus_libre" };
}

/**
 * Reporter un rendez-vous confirmé à `debut`. On garde la même personne si
 * elle est libre (elle a les réponses sous les yeux) ; sinon, l'ordre
 * habituel. L'ancien rendez-vous ne compte pas contre le nouveau : déplacer
 * de 15 minutes chez la même personne marche.
 */
export async function reporter(
  org: string,
  ancienId: string,
  debut: string,
  par: Auteur,
  maintenant: number,
  depot: Depot,
  agendas: Agendas,
  options: Options = {},
): Promise<Reservation> {
  const ancien = await depot.rendezVous(org, ancienId);
  if (!ancien) return { ok: false, raison: "erreur", message: "rendez_vous_introuvable" };

  const etat = await lire(org, maintenant, depot, agendas, { ...options, sauf: ancienId });
  if (!etat) return { ok: false, raison: "ferme" };

  const instant = Date.parse(debut);
  if (Number.isNaN(instant)) return { ok: false, raison: "plus_libre" };

  const libres = personnesLibresA(etat.dispos, etat.regles, maintenant, instant);
  if (libres.length === 0) return { ok: false, raison: "plus_libre" };

  const ordre = await candidatesOrdonnees(org, etat, libres, maintenant, depot);
  const memePersonne = ordre.filter((c) => c.id === ancien.personneId);
  const iso = new Date(instant).toISOString();

  for (const c of [...memePersonne, ...ordre.filter((x) => x.id !== ancien.personneId)]) {
    const prise = await depot.reporter(ancienId, c.id, iso, par);
    if (prise.ok) return { ok: true, id: prise.id, personneId: c.id };
    if (prise.raison === "deja_pris" || prise.raison === "maximum" || prise.raison === "indisponible") continue;
    return { ok: false, raison: "erreur", message: prise.message };
  }

  return { ok: false, raison: "plus_libre" };
}
