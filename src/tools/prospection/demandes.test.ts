import assert from "node:assert/strict";
import { test } from "node:test";

import { aEnvoyer, attendValidation, estVivante, libelleDemande, type Demande, type MessagePret } from "./demandes.ts";

const demande = (d: Partial<Demande>): Demande => ({
  id: "d1",
  nombre: 10,
  statut: "en_attente",
  demandee_le: "2026-09-21T08:00:00Z",
  commencee_le: null,
  finie_le: null,
  etape: null,
  trouves: null,
  bloques: null,
  en_file: null,
  envoyes: null,
  compte_rendu: null,
  messages: [],
  envoi_valide_le: null,
  envoi_exclus: [],
  ...d,
});

const message = (slug: string): MessagePret => ({
  slug,
  nom: slug,
  ville: "Tours (37)",
  note: 5,
  contact: `${slug}@exemple.test`,
  objet: "votre annonce",
  corps: "Bonjour,",
  sources: [],
});

test("une demande en attente depuis peu dit que le PC va la prendre", () => {
  const texte = libelleDemande(demande({}), new Date("2026-09-21T08:04:00Z"));
  assert.match(texte, /dans les 5 minutes/);
});

test("une demande en attente depuis 15 minutes demande si le PC est allumé", () => {
  const texte = libelleDemande(demande({}), new Date("2026-09-21T08:15:00Z"));
  assert.match(texte, /15 min : ton PC est-il allumé/);
});

test("une demande en cours montre l'étape écrite par le PC", () => {
  const texte = libelleDemande(
    demande({ statut: "en_cours", commencee_le: "2026-09-21T08:05:00Z", etape: "relevé Meta 12 sur 45" }),
  );
  assert.match(texte, /^En cours depuis .*: relevé Meta 12 sur 45$/);
});

test("une demande faite attend le clic « Envoyer » tant que Louis n'a pas validé", () => {
  const d = demande({
    statut: "faite",
    trouves: 7,
    bloques: 1,
    en_file: 6,
    messages: ["a", "b", "c"].map(message),
    envoi_exclus: ["b"],
  });
  assert.equal(attendValidation(d), true);
  assert.deepEqual(aEnvoyer(d).map((m) => m.slug), ["a", "c"]);
  assert.equal(
    libelleDemande(d),
    "7 trouvés sur 10, 1 bloqué par la vérification, 2 prêts à partir : relis et clique « Envoyer ».",
  );
});

test("une fois validée, elle dit ce qui est parti et ce qui attend son tour", () => {
  const d = demande({
    statut: "faite",
    trouves: 7,
    en_file: 4,
    envoyes: 2,
    messages: ["a", "b"].map(message),
    envoi_valide_le: "2026-09-21T09:00:00Z",
  });
  assert.equal(attendValidation(d), false);
  assert.equal(libelleDemande(d), "7 trouvés sur 10, 2 envoyés, 4 en file d'envoi.");
});

test("tout retirer, c'est ne plus rien avoir à valider", () => {
  const d = demande({ statut: "faite", trouves: 1, messages: [message("a")], envoi_exclus: ["a"] });
  assert.equal(attendValidation(d), false);
});

test("zéro trouvé s'écrit, il ne disparaît pas", () => {
  const texte = libelleDemande(demande({ statut: "faite", trouves: 0 }));
  assert.equal(texte, "0 trouvé sur 10.");
});

test("seules les demandes en attente ou en cours sont vivantes", () => {
  assert.equal(estVivante({ statut: "en_attente" }), true);
  assert.equal(estVivante({ statut: "en_cours" }), true);
  for (const statut of ["faite", "erreur", "annulee"] as const) {
    assert.equal(estVivante({ statut }), false);
  }
});
