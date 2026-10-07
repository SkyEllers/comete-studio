import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { instantLocal } from "../agent/temps.ts";

import {
  creneauxLibres,
  reporter,
  reserver,
  type Agendas,
  type Depot,
  type Diagnostic,
  type DonneesReservation,
  type PersonneLue,
  type Prise,
  type ReglagesLus,
  type StatsRadar,
} from "./moteur.ts";

const P = "Europe/Paris";
const heure = (jour: string, h: number, m = 0) => instantLocal(jour, h, m, P);
const iso = (t: number) => new Date(t).toISOString();

const LUNDI = "2026-10-05";
const maintenant = heure("2026-10-04", 10);

const reglages: ReglagesLus = {
  actif: true,
  dureeMinutes: 45,
  pauseMinutes: 15,
  pasMinutes: 15,
  preavisMinutes: 120,
  fenetreJours: 4,
  fenetrePasJours: 2,
  fenetreMaxJours: 21,
  fuseau: P,
  seuilDebutante: 10,
  periodeTauxJours: 60,
};

function personne(id: string, role: PersonneLue["role"], sur: Partial<PersonneLue> = {}): PersonneLue {
  return {
    id,
    userId: `u-${id}`,
    role,
    fuseau: P,
    maxParJour: 5,
    plages: [{ jour: 1, debut: "09:00", fin: "12:00" }],
    absences: [],
    agendaConnecte: true,
    googleAgenda: "primary",
    ...sur,
  };
}

const donnees: DonneesReservation = {
  origine: "essai",
  prenom: "Camille",
  email: "camille@example.com",
  fuseauCliente: P,
  reponses: [],
  utm: {},
  jetonHash: "h",
};

/** Une base en mémoire qui applique les mêmes refus que la vraie. */
function faux(options: {
  reglages?: ReglagesLus | null;
  personnes: PersonneLue[];
  diagnostics?: Diagnostic[];
  stats?: Record<string, StatsRadar>;
  dernieres?: Record<string, number>;
  refus?: Record<string, Prise>;
}) {
  const diagnostics = [...(options.diagnostics ?? [])];
  const prises: { personneId: string; debut: string }[] = [];
  let n = 0;

  const prendre = async (personneId: string, debut: string): Promise<Prise> => {
    const refus = options.refus?.[personneId];
    if (refus) return refus;
    const t = Date.parse(debut);
    const conflit = diagnostics.some(
      (d) => d.personneId === personneId && t < d.fin + 15 * 60_000 && t + 60 * 60_000 > d.debut,
    );
    if (conflit) return { ok: false, raison: "deja_pris" };
    const id = `rdv-${++n}`;
    diagnostics.push({ id, personneId, debut: t, fin: t + 45 * 60_000 });
    prises.push({ personneId, debut });
    return { ok: true, id };
  };

  const depot: Depot = {
    reglages: async () => (options.reglages === undefined ? reglages : options.reglages),
    personnes: async () => options.personnes,
    diagnostics: async () => [...diagnostics],
    rendezVous: async (_org, id) => diagnostics.find((d) => d.id === id) ?? null,
    stats: async (_org, userIds) =>
      new Map(userIds.filter((u) => options.stats?.[u]).map((u) => [u, options.stats![u]])),
    dernieresAttributions: async () => new Map(Object.entries(options.dernieres ?? {})),
    prendre: (personneId, debut) => prendre(personneId, debut),
    reporter: async (ancienId, personneId, debut) => {
      const i = diagnostics.findIndex((d) => d.id === ancienId);
      const [ancien] = diagnostics.splice(i, 1);
      const prise = await prendre(personneId, debut);
      if (!prise.ok) diagnostics.push(ancien);
      return prise;
    },
  };

  return { depot, prises, diagnostics };
}

const libres: Agendas = { occupe: async () => [] };

