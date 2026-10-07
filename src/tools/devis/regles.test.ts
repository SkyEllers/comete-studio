import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lisible, pdfDuDevis } from "./pdf.ts";
import { devisPeggy } from "./profils/peggy.ts";
import {
  adresseDuDevis,
  blocObjet,
  contenu,
  empreinte,
  euros,
  expire,
  INVESTIGATION_SEULE,
  investigationSeule,
  MICROBIOTE_SEUL,
  microbioteSeul,
  dureeCloseuse,
  lienValide,
  montants,
  rappelDu,
  valideJusquAu,
} from "./regles.ts";

const cliente = { prenom: "Camille", nom: "Martin", email: "camille@example.com", telephone: "06 00 00 00 00", adresse: "1 rue de la Paix, 75002 Paris" };

describe("les montants", () => {
  it("500 € puis 150 € par mois, 50 € de moins en une fois (07/10/2026)", () => {
    const m = montants(devisPeggy, 6, "plusieurs");
    assert.equal(m.totalEchelonneCents, 140_000);
    assert.equal(m.totalUneFoisCents, 135_000);
    assert.equal(m.totalCents, 140_000);
    assert.equal(montants(devisPeggy, 6, "une_fois").totalCents, 135_000);
    assert.equal(montants(devisPeggy, 12, "plusieurs").totalCents, 230_000);
  });
  it("refuse une durée hors de -1 à 24 mois", () => {
    assert.throws(() => montants(devisPeggy, -2, "une_fois"));
    assert.throws(() => montants(devisPeggy, 25, "une_fois"));
  });
  it("l'investigation seule : 500 € en 1 fois, sans mensualité ni remise (Louis, 07/10/2026)", () => {
    for (const paiement of ["une_fois", "plusieurs"] as const) {
      const m = montants(devisPeggy, INVESTIGATION_SEULE, paiement);
      assert.equal(m.totalCents, 50_000);
      assert.equal(m.paiement, "une_fois");
      assert.equal(m.mensualiteCents, 0);
      assert.equal(m.remiseUneFoisCents, 0);
      assert.equal(m.dureeMois, 1);
      assert.equal(investigationSeule(m), true);
    }
    assert.equal(investigationSeule(montants(devisPeggy, 1, "plusieurs")), false);
  });
  it("le bilan microbiote seul : 365 € en 1 fois, ou 2 × 190 € (Louis, 07/10/2026)", () => {
    const une = montants(devisPeggy, MICROBIOTE_SEUL, "une_fois");
    assert.equal(une.totalCents, 36_500);
    assert.equal(microbioteSeul(une), true);
    const deux = montants(devisPeggy, MICROBIOTE_SEUL, "plusieurs");
    assert.equal(deux.totalCents, 38_000);
    assert.equal(deux.dureeMois, 2);
    assert.equal(deux.mensualiteCents, 19_000);
    assert.equal(deux.investigationCents, 0);
    assert.equal(microbioteSeul(montants(devisPeggy, 6, "plusieurs")), false);
    assert.throws(() => montants({ ...devisPeggy, microbiote: undefined }, MICROBIOTE_SEUL, "une_fois"));
  });
  it("une closeuse propose 6, 9 ou 12 mois, l'investigation ou le bilan microbiote (07/10/2026)", () => {
    for (const d of [6, 9, 12, INVESTIGATION_SEULE, MICROBIOTE_SEUL]) assert.equal(dureeCloseuse(d), true, String(d));
    for (const d of [1, 3, 8, 10, 24]) assert.equal(dureeCloseuse(d), false, String(d));
    assert.equal(montants(devisPeggy, 9, "plusieurs").totalCents, 185_000);
  });
  it("relu depuis la base (1 mois à 0 €), le devis reste une investigation seule", () => {
    const m = montants({ investigationCents: 50_000, mensualiteCents: 0, remiseUneFoisCents: 0 }, 1, "une_fois");
    assert.equal(m.totalCents, 50_000);
    assert.equal(investigationSeule(m), true);
  });
  it("écrit les euros à la française", () => {
    assert.equal(euros(140_000), "1 400 €");
    assert.equal(euros(12_050), "120,50 €");
  });
});

describe("la validité et les rappels", () => {
  const envoye = Date.parse("2026-10-01T15:00:00+02:00");
  const valide = valideJusquAu(envoye, 7);
  const d = { statut: "envoye", envoye_le: new Date(envoye).toISOString(), relance_le: null, valide_jusqu_au: valide };

  it("une semaine après le jour d'envoi", () => assert.equal(valide, "2026-10-08"));
  it("pas de rappel le jour de l'envoi", () => assert.equal(rappelDu(d, Date.parse("2026-10-01T18:00:00+02:00")), false));
  it("pas avant 10h le lendemain", () => assert.equal(rappelDu(d, Date.parse("2026-10-02T09:59:00+02:00")), false));
  it("un rappel le lendemain à 10h", () => assert.equal(rappelDu(d, Date.parse("2026-10-02T10:05:00+02:00")), true));
  it("un seul par jour", () =>
    assert.equal(rappelDu({ ...d, relance_le: "2026-10-02T08:05:00Z" }, Date.parse("2026-10-02T15:00:00+02:00")), false));
  it("encore le dernier jour", () => assert.equal(rappelDu(d, Date.parse("2026-10-08T10:05:00+02:00")), true));
  it("plus rien après", () => {
    assert.equal(rappelDu(d, Date.parse("2026-10-09T10:05:00+02:00")), false);
    assert.equal(expire(d, Date.parse("2026-10-09T00:05:00+02:00")), true);
    assert.equal(expire(d, Date.parse("2026-10-08T23:55:00+02:00")), false);
  });
  it("rien pour un devis signé", () => assert.equal(rappelDu({ ...d, statut: "signe" }, Date.parse("2026-10-02T10:05:00+02:00")), false));
});

