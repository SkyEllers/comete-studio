import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estEtape, resumeRelances } from "./relances.ts";

describe("Relances des closeuses", () => {
  it("résume les relances envoyées et la confirmation", () => {
    assert.equal(resumeRelances(null), null);
    assert.equal(resumeRelances({}), null);
    assert.equal(
      resumeRelances({ veille: "2026-10-07T17:00:00Z", trente: "2026-10-08T08:00:00Z" }),
      "Relances : la veille, 30 min avant",
    );
    assert.equal(resumeRelances({ confirme: "2026-10-07T18:00:00Z" }), "Elle a confirmé");
    assert.equal(resumeRelances({ sans_tel: "2026-10-08T09:00:00Z" }), "Pas de téléphone");
    assert.equal(
      resumeRelances({ sans_tel: "2026-10-08T09:00:00Z", pendant: "2026-10-08T10:00:00Z" }),
      "Pas de téléphone · relances : pendant le RDV",
    );
    assert.equal(
      resumeRelances({ jour: "2026-10-08T07:00:00Z", confirme: "2026-10-08T07:05:00Z" }),
      "Relances : le jour même · elle a confirmé",
    );
  });

  it("ne connaît que ses étapes", () => {
    assert.ok(estEtape("veille"));
    assert.ok(!estEtape("demain"));
  });
});
