/**
 * Le rapport d'entonnoir de la landing « sommeil » de Jonathan, lu dans GA4.
 *
 *     GA4_ACCESS_TOKEN=… npm run rapport:entonnoir -- --du=2026-09-05 --au=2026-09-12
 *
 * Lecture seule : deux appels `batchRunReports` à l'API Data de GA4, en `fetch`
 * natif comme partout ailleurs dans le hub. Le jeton ne s'écrit ni ne
 * s'affiche nulle part ; il se lit dans l'environnement, ou à défaut dans
 * `.env.local`.
 *
 * Mode d'emploi, limites et lecture sans API : docs/RAPPORT-ENTONNOIR-GA4.md.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  calculer,
  lignes,
  lireOptions,
  parSource,
  rediger,
  requetes,
} from "./entonnoir-ga4-calcul.mjs";

/** Propriété « Site Hypnose Jonathan » (flux G-22G5VB8LHV), semaine de lancement de la campagne. */
const DEFAUTS = { du: "2026-09-05", au: "2026-09-12", propriete: "536224481" };

const API = "https://analyticsdata.googleapis.com/v1beta/properties";
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Le jeton : l'environnement d'abord, `.env.local` ensuite, sinon rien. */
function lireJeton() {
  const direct = process.env.GA4_ACCESS_TOKEN?.trim();
  if (direct) return direct;

  try {
    const ligne = readFileSync(join(RACINE, ".env.local"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("GA4_ACCESS_TOKEN="));
    const valeur = ligne
      ?.slice(ligne.indexOf("=") + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    return valeur || null;
  } catch {
    return null;
  }
}

class ErreurGa4 extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Un lot de requêtes `runReport`, en un aller-retour. */
async function lot(propriete, jeton, requests) {
  const reponse = await fetch(`${API}/${propriete}:batchRunReports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(30_000),
  });

  const corps = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    throw new ErreurGa4(reponse.status, corps?.error?.message ?? `HTTP ${reponse.status}`);
  }
  return (corps?.reports ?? []).map(lignes);
}

const CONSEILS = {
  401: "Jeton refusé : absent, expiré (il vit une heure) ou sans la portée analytics.readonly.",
  403: "Accès refusé : le compte du jeton doit avoir au moins le rôle Lecteur sur la propriété, et l'API Data de GA4 doit être activée pour le projet qui a émis le jeton.",
};

async function main() {
  let options;
  try {
    options = lireOptions(process.argv.slice(2), DEFAUTS);
  } catch (erreur) {
    console.error(erreur.message);
    process.exitCode = 2;
    return;
  }

  const jeton = lireJeton();
  if (!jeton) {
    console.error(
      "GA4_ACCESS_TOKEN est vide. Voir docs/RAPPORT-ENTONNOIR-GA4.md, « Obtenir un jeton ».",
    );
    process.exitCode = 2;
    return;
  }

  const { evenements: lotEvenements, paliers: lotPaliers } = requetes(options);

  try {
    const [evenements, parSourceEvenements] = await lot(options.propriete, jeton, lotEvenements);

    /* Les paliers à part : tant que la dimension video_percent n'est pas
       déclarée dans la propriété, GA4 refuse tout leur lot. L'entonnoir n'a
       pas à tomber avec lui. */
    let paliers = null;
    let parSourcePaliers = null;
    try {
      [paliers, parSourcePaliers] = await lot(options.propriete, jeton, lotPaliers);
    } catch (erreur) {
      const dimensionAbsente =
        erreur instanceof ErreurGa4 &&
        erreur.status === 400 &&
        erreur.message.includes("video_percent");
      if (!dimensionAbsente) throw erreur;
    }

    const calcul = calculer({ evenements, parSourceEvenements, paliers, parSourcePaliers });
    console.log(rediger({ ...options, ...calcul, sources: parSource(parSourceEvenements) }));
  } catch (erreur) {
    if (erreur instanceof ErreurGa4) {
      console.error(`GA4 a répondu ${erreur.status} : ${erreur.message}`);
      if (CONSEILS[erreur.status]) console.error(CONSEILS[erreur.status]);
    } else {
      console.error(`Échec : ${erreur.message}`);
    }
    process.exitCode = 1;
  }
}

await main();
