/**
 * L'alias `@/` du projet (tsconfig : `@/*` → `src/*`), pour les bancs lancés
 * par Node sans Next : `node --import ./scripts/qa-alias.mjs …`.
 *
 * Depuis le 27/09/2026, `src/tools/agent/outil.ts` importe `@/tools/…` :
 * sans ce résolveur, tout banc qui charge le moteur de l'agent échoue au
 * démarrage. Un chemin sans extension prend `.ts`, puis `.tsx`, puis
 * `index.ts`.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = join(process.cwd(), "src");

registerHooks({
  resolve(specifier, context, suivant) {
    if (!specifier.startsWith("@/")) return suivant(specifier, context);
    const base = join(SRC, specifier.slice(2));
    const candidats = /\.(ts|tsx|mjs|js)$/.test(base)
      ? [base]
      : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
    const trouve = candidats.find((c) => existsSync(c));
    if (!trouve) return suivant(specifier, context);
    return { url: pathToFileURL(trouve).href, shortCircuit: true };
  },
});
