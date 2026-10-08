import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { budgetDuQuestionnaire, chiffresPortrait, comparaison, dominant, reponsesPourAnalyse } from "./agregats.ts";
import { CLES_POINTS, resteAvantOuverture, SEUIL_LECON, SEUIL_OUVERTURE } from "./grille.ts";
import { aAnalyser, ATTENTE_SANS_ISSUE_MS, ENTRE_ESSAIS_MS, lireIssue, syntheseDue, type FaitsIssue } from "./issue.ts";
import { leconsPourAnalyse, mouvementsDuCarnet, resoudreAppuis, type Lecon } from "./lecons.ts";
import {
  alertesATrancher,
  alertesSures,
  analyseLue,
  etiquetteAlerte,
  lireRangee,
  pointsComplets,
  SCHEMA_ANALYSE,
  versRangee,
  type Fiche,
} from "./schema.ts";

const faits = (f: Partial<FaitsIssue> = {}): FaitsIssue => ({
  statut: "honore",
  venteCents: null,
  devisSigne: false,
  devisPaye: false,
  r2: null,
  motif: null,
  declinee: false,
  ...f,
});

describe("lireIssue", () => {
  it("lit une vente dans Radar comme dans le devis", () => {
    assert.equal(lireIssue(faits({ venteCents: 185000 })).issue, "vente");
    assert.equal(lireIssue(faits({ devisPaye: true })).issue, "vente");
    assert.equal(lireIssue(faits({ devisSigne: true })).issue, "vente");
  });
  it("lit le R2, et un R2 qui dit non comme un non", () => {
    assert.equal(lireIssue(faits({ r2: { resultat: null } })).issue, "r2");
    assert.equal(lireIssue(faits({ r2: { resultat: "reflechit" } })).issue, "r2");
    assert.equal(lireIssue(faits({ r2: { resultat: "non" } })).issue, "non");
  });
  it("sépare l'attente du refus", () => {
    assert.equal(lireIssue(faits({ motif: "pas_encore" })).issue, "en_attente");
    assert.equal(lireIssue(faits({ motif: "argent" })).issue, "non");
    assert.equal(lireIssue(faits({ declinee: true })).issue, "non");
    assert.equal(lireIssue(faits()).issue, "inconnue");
  });
  it("change de clé quand l'issue change", () => {
    const attente = lireIssue(faits({ motif: "pas_encore" }));
    const vente = lireIssue(faits({ motif: "pas_encore", devisPaye: true }));
    assert.notEqual(attente.cle, vente.cle);
    assert.equal(lireIssue(faits({ motif: "argent" })).cle, lireIssue(faits({ motif: "argent" })).cle);
  });
});

describe("aAnalyser", () => {
  const fin = "2026-10-07T17:45:00Z";
  const maintenant = Date.parse("2026-10-07T18:00:00Z");
  const base = { transcriptionFaite: true, statut: "honore", finRdv: fin, maintenant };

  it("attend la transcription, et ignore absentes et annulés", () => {
    const issue = lireIssue(faits({ venteCents: 1 }));
    assert.equal(aAnalyser({ ...base, transcriptionFaite: false, issue, analyse: null }), false);
    assert.equal(aAnalyser({ ...base, statut: "no_show", issue, analyse: null }), false);
    assert.equal(aAnalyser({ ...base, statut: "annule", issue, analyse: null }), false);
  });
  it("analyse dès que le résultat est noté, sinon deux jours après", () => {
    assert.equal(aAnalyser({ ...base, issue: lireIssue(faits({ motif: "argent" })), analyse: null }), true);
    assert.equal(aAnalyser({ ...base, issue: lireIssue(faits()), analyse: null }), false);
    assert.equal(
      aAnalyser({ ...base, maintenant: Date.parse(fin) + ATTENTE_SANS_ISSUE_MS, issue: lireIssue(faits()), analyse: null }),
      true,
    );
  });
  it("refait l'analyse quand l'issue change, pas sinon", () => {
    const attente = lireIssue(faits({ motif: "pas_encore" }));
    const vente = lireIssue(faits({ motif: "pas_encore", devisPaye: true }));
    const faite = { etat: "faite" as const, issueCle: attente.cle, tentatives: 1, commenceeLe: null, majLe: fin };
    assert.equal(aAnalyser({ ...base, issue: attente, analyse: faite }), false);
    assert.equal(aAnalyser({ ...base, issue: vente, analyse: faite }), true);
  });
  it("retente un échec trois fois, une heure entre chaque", () => {
    const issue = lireIssue(faits({ motif: "argent" }));
    const echec = (tentatives: number, majLe: string) => ({ etat: "echec" as const, issueCle: null, tentatives, commenceeLe: null, majLe });
    assert.equal(aAnalyser({ ...base, issue, analyse: echec(1, "2026-10-07T17:30:00Z") }), false);
    assert.equal(aAnalyser({ ...base, maintenant: Date.parse(fin) + ENTRE_ESSAIS_MS, issue, analyse: echec(1, fin) }), true);
    assert.equal(aAnalyser({ ...base, maintenant: Date.parse(fin) + 10 * ENTRE_ESSAIS_MS, issue, analyse: echec(3, fin) }), false);
  });
  it("refait l'analyse quand l'enregistrement a été remplacé", () => {
    const issue = lireIssue(faits({ motif: "argent" }));
    const faite = { etat: "faite" as const, issueCle: issue.cle, tentatives: 1, commenceeLe: "2026-10-08T16:50:00Z", majLe: "2026-10-08T16:51:00Z" };
    assert.equal(aAnalyser({ ...base, issue, analyse: faite, transcriptionLe: "2026-10-08T17:00:00Z" }), true);
    assert.equal(aAnalyser({ ...base, issue, analyse: faite, transcriptionLe: "2026-10-08T16:40:00Z" }), false);
    const echec = { ...faite, etat: "echec" as const, tentatives: 3 };
    assert.equal(aAnalyser({ ...base, issue, analyse: echec, transcriptionLe: "2026-10-08T17:00:00Z" }), true);
  });

  it("reprend une analyse coupée en cours de route", () => {
    const issue = lireIssue(faits({ motif: "argent" }));
    const enCours = (commenceeLe: string) => ({ etat: "en_cours" as const, issueCle: null, tentatives: 1, commenceeLe, majLe: commenceeLe });
    assert.equal(aAnalyser({ ...base, issue, analyse: enCours("2026-10-07T17:58:00Z") }), false);
    assert.equal(aAnalyser({ ...base, issue, analyse: enCours("2026-10-07T17:30:00Z") }), true);
  });
});

