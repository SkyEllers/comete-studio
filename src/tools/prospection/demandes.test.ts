import assert from "node:assert/strict";
import { test } from "node:test";

import { estVivante, libelleDemande, type Demande } from "./demandes.ts";

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
  ...d,
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

test("une demande faite dit combien de trouvés sur combien demandés, sans baisser le seuil", () => {
  const texte = libelleDemande(
    demande({ statut: "faite", trouves: 7, bloques: 1, en_file: 6, envoyes: 0 }),
  );
  assert.equal(texte, "7 trouvés sur 10, 1 bloqué par la vérification, 6 en file d'envoi.");
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