describe("le moteur : les créneaux", () => {
  it("fermé tant que la réservation n'est pas active, sauf à la forcer", async () => {
    const { depot } = faux({ reglages: { ...reglages, actif: false }, personnes: [personne("peggy", "titulaire")] });
    assert.deepEqual(await creneauxLibres("org", maintenant, depot, libres), { etat: "ferme" });
    const force = await creneauxLibres("org", maintenant, depot, libres, { ignorerActif: true });
    assert.equal(force.etat, "ouvert");
  });

  it("fermé sans réglages", async () => {
    const { depot } = faux({ reglages: null, personnes: [] });
    assert.deepEqual(await creneauxLibres("org", maintenant, depot, libres), { etat: "ferme" });
  });

  it("sans agenda Google connecté, une personne ne propose rien, et on le dit", async () => {
    const { depot } = faux({
      personnes: [personne("peggy", "titulaire"), personne("c", "closeuse", { agendaConnecte: false, plages: [{ jour: 2, debut: "09:00", fin: "12:00" }] })],
    });
    const r = await creneauxLibres("org", maintenant, depot, libres);
    if (r.etat !== "ouvert") return assert.fail(r.etat);
    assert.ok(r.creneaux.every((x) => x.personnes.join() === "peggy"));
    assert.deepEqual(r.ecartees, [{ personneId: "c", raison: "sans_agenda" }]);
  });

  it("un agenda illisible écarte sa personne plutôt que risquer un doublon", async () => {
    const { depot } = faux({ personnes: [personne("peggy", "titulaire"), personne("c", "closeuse")] });
    const agendas: Agendas = {
      occupe: async (p) => {
        if (p.id === "c") throw new Error("Google ne répond pas");
        return [];
      },
    };
    const r = await creneauxLibres("org", maintenant, depot, agendas);
    if (r.etat === "ferme") return assert.fail("fermé");
    assert.ok(r.creneaux.every((x) => x.personnes.join() === "peggy"));
    assert.deepEqual(r.ecartees, [{ personneId: "c", raison: "agenda_illisible" }]);
  });

  it("l'occupé de Google et les diagnostics déjà pris se retirent", async () => {
    const { depot } = faux({
      personnes: [personne("peggy", "titulaire")],
      diagnostics: [{ id: "x", personneId: "peggy", debut: heure(LUNDI, 11), fin: heure(LUNDI, 11, 45) }],
    });
    const agendas: Agendas = { occupe: async () => [{ debut: heure(LUNDI, 9), fin: heure(LUNDI, 10) }] };
    const r = await creneauxLibres("org", maintenant, depot, agendas);
    if (r.etat === "ferme") return assert.fail("fermé");
    assert.deepEqual(r.creneaux.map((x) => x.debut), [iso(heure(LUNDI, 10))]);
  });
});

describe("le moteur : réserver", () => {
  it("donne le créneau à la débutante avant la closeuse confirmée et avant Peggy", async () => {
    const { depot, prises } = faux({
      personnes: [personne("peggy", "titulaire"), personne("c", "closeuse"), personne("d", "closeuse")],
      stats: {
        "u-c": { honoresTotal: 40, honoresPeriode: 10, ventesPeriode: 5 },
        "u-d": { honoresTotal: 2, honoresPeriode: 2, ventesPeriode: 0 },
      },
    });
    const r = await reserver("org", iso(heure(LUNDI, 9)), donnees, maintenant, depot, libres);
    assert.deepEqual(r, { ok: true, id: "rdv-1", personneId: "d" });
    assert.equal(prises.length, 1);
  });

  it("si la base refuse la première, la suivante prend", async () => {
    const { depot } = faux({
      personnes: [personne("peggy", "titulaire"), personne("c", "closeuse")],
      stats: { "u-c": { honoresTotal: 40, honoresPeriode: 10, ventesPeriode: 5 } },
      refus: { c: { ok: false, raison: "maximum" } },
    });
    const r = await reserver("org", iso(heure(LUNDI, 9)), donnees, maintenant, depot, libres);
    assert.deepEqual(r, { ok: true, id: "rdv-1", personneId: "peggy" });
  });

  it("deux réservations sur le même créneau : la seconde va à la suivante, puis plus rien", async () => {
    const { depot } = faux({ personnes: [personne("peggy", "titulaire"), personne("c", "closeuse")] });
    const creneau = iso(heure(LUNDI, 9));
    const [a, b] = await Promise.all([
      reserver("org", creneau, donnees, maintenant, depot, libres),
      reserver("org", creneau, donnees, maintenant, depot, libres),
    ]);
    assert.ok(a.ok && b.ok);
    assert.deepEqual([a.personneId, b.personneId].sort(), ["c", "peggy"]);
    const c = await reserver("org", creneau, donnees, maintenant, depot, libres);
    assert.deepEqual(c, { ok: false, raison: "plus_libre" });
  });

  it("un créneau qui n'est plus libre est refusé sans rien écrire", async () => {
    const { depot, prises } = faux({ personnes: [personne("peggy", "titulaire")] });
    const agendas: Agendas = { occupe: async () => [{ debut: heure(LUNDI, 9), fin: heure(LUNDI, 10) }] };
    const r = await reserver("org", iso(heure(LUNDI, 9)), donnees, maintenant, depot, agendas);
    assert.deepEqual(r, { ok: false, raison: "plus_libre" });
    assert.equal(prises.length, 0);
  });

  it("une erreur inattendue de la base remonte telle quelle", async () => {
    const { depot } = faux({
      personnes: [personne("peggy", "titulaire")],
      refus: { peggy: { ok: false, raison: "erreur", message: "panne" } },
    });
    const r = await reserver("org", iso(heure(LUNDI, 9)), donnees, maintenant, depot, libres);
    assert.deepEqual(r, { ok: false, raison: "erreur", message: "panne" });
  });

  it("une adresse de créneau illisible est refusée", async () => {
    const { depot } = faux({ personnes: [personne("peggy", "titulaire")] });
    const r = await reserver("org", "demain", donnees, maintenant, depot, libres);
    assert.deepEqual(r, { ok: false, raison: "plus_libre" });
  });
});

