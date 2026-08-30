/**
 * Banc de QA — le classement de Sas, contre la vraie API.
 *
 *   npm run qa:sas-ia
 *
 * Celui-ci ne touche pas la base : il n'appelle que le module de production
 * `src/tools/sas/anthropic.ts` et la réconciliation qui suit. C'est voulu —
 * ce qu'on met à l'épreuve ici, c'est le prompt et la défiance qu'on lui
 * oppose, pas la RLS (`npm run qa:sas` s'en charge).
 *
 * Il importe le module réel, jamais une copie du prompt : un banc qui
 * reproduirait la requête vérifierait sa propre copie et laisserait la
 * production dériver sans rien dire.
 *
 * `--conditions=react-server` : `anthropic.ts` commence par
 * `import 'server-only'`, qui lève partout ailleurs. C'est la garde qui
 * empêche le module de finir dans un bundle navigateur ; le banc se place du
 * côté serveur pour la franchir, au lieu de la retirer.
 *
 * Deux appels à l'API par exécution, quelques dixièmes de centime.
 */
import { env } from "./qa-commun.mjs";

import { reconcilier } from "../src/tools/sas/classement.ts";
import { ideesManuelles } from "../src/tools/sas/decoupage.ts";
import { demanderClassement } from "../src/tools/sas/anthropic.ts";

console.log("QA — Sas, classement par l'IA\n");

if (!env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY est absente de `.env.local` : ce banc ne peut pas tourner.",
  );
  process.exit(1);
}
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

let reussis = 0;
const echecs = [];

const verifie = (nom, condition, detail = "") => {
  if (condition) {
    reussis += 1;
    console.log(`  ok     ${nom}`);
    return;
  }
  echecs.push(`${nom}${detail ? ` — ${detail}` : ""}`);
  console.log(`  ECHEC  ${nom}${detail ? ` — ${detail}` : ""}`);
};

const BOITES = [
  { id: "id-jonathan", name: "Jonathan" },
  { id: "id-peggy", name: "Peggy" },
];

/** Le classement complet, comme le fait la Server Action. */
async function classer(texte, boites = BOITES) {
  const brut = await demanderClassement(texte, boites);
  return brut === null ? null : reconcilier(brut, boites, texte);
}

const decrire = (idee) => {
  const destination = idee.destination;
  if (destination.type === "boite") {
    const boite = BOITES.find((candidate) => candidate.id === destination.boiteId);
    return `pro → ${boite?.name ?? destination.boiteId}`;
  }
  if (destination.type === "nouvelle") return `pro → créer « ${destination.nom} »`;
  if (destination.type === "perso") return "perso";
  return "pro → À ranger";
};

// ------------------- 1. Le scénario du brief, mot pour mot -------------------

console.log("== 1. Le scénario du brief ==");

const SCENARIO =
  "finir le SEO de Jonathan\nanalyser résultats campagne Flora\nracheter des lentilles";

const scenario = await classer(SCENARIO);

if (!scenario) {
  verifie("l'IA a répondu quelque chose d'exploitable", false, "repli manuel");
} else {
  for (const idee of scenario) console.log(`         « ${idee.texte} » → ${decrire(idee)}`);

  verifie("trois idées", scenario.length === 3, `${scenario.length} idée(s)`);

  const jonathan = scenario[0];
  verifie(
    "le SEO part dans la boîte Jonathan, qui existe",
    jonathan?.destination.type === "boite" &&
      jonathan.destination.boiteId === "id-jonathan",
    JSON.stringify(jonathan?.destination),
  );
  verifie(
    "son texte est recopié tel quel",
    jonathan?.texte === "finir le SEO de Jonathan",
    jonathan?.texte,
  );

  const flora = scenario[1];
  verifie(
    "Flora est inconnue : l'outil demande au lieu de décider",
    flora?.destination.type === "nouvelle" && flora.incertain === true,
    JSON.stringify(flora?.destination),
  );
  verifie(
    "et le nom proposé est bien « Flora »",
    flora?.destination.type === "nouvelle" &&
      flora.destination.nom.toLowerCase().includes("flora"),
    flora?.destination.type === "nouvelle" ? flora.destination.nom : "",
  );

  const lentilles = scenario[2];
  verifie(
    "les lentilles sont perso, sans boîte",
    lentilles?.destination.type === "perso",
    JSON.stringify(lentilles?.destination),
  );
}