describe("syntheseDue", () => {
  it("la toute première, dès un appel analysé", () => {
    assert.equal(syntheseDue(null, 1, new Date("2026-10-08T10:00:00Z")), true);
    assert.equal(syntheseDue(null, 0, new Date("2026-10-08T10:00:00Z")), false);
  });
  it("puis le lundi après 6h à Paris, une fois", () => {
    const lundi7h = new Date("2026-10-12T05:00:00Z"); // 7h à Paris
    const lundi5h = new Date("2026-10-12T03:00:00Z"); // 5h à Paris
    assert.equal(syntheseDue("2026-10-07T20:00:00Z", 3, lundi7h), true);
    assert.equal(syntheseDue("2026-10-07T20:00:00Z", 3, lundi5h), false);
    assert.equal(syntheseDue("2026-10-12T04:30:00Z", 3, lundi7h), false);
    assert.equal(syntheseDue("2026-10-07T20:00:00Z", 3, new Date("2026-10-13T08:00:00Z")), false);
    assert.equal(syntheseDue("2026-10-07T20:00:00Z", 0, lundi7h), false);
  });
});

describe("l'ouverture", () => {
  it("compte ce qu'il reste avant le dixième rendez-vous tenu", () => {
    assert.equal(SEUIL_OUVERTURE, 10);
    assert.equal(resteAvantOuverture(0), 10);
    assert.equal(resteAvantOuverture(3), 7);
    assert.equal(resteAvantOuverture(10), null);
    assert.equal(resteAvantOuverture(14), null);
  });
});

const lecon = (l: Partial<Lecon> & { id: string }): Lecon => ({
  texte: "Une leçon",
  point: "reformulation",
  sens: "vend",
  appuis: [],
  statut: "proposee",
  origine: "synthese",
  ...l,
});

