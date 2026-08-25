// ===========================================================================
// QA du temps réel — phase 2, chantier 5.
//
// Le canal Realtime est une deuxième porte sur les mêmes données : on vérifie
// qu'il respecte la même frontière que l'API REST. Deux organisations, deux
// vraies sessions, un canal chacune sur le même tableau.
//
//   node scripts/qa-temps-reel.mjs
//
// Aucune valeur sensible ici : tout est lu dans .env.local. Comptes et
// organisations créés sont supprimés à la fin, par identifiant.
// ===========================================================================
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const AK = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SB || !SRK || !AK) {
  console.error("Clés manquantes dans .env.local.");
  process.exit(1);
}

// Le client du projet, chargé depuis node_modules (le chemin contient un
// espace, d'où le passage par une URL de fichier).
const { createClient } = await import(
  pathToFileURL(path.join(root, "node_modules/@supabase/supabase-js/dist/index.mjs")).href
);

const motDePasse = () => "Qa1!" + crypto.randomBytes(12).toString("base64url");
const patiente = (ms) => new Promise((r) => setTimeout(r, ms));

async function srv(method, chemin, body) {
  const res = await fetch(`${SB}${chemin}`, {
    method,
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texte = await res.text();
  try {
    return JSON.parse(texte);
  } catch {
    return texte;
  }
}

async function ecrire(token, chemin, body, method = "POST") {
  const res = await fetch(`${SB}/rest/v1${chemin}`, {
    method,
    headers: {
      apikey: AK,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function session(email, password) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: AK, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`connexion impossible : ${email}`);
  return data.access_token;
}

let reussites = 0;
let echecs = 0;
function verifie(libelle, condition, detail = "") {
  if (condition) {
    reussites++;
    console.log(`  OK   ${libelle}`);
  } else {
    echecs++;
    console.log(`  FAIL ${libelle}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Un abonné : un client, un canal sur le tableau, et ce qu'il a reçu. */
async function abonne(token, boardId, etiquette) {
  const client = createClient(SB, AK, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await client.realtime.setAuth(token);

  const recus = [];
  const canal = client.channel(`qa:${etiquette}:${boardId}`);

  for (const table of ["cards", "lists", "comments"]) {
    canal.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `board_id=eq.${boardId}` },
      (payload) => {
        recus.push({
          table,
          type: payload.eventType,
          row: payload.new ?? payload.old,
        });
      },
    );
  }

  const statut = await new Promise((resolve) => {
    const minuteur = setTimeout(() => resolve("TIMEOUT"), 10000);
    canal.subscribe((s) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        clearTimeout(minuteur);
        resolve(s);
      }
    });
  });

  return { client, canal, recus, statut };
}

const comptes = [];
const organisations = [];
const abonnes = [];

async function creerCompte(email, nom) {
  const password = motDePasse();
  const { id } = await srv("POST", "/auth/v1/admin/users", {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: nom },
  });
  if (!id) throw new Error(`création impossible : ${email}`);
  comptes.push(id);
  return { id, email, password };
}

try {
  console.log("=== Préparation ===");
  const suffixe = crypto.randomBytes(3).toString("hex");
  const alice = await creerCompte(`qa-rt-alice-${suffixe}@example.com`, "Alice Alpha");
  const chloe = await creerCompte(`qa-rt-chloe-${suffixe}@example.com`, "Chloé Alpha");
  const bruno = await creerCompte(`qa-rt-bruno-${suffixe}@example.com`, "Bruno Bravo");

  const [orgA] = await srv("POST", "/rest/v1/organizations", {
    name: "QA Realtime Alpha",
    slug: `qa-rt-alpha-${suffixe}`,
  });
  const [orgB] = await srv("POST", "/rest/v1/organizations", {
    name: "QA Realtime Bravo",
    slug: `qa-rt-bravo-${suffixe}`,
  });
  organisations.push(orgA.id, orgB.id);

  await srv("POST", "/rest/v1/memberships", [
    { organization_id: orgA.id, user_id: alice.id, role: "owner" },
    { organization_id: orgA.id, user_id: chloe.id, role: "member" },
    { organization_id: orgB.id, user_id: bruno.id, role: "owner" },
  ]);

  const [kanban] = await srv("GET", "/rest/v1/tools?slug=eq.kanban&select=id");
  await srv("POST", "/rest/v1/organization_tools", [
    { organization_id: orgA.id, tool_id: kanban.id },
  ]);
  await srv("POST", "/rest/v1/organization_tools", [
    { organization_id: orgB.id, tool_id: kanban.id },
  ]);

  const [board] = await srv("POST", "/rest/v1/boards", {
    organization_id: orgA.id,
    name: "Tableau Alpha",
  });
  const [liste] = await srv("POST", "/rest/v1/lists", {
    board_id: board.id,
    name: "À faire",
    position: 1024,
  });

  const tokenAlice = await session(alice.email, alice.password);
  const tokenChloe = await session(chloe.email, chloe.password);
  const tokenBruno = await session(bruno.email, bruno.password);
  console.log("  Alice et Chloé chez Alpha, Bruno chez Bravo");

  console.log("\n=== 1. Abonnement au canal du tableau ===");
  const chezChloe = await abonne(tokenChloe, board.id, "chloe");
  const chezBruno = await abonne(tokenBruno, board.id, "bruno");
  abonnes.push(chezChloe, chezBruno);

  verifie("Chloé (membre) est abonnée", chezChloe.statut === "SUBSCRIBED", chezChloe.statut);
  verifie(
    "Bruno (autre organisation) est abonné au canal — la RLS décide de ce qu'il reçoit",
    chezBruno.statut === "SUBSCRIBED",
    chezBruno.statut,
  );

  console.log("\n=== 2. Alice travaille, Chloé voit ===");
  const debut = Date.now();
  const carte = await ecrire(tokenAlice, "/cards", {
    board_id: board.id,
    list_id: liste.id,
    title: "Carte temoin",
    position: 1024,
    created_by: alice.id,
  });
  verifie("Alice crée une carte", carte.status === 201, `statut ${carte.status}`);
  const carteId = carte.body?.[0]?.id;

  await ecrire(tokenAlice, "/comments", {
    card_id: carteId,
    board_id: board.id,
    user_id: alice.id,
    body: "Premier commentaire",
  });
  await ecrire(tokenAlice, `/lists?id=eq.${liste.id}`, { name: "En préparation" }, "PATCH");

  await patiente(2500);
  const delai = Date.now() - debut;

  const vus = (recus, table, type) =>
    recus.filter((e) => e.table === table && e.type === type).length;

  verifie(
    "Chloé reçoit la création de carte",
    vus(chezChloe.recus, "cards", "INSERT") === 1,
    JSON.stringify(chezChloe.recus.map((e) => `${e.table}/${e.type}`)),
  );
  verifie("Chloé reçoit le commentaire", vus(chezChloe.recus, "comments", "INSERT") === 1);
  verifie("Chloé reçoit le renommage de liste", vus(chezChloe.recus, "lists", "UPDATE") === 1);
  verifie("le tout en moins de deux secondes", delai < 4500, `${delai} ms (attente incluse)`);

  console.log("\n=== 3. Bruno ne reçoit rien ===");
  verifie(
    "aucun événement du tableau d'Alpha ne lui parvient",
    chezBruno.recus.length === 0,
    JSON.stringify(chezBruno.recus.map((e) => `${e.table}/${e.type}`)),
  );

  /*
   * Les deux façons de perdre l'accès, canal déjà ouvert : Realtime rejoue la
   * RLS à chaque événement, un abonnement en cours ne fige donc pas les droits
   * qu'on avait au moment de s'abonner.
   */
  console.log("\n=== 4. Outil coupé, canal déjà ouvert ===");
  // Clé composite : cette table n'a pas de colonne `id`.
  await srv(
    "DELETE",
    `/rest/v1/organization_tools?organization_id=eq.${orgA.id}&tool_id=eq.${kanban.id}`,
  );
  await patiente(2000);

  const avant = chezChloe.recus.length;
  await ecrire(tokenAlice, `/cards?id=eq.${carteId}`, { title: "Apres coupure" }, "PATCH");
  await patiente(3000);

  verifie(
    "le canal se tait dès que le kanban est désactivé",
    chezChloe.recus.length === avant,
    JSON.stringify(chezChloe.recus.slice(avant).map((e) => `${e.table}/${e.type}`)),
  );

  console.log("\n=== 5. Membre retiré, canal déjà ouvert ===");
  await srv(
    "DELETE",
    `/rest/v1/memberships?organization_id=eq.${orgA.id}&user_id=eq.${chloe.id}`,
  );
  await patiente(2000);

  const avant2 = chezChloe.recus.length;
  await ecrire(tokenAlice, `/cards?id=eq.${carteId}`, { title: "Apres retrait" }, "PATCH");
  await patiente(3000);

  verifie(
    "le canal se tait dès que le membre est retiré",
    chezChloe.recus.length === avant2,
    JSON.stringify(chezChloe.recus.slice(avant2).map((e) => `${e.table}/${e.type}`)),
  );

  const lecture = await fetch(`${SB}/rest/v1/cards?id=eq.${carteId}&select=title`, {
    headers: { apikey: AK, Authorization: `Bearer ${tokenChloe}` },
  });
  const vues = await lecture.json();
  verifie(
    "et l'API REST ne lui répond plus rien non plus",
    Array.isArray(vues) && vues.length === 0,
    JSON.stringify(vues),
  );

} catch (erreur) {
  echecs++;
  console.error("\nERREUR :", erreur.message);
} finally {
  console.log("\n=== Nettoyage ===");
  for (const { client, canal } of abonnes) {
    await client.removeChannel(canal).catch(() => undefined);
    client.realtime.disconnect();
  }
  for (const id of organisations) {
    await srv("DELETE", `/rest/v1/organizations?id=eq.${id}`);
  }
  for (const id of comptes) await srv("DELETE", `/auth/v1/admin/users/${id}`);
  const restants = await srv("GET", "/rest/v1/boards?select=name");
  console.log("  tableaux restants :", JSON.stringify(restants));

  console.log(`\n${reussites} succès, ${echecs} échec(s).`);
  process.exit(echecs === 0 ? 0 : 1);
}