describe("le contenu signé", () => {
  const m = montants(devisPeggy, 6, "plusieurs");
  const c = contenu(devisPeggy, cliente, m, "2026-10-08");

  it("porte les totaux, le choix et le formulaire de rétractation", () => {
    const texte = JSON.stringify(c.blocs);
    assert.match(texte, /Total en échelonnement : 1 400 €/);
    assert.match(texte, /Total en paiement 1 fois : 1 350 €/);
    assert.match(texte, /Votre choix : paiement en plusieurs fois, 1 400 € au total/);
    assert.match(texte, /Formulaire de rétractation/);
    assert.match(texte, /valable jusqu'au 8 octobre 2026 inclus/);
  });

  it("l'investigation seule : la phase 1, 500 € en 1 fois, ni mensualité ni autres phases", () => {
    const seule = contenu(devisPeggy, cliente, montants(devisPeggy, INVESTIGATION_SEULE, "une_fois"), "2026-10-08");
    const texte = JSON.stringify(seule.blocs);
    assert.match(texte, /500 € : investigation initiale seule/);
    assert.match(texte, /Paiement en 1 fois : 500 €/);
    assert.match(texte, /1\. Phase d'investigation/);
    assert.match(texte, /Formulaire de rétractation/);
    assert.doesNotMatch(texte, /par mois/);
    assert.doesNotMatch(texte, /2\. Phase de transformation/);
    assert.doesNotMatch(texte, /Objet de votre accompagnement/);
  });

  it("le bilan microbiote seul : le texte de Peggy, ses montants, ni phases ni mensualités", () => {
    const relu = montants({ investigationCents: 0, mensualiteCents: 19_000, remiseUneFoisCents: 1_500 }, 2, "plusieurs");
    const micro = contenu(devisPeggy, cliente, relu, "2026-10-08", "Des ballonnements depuis l'été.");
    const texte = JSON.stringify(micro.blocs);
    assert.equal(micro.sousTitre, "Bilan microbiote & plan d'actions personnalisé");
    assert.equal(micro.blocs[0].titre, "Objet du devis");
    assert.match(texte, /Objet de votre prestation personnalisée/);
    assert.match(texte, /Total : 365 €/);
    assert.match(texte, /Paiement en 2 fois : 190 € à la mise en place, puis 190 € le mois suivant/);
    assert.match(texte, /Formulaire de rétractation/);
    assert.doesNotMatch(texte, /Phase de transformation/);
    assert.doesNotMatch(texte, /—/);
  });

  it("l'accompagnement garde ses quatre phases", () => {
    const texte = JSON.stringify(c.blocs);
    assert.match(texte, /Objet de votre accompagnement/);
    assert.match(texte, /4\. Phase d'envol/);
  });

  it("l'empreinte change dès qu'un mot change", () => {
    const e1 = empreinte(c);
    assert.match(e1, /^[0-9a-f]{64}$/);
    assert.equal(empreinte(contenu(devisPeggy, cliente, m, "2026-10-08")), e1);
    assert.notEqual(empreinte(contenu(devisPeggy, { ...cliente, adresse: "2 rue de la Paix" }, m, "2026-10-08")), e1);
  });

  it("fabrique un PDF lisible", async () => {
    const pdf = await pdfDuDevis(c, {
      signeLe: "2026-10-02T12:07:00Z",
      ip: "203.0.113.4",
      agent: "Mozilla/5.0 (iPhone)",
      demarrageImmediat: true,
      empreinte: empreinte(c),
      evenements: [
        { genre: "envoye", le: "2026-10-01T13:00:00Z", ip: null, agent: null },
        { genre: "signe", le: "2026-10-02T12:07:00Z", ip: "203.0.113.4", agent: "Mozilla/5.0 (iPhone)" },
      ],
      identifiantDevis: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
    assert.ok(pdf.length > 5_000);
  });

  it("l'objet du devis (0053) : en tête, avant l'offre, un paragraphe par bloc", () => {
    const avec = contenu(devisPeggy, cliente, m, "2026-10-08", "Des ballonnements depuis l'été.\n\nElle veut  comprendre\nce qui se passe.");
    assert.deepEqual(avec.blocs[0], { titre: "Objet du devis", paragraphes: ["Des ballonnements depuis l'été.", "Elle veut comprendre ce qui se passe."] });
    assert.equal(avec.blocs[1].titre, "Objet de votre accompagnement personnalisé");
    assert.equal(blocObjet("  \n "), null);
  });

  it("sans objet, un devis d'avant garde le même contenu et la même empreinte", () => {
    assert.equal(empreinte(contenu(devisPeggy, cliente, m, "2026-10-08", null)), empreinte(c));
  });

  it("fabrique l'aperçu de la closeuse, sans signature ni dossier de preuve", async () => {
    const pdf = await pdfDuDevis(contenu(devisPeggy, cliente, m, "2026-10-08", "Objet d'essai."), null);
    assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
    assert.ok(pdf.length > 3_000);
  });

  it("remplace ce que la police ne sait pas écrire", () => assert.equal(lisible("✔ ok — « oui » 🙂"), "- ok - « oui » ?"));
});

describe("le lien", () => {
  it("64 caractères hexadécimaux", () => {
    assert.equal(lienValide("a".repeat(64)), true);
    assert.equal(lienValide("A".repeat(64)), false);
    assert.equal(lienValide("a".repeat(63)), false);
  });
  it("après le #", () => assert.equal(adresseDuDevis("https://www.peggygirault.fr/", "ab"), "https://www.peggygirault.fr/devis/#ab"));
});