describe("le moteur : reporter", () => {
  it("garde la même personne quand elle est libre, même à 15 minutes de l'ancien", async () => {
    const { depot } = faux({
      personnes: [personne("peggy", "titulaire"), personne("d", "closeuse")],
      diagnostics: [{ id: "old", personneId: "peggy", debut: heure(LUNDI, 9), fin: heure(LUNDI, 9, 45) }],
    });
    const r = await reporter("org", "old", iso(heure(LUNDI, 9, 15)), "agent", maintenant, depot, libres);
    assert.deepEqual(r, { ok: true, id: "rdv-1", personneId: "peggy" });
  });

  it("passe à l'ordre habituel quand la même personne n'est pas libre", async () => {
    const { depot } = faux({
      personnes: [
        personne("peggy", "titulaire"),
        personne("c", "closeuse", { plages: [{ jour: 1, debut: "09:00", fin: "10:00" }] }),
        personne("d", "closeuse"),
      ],
      diagnostics: [{ id: "old", personneId: "c", debut: heure(LUNDI, 9), fin: heure(LUNDI, 9, 45) }],
    });
    const r = await reporter("org", "old", iso(heure(LUNDI, 11)), "cliente", maintenant, depot, libres);
    assert.ok(r.ok);
    assert.equal(r.personneId, "d");
  });

  it("un rendez-vous inconnu ne se reporte pas", async () => {
    const { depot } = faux({ personnes: [personne("peggy", "titulaire")] });
    const r = await reporter("org", "nope", iso(heure(LUNDI, 9)), "agent", maintenant, depot, libres);
    assert.deepEqual(r, { ok: false, raison: "erreur", message: "rendez_vous_introuvable" });
  });
});

describe("le moteur : le premier rendez-vous après un devis (0055)", () => {
  const premier = { titulaireSeule: true, dureeMinutes: 30 };

  it("chez la titulaire seule, même quand une closeuse est libre", async () => {
    const { depot, prises } = faux({ personnes: [personne("peggy", "titulaire"), personne("c", "closeuse")] });
    const r = await creneauxLibres("org", maintenant, depot, libres, premier);
    if (r.etat !== "ouvert") return assert.fail(r.etat);
    assert.ok(r.creneaux.every((x) => x.personnes.join() === "peggy"));
    const prise = await reserver("org", iso(heure(LUNDI, 9)), donnees, maintenant, depot, libres, premier);
    assert.deepEqual(prise, { ok: true, id: "rdv-1", personneId: "peggy" });
    assert.equal(prises[0].personneId, "peggy");
  });

  it("dure 30 minutes : le dernier créneau d'une plage 9h-12h commence à 11h30", async () => {
    const { depot } = faux({ personnes: [personne("peggy", "titulaire")] });
    const r = await creneauxLibres("org", maintenant, depot, libres, premier);
    if (r.etat !== "ouvert") return assert.fail(r.etat);
    const lundi = r.creneaux.filter((x) => x.debut.startsWith("2026-10-05"));
    assert.equal(lundi.at(-1)?.debut, iso(heure(LUNDI, 11, 30)));
    assert.equal(Date.parse(lundi[0].fin) - Date.parse(lundi[0].debut), 30 * 60_000);
  });

  it("sans titulaire disponible, rien, même si une closeuse l'est", async () => {
    const { depot } = faux({
      personnes: [personne("peggy", "titulaire", { agendaConnecte: false }), personne("c", "closeuse")],
    });
    const r = await creneauxLibres("org", maintenant, depot, libres, premier);
    assert.equal(r.etat, "complet");
    const prise = await reserver("org", iso(heure(LUNDI, 9)), donnees, maintenant, depot, libres, premier);
    assert.deepEqual(prise, { ok: false, raison: "plus_libre" });
  });

  it("ses diagnostics déjà pris lui bloquent le créneau, pause comprise", async () => {
    const { depot } = faux({
      personnes: [personne("peggy", "titulaire")],
      diagnostics: [{ id: "x", personneId: "peggy", debut: heure(LUNDI, 9), fin: heure(LUNDI, 9, 45) }],
    });
    const r = await creneauxLibres("org", maintenant, depot, libres, premier);
    if (r.etat !== "ouvert") return assert.fail(r.etat);
    const lundi = r.creneaux.filter((x) => x.debut.startsWith("2026-10-05")).map((x) => x.debut);
    assert.equal(lundi[0], iso(heure(LUNDI, 10)));
  });
});