// ------------------------ 2. Trente lignes mélangées ------------------------

console.log("\n== 2. Trente lignes mélangées ==");

const TRENTE = [
  "finir le SEO de Jonathan",
  "racheter des lentilles",
  "relancer Peggy sur les photos",
  "prendre rdv dentiste",
  "facture de septembre à envoyer",
  "réserver le train pour Paris",
  "revoir la landing de Jonathan",
  "acheter du pain",
  "appeler la banque pour le prêt",
  "préparer le point mensuel Peggy",
  "changer les plaquettes du vélo",
  "répondre au mail de Flora",
  "trier les photos du week-end",
  "devis pour le nouveau client",
  "renouveler l'abonnement Adobe",
  "anniversaire de maman le 12",
  "corriger le formulaire de contact",
  "sortir les poubelles",
  "écrire le post LinkedIn de la semaine",
  "vérifier les stats de la campagne",
  "prendre les billets du concert",
  "mettre à jour le portfolio",
  "rappeler le comptable",
  "réparer la fuite du robinet",
  "relire le contrat avant signature",
  "arroser les plantes",
  "planifier la refonte du site Peggy",
  "acheter un cadeau pour Léa",
  "sauvegarder le disque dur",
  "faire le point sur la trésorerie",
].join("\n");

const trente = await classer(TRENTE);

if (!trente) {
  verifie("trente lignes passent le classement", false, "repli manuel");
} else {
  verifie(
    "une idée par ligne, ni perdue ni inventée",
    trente.length === 30,
    `${trente.length} idée(s) pour 30 lignes`,
  );

  const perso = trente.filter((idee) => idee.destination.type === "perso").length;
  const pro = trente.length - perso;
  console.log(`         ${pro} pro, ${perso} perso`);
  verifie(
    "les deux univers sont représentés",
    perso > 0 && pro > 0,
    `${pro} pro, ${perso} perso`,
  );

  verifie(
    "aucune idée perso ne porte de boîte",
    trente.every(
      (idee) => idee.destination.type !== "perso" || !("boiteId" in idee.destination),
    ),
  );

  const rattachees = trente.filter(
    (idee) =>
      idee.destination.type === "boite" &&
      ["id-jonathan", "id-peggy"].includes(idee.destination.boiteId),
  ).length;
  verifie(
    "les idées nommant Jonathan ou Peggy retrouvent leur boîte",
    rattachees >= 4,
    `${rattachees} rattachée(s)`,
  );

  const inventees = trente.filter((idee) => !TRENTE.includes(idee.texte)).length;
  verifie(
    "aucun texte n'a été réécrit",
    inventees === 0,
    `${inventees} texte(s) modifié(s)`,
  );
}

// ---------------------------- 3. L'IA en panne ------------------------------

console.log("\n== 3. L'IA coupée ==");

const vraieCle = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = "sk-ant-invalide-pour-le-banc";

const panne = await classer(SCENARIO);
verifie("clé invalide : aucun classement", panne === null, JSON.stringify(panne));

delete process.env.ANTHROPIC_API_KEY;
const sansCle = await classer(SCENARIO);
verifie("clé absente : aucun classement non plus", sansCle === null);

process.env.ANTHROPIC_API_KEY = vraieCle;

const secours = ideesManuelles(SCENARIO);
verifie(
  "le repli rend les trois lignes",
  secours.length === 3,
  `${secours.length} ligne(s)`,
);
verifie(
  "sans destination : c'est à Louis de choisir",
  secours.every((idee) => idee.destination === null),
);
verifie(
  "et sans rien perdre du texte",
  secours[0].texte === "finir le SEO de Jonathan" &&
    secours[2].texte === "racheter des lentilles",
);

// ---------------------------------- Bilan ------------------------------------

console.log(`\n${reussis} vérifications passées, ${echecs.length} en échec.`);
if (echecs.length > 0) {
  console.log("\nÉchecs :");
  for (const echec of echecs) console.log(" -", echec);
}
process.exitCode = echecs.length > 0 ? 1 : 0;
