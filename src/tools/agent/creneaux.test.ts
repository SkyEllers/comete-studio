import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { choisirCreneaux, creneauEnMots } from "./creneaux.ts";
import { instantLocal } from "./temps.ts";

const P = "Europe/Paris";
const t = (jour: string, h: number, m = 0) => new Date(instantLocal(jour, h, m, P)).toISOString();
const maintenant = instantLocal("2026-09-25", 12, 0, P);
const rdv = t("2026-10-08", 14);

// L'agenda tel que Calendly le rend : au quart d'heure, par paquets.
const libres = [
  t("2026-10-08", 9, 30),
  t("2026-10-08", 9, 45),
  t("2026-10-08", 10),
  t("2026-10-08", 16, 30),
  t("2026-10-08", 17),
  t("2026-10-09", 9, 30),
  t("2026-10-09", 10),
  t("2026-10-10", 15),
];

describe("choisirCreneaux", () => {
  it("le même jour : les plus proches de l'heure prévue, dans l'ordre", () => {
    const { memeJour } = choisirCreneaux(libres, rdv, P, maintenant);
    assert.deepEqual(memeJour, [t("2026-10-08", 10), t("2026-10-08", 16, 30), t("2026-10-08", 17)]);
  });

  it("les plus proches : un par demi-journée, pas trois fois le même matin", () => {
    const { plusProches } = choisirCreneaux(libres, rdv, P, maintenant);
    assert.deepEqual(plusProches, [t("2026-10-08", 9, 30), t("2026-10-08", 16, 30), t("2026-10-09", 9, 30)]);
  });

  it("jamais son créneau actuel, jamais dans moins de deux heures", () => {
    const tot = instantLocal("2026-10-08", 8, 0, P);
    const { plusProches } = choisirCreneaux([...libres, rdv], rdv, P, tot);
    assert.ok(!plusProches.includes(rdv));
    assert.ok(!plusProches.includes(t("2026-10-08", 9, 30)));
  });

  it("rien de libre : deux listes vides", () => {
    assert.deepEqual(choisirCreneaux([], rdv, P, maintenant), { memeJour: [], plusProches: [] });
  });

  it("écrit un créneau en mots, avec sa valeur exacte", () => {
    assert.equal(creneauEnMots(t("2026-10-08", 9, 30), P), "jeudi 8 octobre à 9h30 (2026-10-08T07:30:00.000Z)");
  });
});