describe("le carnet", () => {
  const parCode = new Map(Array.from({ length: 12 }, (_, i) => [`R${i + 1}`, `id-${i + 1}`]));

  it("ne compte que les codes connus, une fois chacun", () => {
    assert.deepEqual(resoudreAppuis(["R1", "r1", " R2 ", "R99", "X"], parCode), ["id-1", "id-2"]);
  });

  it("une leçon nouvelle entre seule à dix appuis, attend Louis en dessous, disparaît sans appui", () => {
    const codes = (n: number) => Array.from({ length: n }, (_, i) => `R${i + 1}`);
    const m = mouvementsDuCarnet(
      {
        lecons_nouvelles: [
          { texte: "Forte", point: "reformulation", sens: "vend", appuis: codes(SEUIL_LECON) },
          { texte: "Faible", point: "prix_devis", sens: "perd", appuis: codes(3) },
          { texte: "Inventée", point: "general", sens: "conseil", appuis: ["R99"] },
          { texte: "Point inconnu", point: "n_importe", sens: "conseil", appuis: ["R1"] },
        ],
        lecons_renforcees: [],
        lecons_a_retirer: [],
      },
      [],
      parCode,
    );
    assert.deepEqual(
      m.nouvelles.map((n) => [n.texte, n.statut, n.appuis.length, n.point]),
      [
        ["Forte", "active", 10, "reformulation"],
        ["Faible", "proposee", 3, "prix_devis"],
        ["Point inconnu", "proposee", 1, "general"],
      ],
    );
  });

  it("ne redit pas une leçon déjà au carnet", () => {
    const m = mouvementsDuCarnet(
      { lecons_nouvelles: [{ texte: "une leçon", point: "general", sens: "vend", appuis: ["R1"] }], lecons_renforcees: [], lecons_a_retirer: [] },
      [lecon({ id: "a", statut: "active" })],
      parCode,
    );
    assert.equal(m.nouvelles.length, 0);
  });

  it("renforce une proposée jusqu'au seuil, sans toucher aux refusées", () => {
    const carnet = [
      lecon({ id: "a", appuis: ["id-1", "id-2"] }),
      lecon({ id: "b", statut: "refusee", appuis: ["id-1"] }),
    ];
    const tous = Array.from({ length: 10 }, (_, i) => `R${i + 1}`);
    const m = mouvementsDuCarnet(
      { lecons_nouvelles: [], lecons_renforcees: [{ id: "a", appuis: tous }, { id: "b", appuis: tous }], lecons_a_retirer: [] },
      carnet,
      parCode,
    );
    assert.deepEqual(m.majs, [{ id: "a", appuis: [...new Set(["id-1", "id-2", ...tous.map((c) => parCode.get(c) as string)])], statut: "active" }]);
  });

  it("retire une leçon de synthèse, jamais une correction de Louis", () => {
    const m = mouvementsDuCarnet(
      {
        lecons_nouvelles: [],
        lecons_renforcees: [],
        lecons_a_retirer: [
          { id: "a", raison: "contredite par 4 appels" },
          { id: "c", raison: "contredite" },
        ],
      },
      [lecon({ id: "a", statut: "active" }), lecon({ id: "c", statut: "active", origine: "correction" })],
      parCode,
    );
    assert.deepEqual(m.retraits, [{ id: "a", note: "contredite par 4 appels" }]);
  });

  it("donne à l'analyse les leçons actives, corrections de Louis d'abord", () => {
    const l = leconsPourAnalyse([
      lecon({ id: "a", statut: "active", appuis: ["1", "2"] }),
      lecon({ id: "b", statut: "proposee" }),
      lecon({ id: "c", statut: "active", origine: "correction" }),
    ]);
    assert.deepEqual(
      l.map((x) => x.id),
      ["c", "a"],
    );
  });
});

const ficheVide: Fiche = {
  tranche_age: "45_54",
  age: "52",
  menopause: "oui",
  couple: "en_couple",
  enfants: "oui",
  metier: "",
  declencheur: "evenement_familial",
  declencheur_mots: "",
  essais: ["ww", "dukan"],
  depense: "",
  souffrances: ["fatigue"],
  veut_retrouver: "",
  freins: ["argent"],
  decide: "seule",
  source: "pub",
  phrases: [],
  profil_disc: "C",
  profil_indices: "",
};

const analyse = {
  voix_closeuse: "A",
  resume: "",
  points: [{ cle: "reformulation", repere: "acquis", constat: "", moments: [] }],
  moments_cles: [],
  alertes: [],
  pas_su: [],
  pourquoi: {
    bascule: "",
    minute_bascule: "",
    raison_donnee: "",
    vraie_raison: "",
    freins_exprimes: [],
    freins_supposes: [],
    signaux_encourageants: [],
    aurait_pu_changer: "",
    verdict: "contrainte_reelle",
    verdict_explication: "",
  },
  a_retenir: [],
  passages: [],
  fiche: ficheVide,
};

describe("le schéma", () => {
  it("demande à l'IA tous les champs qu'il lit", () => {
    assert.deepEqual([...SCHEMA_ANALYSE.required].sort(), Object.keys(analyse).sort());
  });

  it("une analyse d'avant le 08/10 se relit, sans moments clés ni verdict", () => {
    const vieille = {
      ...analyse,
      moments_cles: undefined,
      pourquoi: { bascule: "b", minute_bascule: "", raison_donnee: "", vraie_raison: "", aurait_pu_changer: "" },
    };
    const lue = lireRangee(vieille);
    assert.ok(lue);
    assert.deepEqual(lue.moments_cles, []);
    assert.deepEqual(lue.pourquoi.freins_supposes, []);
    assert.equal(lue.pourquoi.verdict, undefined);
    assert.equal(lue.points.length, CLES_POINTS.length);
  });

  it("complète les repères dans l'ordre, sans doublon", () => {
    const lue = analyseLue.parse(analyse);
    const points = pointsComplets([...lue.points, { cle: "reformulation", repere: "a_travailler", constat: "", moments: [] }]);
    assert.deepEqual(
      points.map((p) => p.cle),
      CLES_POINTS,
    );
    assert.equal(points.find((p) => p.cle === "reformulation")?.repere, "acquis");
    assert.equal(points.find((p) => p.cle === "ouverture")?.repere, "sans_objet");
  });

  it("range l'analyse sans la fiche ni les passages, et la relit", () => {
    const rangee = versRangee(analyseLue.parse(analyse));
    assert.equal("fiche" in rangee, false);
    assert.equal("passages" in rangee, false);
    assert.equal(lireRangee(rangee)?.points.length, 13);
    assert.equal(lireRangee({ n_importe: true }), null);
  });
});

