/**
 * Outillage partagé par les bancs de QA.
 *
 * Aucune clé n'est écrite ici : tout est lu dans `.env.local`, qui n'est pas
 * versionné. Les bancs s'adressent donc au projet Supabase lié — celui de
 * production. Ils ne créent que des comptes et des organisations préfixés
 * `zz-qa-`, et les suppriment avant de rendre la main.
 */
import { readFileSync } from "node:fs";

const ATTENDUES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function chargerEnv() {
  let contenu;
  try {
    contenu = readFileSync(".env.local", "utf8");
  } catch {
    throw new Error(
      "`.env.local` est introuvable. Lance le banc depuis la racine du projet.",
    );
  }

  const env = Object.fromEntries(
    contenu
      .split(/\r?\n/)
      .filter((ligne) => ligne.includes("=") && !ligne.startsWith("#"))
      .map((ligne) => {
        const coupure = ligne.indexOf("=");
        return [
          ligne.slice(0, coupure).trim(),
          ligne.slice(coupure + 1).trim().replace(/^["']|["']$/g, ""),
        ];
      }),
  );

  const manquantes = ATTENDUES.filter((nom) => !env[nom]);
  if (manquantes.length > 0) {
    throw new Error(`Variables manquantes dans .env.local : ${manquantes.join(", ")}`);
  }

  return env;
}

export const env = chargerEnv();
export const SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET = env.SUPABASE_SERVICE_ROLE_KEY;

/** Le projet visé, annoncé au démarrage : on écrit dans une vraie base. */
export function annoncerCible(titre) {
  const ref = new URL(SUPABASE).hostname.split(".")[0];
  console.log(`${titre}\nProjet Supabase : ${ref}\n`);
}

/** Un mot de passe qui ne sert qu'à cette exécution. */
export const motDePasse = "QaComete!" + Math.random().toString(36).slice(2, 10);

// ------------------------------ appels REST ---------------------------------

export async function rest(cle, jeton, methode, chemin, corps) {
  const reponse = await fetch(`${SUPABASE}/rest/v1/${chemin}`, {
    method: methode,
    headers: {
      apikey: cle,
      Authorization: `Bearer ${jeton ?? cle}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });

  const texte = await reponse.text();
  let data = null;
  try {
    data = texte ? JSON.parse(texte) : null;
  } catch {
    data = texte;
  }
  return { status: reponse.status, data };
}

/** Avec la clé secrète : pour poser le décor et constater, jamais pour tester. */
export const srv = (methode, chemin, corps) =>
  rest(SECRET, SECRET, methode, chemin, corps);

/** Avec une vraie session : c'est ce que le banc met à l'épreuve. */
export const par = (jeton) => (methode, chemin, corps) =>
  rest(ANON, jeton, methode, chemin, corps);

export async function creer(table, corps) {
  const resultat = await srv("POST", table, corps);
  if (resultat.status >= 300) {
    throw new Error(`insertion ${table} : ${JSON.stringify(resultat.data)}`);
  }
  return Array.isArray(resultat.data) ? resultat.data[0] : resultat.data;
}

// --------------------------------- comptes ----------------------------------

export async function creerCompte(email) {
  const reponse = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: motDePasse, email_confirm: true }),
  });

  const corps = await reponse.json();
  if (!reponse.ok) throw new Error(`compte ${email} : ${JSON.stringify(corps)}`);
  return corps.id;
}

export const supprimerCompte = (id) =>
  fetch(`${SUPABASE}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  });

/** Connexion par mot de passe : renvoie un jeton d'accès, comme l'application. */
export async function connecter(email) {
  const reponse = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: motDePasse }),
  });

  const corps = await reponse.json();
  if (!reponse.ok) throw new Error(`connexion ${email} : ${JSON.stringify(corps)}`);
  return corps.access_token;
}

// -------------------------------- assertions --------------------------------

/**
 * Une écriture est refusée soit par une erreur, soit — c'est le cas courant
 * sous RLS — par zéro ligne touchée : la ligne visée n'est pas visible, donc
 * le `where` ne la trouve pas.
 */
export const refuse = (resultat) =>
  resultat.status >= 400 ||
  (Array.isArray(resultat.data) && resultat.data.length === 0);

export const vide = (resultat) =>
  resultat.status === 200 && Array.isArray(resultat.data) && resultat.data.length === 0;

/** Un carnet de vérifications, qui rend un code de sortie en fin de course. */
export function journal() {
  let reussis = 0;
  const echecs = [];

  const verifie = (nom, condition, detail = "") => {
    if (condition) {
      reussis += 1;
      return;
    }
    echecs.push(`${nom}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ECHEC  ${nom}${detail ? ` — ${detail}` : ""}`);
  };

  const bilan = () => {
    console.log(`\n${reussis} vérifications passées, ${echecs.length} en échec.`);
    if (echecs.length > 0) {
      console.log("\nÉchecs :");
      for (const echec of echecs) console.log(" -", echec);
    }
    process.exitCode = echecs.length > 0 ? 1 : 0;
  };

  return { verifie, bilan };
}
