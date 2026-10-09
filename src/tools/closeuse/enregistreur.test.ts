import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chrono, navigateurCompatible, nomFichierAppel } from "./enregistreur.ts";

describe("Enregistreur d'appel", () => {
  it("n'accepte que Chrome ou Edge sur ordinateur", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
    const edge = `${chrome} Edg/129.0`;
    const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    const firefox = "Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0";
    const android = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
    assert.ok(navigateurCompatible(chrome));
    assert.ok(navigateurCompatible(edge));
    assert.ok(!navigateurCompatible(safari));
    assert.ok(!navigateurCompatible(firefox));
    assert.ok(!navigateurCompatible(android));
  });

  it("affiche la durée", () => {
    assert.equal(chrono(65), "1:05");
    assert.equal(chrono(3750), "1:02:30");
  });

  it("nomme le fichier sans accent ni espace", () => {
    assert.equal(nomFichierAppel("Hélène Marie", "2026-10-09T08:00:00Z"), "appel-helene-marie-2026-10-09.webm");
    assert.equal(nomFichierAppel("", "2026-10-09T08:00:00Z"), "appel-cliente-2026-10-09.webm");
  });
});
