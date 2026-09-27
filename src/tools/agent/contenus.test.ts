import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { choisirContenu, contenusDeja } from "./contenus.ts";
import { articlesPeggy } from "./profils/peggy-articles.ts";

describe("Contenu entre deux rappels", () => {
  const reponses = [{ answer: "J'ai fait deux régimes Weight Watchers qui n'ont pas tenu, et je craque sur le sucre le soir" }];

  it("choisit l'article qui parle le plus de ses réponses", () => {
    const c = choisirContenu(articlesPeggy, reponses, new Set());
    assert.ok(c);
    assert.match(`${c.titre} ${c.theme} ${c.resume}`.toLowerCase(), /r[ée]gime|sucre/);
  });

  it("jamais deux fois le même, et rien quand le catalogue est épuisé", () => {
    const premier = choisirContenu(articlesPeggy, reponses, new Set());
    assert.ok(premier);
    const second = choisirContenu(articlesPeggy, reponses, new Set([premier.url]));
    assert.notEqual(second?.url, premier.url);
    assert.equal(choisirContenu(articlesPeggy, reponses, new Set(articlesPeggy.map((a) => a.url))), null);
  });

  it("retrouve les contenus déjà partis dans les messages envoyés", () => {
    const a = articlesPeggy[0];
    assert.deepEqual([...contenusDeja(articlesPeggy, [`Voici : ${a.url}`, "autre chose"])], [a.url]);
  });
});