describe("les chiffres d'ensemble", () => {
  it("prend le repère le plus fréquent, « en progrès » à égalité", () => {
    assert.equal(dominant({ acquis: 3, en_progres: 1, a_travailler: 0 }), "acquis");
    assert.equal(dominant({ acquis: 2, en_progres: 0, a_travailler: 2 }), "en_progres");
    assert.equal(dominant({ acquis: 0, en_progres: 0, a_travailler: 0 }), null);
  });

  it("compare ses repères à ceux de l'équipe", () => {
    const pt = (repere: "acquis" | "a_travailler") => ({ points: [{ cle: "objections" as const, repere, constat: "", moments: [] }] });
    const lignes = comparaison([pt("a_travailler")], [pt("acquis"), pt("acquis")]);
    const obj = lignes.find((l) => l.cle === "objections");
    assert.deepEqual(obj?.moi, { acquis: 0, en_progres: 0, a_travailler: 1 });
    assert.deepEqual(obj?.equipe, { acquis: 2, en_progres: 0, a_travailler: 0 });
  });

  it("compte le portrait par issue, sans les appels au résultat inconnu", () => {
    const p = chiffresPortrait([
      { issue: "vente", fiche: ficheVide, budget: "150 à 250 €" },
      { issue: "non", fiche: { ...ficheVide, menopause: "non", essais: [] }, budget: "moins de 100 €" },
      { issue: "inconnue", fiche: ficheVide, budget: null },
    ]);
    assert.equal(p.total, 2);
    assert.equal(p.ventes, 1);
    const meno = p.dimensions.find((d) => d.cle === "menopause");
    assert.deepEqual(
      meno?.lignes.map((l) => [l.valeur, l.ventes, l.total]),
      [
        ["non", 0, 1],
        ["oui", 1, 1],
      ],
    );
    const essais = p.dimensions.find((d) => d.cle === "nb_essais");
    assert.deepEqual(essais?.lignes.map((l) => l.valeur).sort(), ["essais_0_1", "essais_2_3"]);
  });

  it("lit le budget du questionnaire, et ne donne ni téléphone ni mail à l'IA", () => {
    const reponses = [
      { q: "Votre numéro de téléphone", r: "06 00 00 00 00" },
      { q: "Votre e-mail", r: "x@y.fr" },
      { q: "Le budget mensuel que vous pourriez consacrer à votre santé", r: "150 à 250 €" },
    ];
    assert.equal(budgetDuQuestionnaire(reponses), "150 à 250 €");
    assert.deepEqual(
      reponsesPourAnalyse(reponses).map((r) => r.q),
      ["Le budget mensuel que vous pourriez consacrer à votre santé"],
    );
  });
});

describe("les alertes à vérifier", () => {
  const alerte = (certitude: "sure" | "a_verifier", minute: string) => ({
    cle: "info_inventee",
    certitude,
    minute,
    extrait: "",
    explication: "",
  });

  it("une alerte rangée sans certitude reste chez Louis", () => {
    const vieille = { ...analyse, alertes: [{ cle: "promesse", minute: "26:36", extrait: "", explication: "" }] };
    const lue = lireRangee(versRangee(analyseLue.parse(vieille)));
    assert.equal(lue?.alertes[0].certitude, "a_verifier");
    assert.equal(alertesSures(lue?.alertes ?? []).length, 0);
  });

  it("la closeuse ne voit que les sûres ; Louis, celles à vérifier qu'il n'a pas tranchées", () => {
    const alertes = analyseLue.parse({
      ...analyse,
      alertes: [alerte("sure", "1:00"), alerte("a_verifier", "2:00"), alerte("a_verifier", "3:00")],
    }).alertes;
    assert.deepEqual(
      alertesSures(alertes).map((a) => a.minute),
      ["1:00"],
    );
    const tranchees = new Set([etiquetteAlerte({ minute: "2:00", cle: "info_inventee" })]);
    assert.deepEqual(
      alertesATrancher(alertes, tranchees).map((a) => a.minute),
      ["3:00"],
    );
    assert.equal(etiquetteAlerte({ minute: "", cle: "peur" }), "alerte ? peur");
  });
});
