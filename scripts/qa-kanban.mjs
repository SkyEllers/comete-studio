// ===========================================================================
// QA du cloisonnement du kanban — CLAUDE.md §7, chantier 1 de la phase 2.
//
// Trois comptes, deux organisations. On attaque l'API Supabase directement,
// avec de vrais jetons de session : c'est la RLS qui est testée, pas l'app.
//
//   node scripts/qa-kanban.mjs
//
// Aucune valeur sensible ici : les clés sont lues dans .env.local. Les comptes
// et organisations créés sont supprimés à la fin, par identifiant — rien
// d'autre n'est touché.
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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

const motDePasse = () => "Qa1!" + crypto.randomBytes(12).toString("base64url");

/** Appel avec la clé secrète : contourne la RLS, sert au montage et au ménage. */
async function srv(method, path, body) {
  const res = await fetch(`${SB}${path}`, {
    method,
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

/** Appel avec un vrai jeton de session : c'est la RLS qui répond. */
async function as(token, method, path, body) {
  const res = await fetch(`${SB}/rest/v1${path}`, {
    method,
    headers: {
      apikey: AK,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function connexion(email, password) {
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

const comptes = [];
const organisations = [];

async function menage() {
  console.log("\n=== Nettoyage ===");
  for (const id of organisations) await srv("DELETE", `/rest/v1/organizations?id=eq.${id}`);
  for (const id of comptes) await srv("DELETE", `/auth/v1/admin/users/${id}`);
  const restants = await srv("GET", "/rest/v1/boards?select=name");
  const profils = await srv("GET", "/rest/v1/profiles?select=email");
  console.log("  tableaux restants :", JSON.stringify(restants.body));
  console.log("  profils restants  :", JSON.stringify(profils.body));
}

async function creerCompte(email, nom) {
  const password = motDePasse();
  const { body } = await srv("POST", "/auth/v1/admin/users", {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: nom },
  });
  if (!body.id) throw new Error(`création impossible : ${email} — ${JSON.stringify(body)}`);
  comptes.push(body.id);
  return { id: body.id, email, password };
}

try {
  console.log("=== Préparation ===");
  const suffixe = crypto.randomBytes(3).toString("hex");
  const alice = await creerCompte(`qa-kb-alice-${suffixe}@example.com`, "Alice Alpha");
  const bruno = await creerCompte(`qa-kb-bruno-${suffixe}@example.com`, "Bruno Bravo");
  const chloe = await creerCompte(`qa-kb-chloe-${suffixe}@example.com`, "Chloé Alpha");

  const [orgA] = (await srv("POST", "/rest/v1/organizations", {
    name: "QA Kanban Alpha",
    slug: `qa-kb-alpha-${suffixe}`,
  })).body;
  const [orgB] = (await srv("POST", "/rest/v1/organizations", {
    name: "QA Kanban Bravo",
    slug: `qa-kb-bravo-${suffixe}`,
  })).body;
  organisations.push(orgA.id, orgB.id);

  await srv("POST", "/rest/v1/memberships", [
    { organization_id: orgA.id, user_id: alice.id, role: "owner" },
    { organization_id: orgA.id, user_id: chloe.id, role: "member" },
    { organization_id: orgB.id, user_id: bruno.id, role: "owner" },
  ]);

  const [kanban] = (await srv("GET", "/rest/v1/tools?slug=eq.kanban&select=id")).body;
  await srv("POST", "/rest/v1/organization_tools", [
    { organization_id: orgA.id, tool_id: kanban.id },
    { organization_id: orgB.id, tool_id: kanban.id },
  ]);

  const tA = await connexion(alice.email, alice.password);
  const tB = await connexion(bruno.email, bruno.password);
  const tC = await connexion(chloe.email, chloe.password);
  console.log("  Alice (owner) et Chloé (membre) chez Alpha, Bruno (owner) chez Bravo");
  console.log("  Kanban activé pour les deux organisations");

  console.log("\n=== 1. Alice monte un tableau ===");
  const creationTableau = await as(tA, "POST", "/boards", {
    organization_id: orgA.id,
    name: "Idées",
    created_by: alice.id,
  });
  const tableau = creationTableau.body[0];
  verifie("Alice crée un tableau dans son organisation", Boolean(tableau?.id), JSON.stringify(creationTableau.body));

  const [liste] = (await as(tA, "POST", "/lists", {
    board_id: tableau.id,
    name: "À faire",
    position: 1024,
  })).body;
  verifie("Alice crée une liste", Boolean(liste?.id));

  const [carte] = (await as(tA, "POST", "/cards", {
    board_id: tableau.id,
    list_id: liste.id,
    title: "Première idée",
    position: 1024,
    created_by: alice.id,
  })).body;
  verifie("Alice crée une carte", Boolean(carte?.id));

  console.log("\n=== 2. Bruno, d'une autre organisation, ne voit rien ===");
  const boardsVusParBruno = await as(tB, "GET", "/boards?select=id,name");
  verifie("select boards ne renvoie rien", Array.isArray(boardsVusParBruno.body) && boardsVusParBruno.body.length === 0, JSON.stringify(boardsVusParBruno.body));

  const cartesVuesParBruno = await as(tB, "GET", "/cards?select=id,title");
  verifie("select cards ne renvoie rien", Array.isArray(cartesVuesParBruno.body) && cartesVuesParBruno.body.length === 0, JSON.stringify(cartesVuesParBruno.body));

  const listesVuesParBruno = await as(tB, "GET", "/lists?select=id,name");
  verifie("select lists ne renvoie rien", Array.isArray(listesVuesParBruno.body) && listesVuesParBruno.body.length === 0);

  console.log("\n=== 3. Bruno tente d'écrire chez Alpha ===");
  const insertBoard = await as(tB, "POST", "/boards", {
    organization_id: orgA.id,
    name: "Tableau pirate",
  });
  verifie("insert d'un tableau dans l'organisation d'Alice refusé", insertBoard.status >= 400, `statut ${insertBoard.status}`);

  const insertCarte = await as(tB, "POST", "/cards", {
    board_id: tableau.id,
    list_id: liste.id,
    title: "Carte pirate",
    position: 2048,
  });
  verifie("insert d'une carte dans le tableau d'Alice refusé", insertCarte.status >= 400, `statut ${insertCarte.status}`);

  const updateCarte = await as(tB, "PATCH", `/cards?id=eq.${carte.id}`, { title: "Détournée" });
  verifie("update de la carte d'Alice sans effet", Array.isArray(updateCarte.body) && updateCarte.body.length === 0);

  const deleteCarte = await as(tB, "DELETE", `/cards?id=eq.${carte.id}`);
  verifie("delete de la carte d'Alice sans effet", Array.isArray(deleteCarte.body) && deleteCarte.body.length === 0);

  const deleteBoard = await as(tB, "DELETE", `/boards?id=eq.${tableau.id}`);
  verifie("delete du tableau d'Alice sans effet", Array.isArray(deleteBoard.body) && deleteBoard.body.length === 0);

  const toujoursLa = await as(tA, "GET", `/cards?id=eq.${carte.id}&select=title`);
  verifie("la carte d'Alice est intacte", toujoursLa.body[0]?.title === "Première idée");

  console.log("\n=== 4. Commentaires : on n'écrit que les siens ===");
  const monCommentaire = await as(tA, "POST", "/comments", {
    card_id: carte.id,
    board_id: tableau.id,
    user_id: alice.id,
    body: "Bonne piste.",
  });
  verifie("Alice commente en son nom", monCommentaire.status < 400, `statut ${monCommentaire.status}`);

  const commentaireUsurpe = await as(tA, "POST", "/comments", {
    card_id: carte.id,
    board_id: tableau.id,
    user_id: chloe.id,
    body: "Signé Chloé.",
  });
  verifie("Alice ne peut pas commenter au nom de Chloé", commentaireUsurpe.status >= 400, `statut ${commentaireUsurpe.status}`);

  const commentaireId = monCommentaire.body[0]?.id;
  const editionParChloe = await as(tC, "PATCH", `/comments?id=eq.${commentaireId}`, { body: "Réécrit" });
  verifie("Chloé ne peut pas modifier le commentaire d'Alice", Array.isArray(editionParChloe.body) && editionParChloe.body.length === 0);

  console.log("\n=== 5. Chloé, membre de la même organisation ===");
  const cartesVuesParChloe = await as(tC, "GET", "/cards?select=id,title");
  verifie("Chloé voit les cartes du tableau", cartesVuesParChloe.body.length === 1);

  const carteDeChloe = await as(tC, "POST", "/cards", {
    board_id: tableau.id,
    list_id: liste.id,
    title: "Idée de Chloé",
    position: 2048,
    created_by: chloe.id,
  });
  verifie("Chloé crée une carte", carteDeChloe.status < 400, `statut ${carteDeChloe.status}`);

  const suppressionParChloe = await as(tC, "DELETE", `/boards?id=eq.${tableau.id}`);
  verifie("Chloé (membre) ne supprime pas le tableau", Array.isArray(suppressionParChloe.body) && suppressionParChloe.body.length === 0);

  console.log("\n=== 6. Outil coupé pour Alpha ===");
  await srv("PATCH", `/rest/v1/organization_tools?organization_id=eq.${orgA.id}&tool_id=eq.${kanban.id}`, { enabled: false });
  const apresCoupure = await as(tA, "GET", "/boards?select=id");
  verifie("Alice ne voit plus ses tableaux", Array.isArray(apresCoupure.body) && apresCoupure.body.length === 0, JSON.stringify(apresCoupure.body));
  const cartesApresCoupure = await as(tA, "GET", "/cards?select=id");
  verifie("ni ses cartes", Array.isArray(cartesApresCoupure.body) && cartesApresCoupure.body.length === 0);
  const ecritureApresCoupure = await as(tA, "PATCH", `/cards?id=eq.${carte.id}`, { title: "Bloquée" });
  verifie("ni ne peut les modifier", Array.isArray(ecritureApresCoupure.body) && ecritureApresCoupure.body.length === 0);

  console.log("\n=== 7. Outil réactivé ===");
  await srv("PATCH", `/rest/v1/organization_tools?organization_id=eq.${orgA.id}&tool_id=eq.${kanban.id}`, { enabled: true });
  const apresRetour = await as(tA, "GET", "/boards?select=id,name");
  verifie("les tableaux reviennent", apresRetour.body.length === 1 && apresRetour.body[0].name === "Idées");
  const cartesApresRetour = await as(tA, "GET", "/cards?select=title&order=position");
  verifie("les cartes sont intactes", cartesApresRetour.body.length === 2, JSON.stringify(cartesApresRetour.body));

  console.log("\n=== 8. Suppression par la propriétaire ===");
  const suppressionParAlice = await as(tA, "DELETE", `/boards?id=eq.${tableau.id}`);
  verifie("Alice (owner) supprime le tableau", Array.isArray(suppressionParAlice.body) && suppressionParAlice.body.length === 1);
  const cartesOrphelines = await srv("GET", `/rest/v1/cards?board_id=eq.${tableau.id}&select=id`);
  verifie("les cartes partent en cascade", cartesOrphelines.body.length === 0);
  const commentairesOrphelins = await srv("GET", `/rest/v1/comments?board_id=eq.${tableau.id}&select=id`);
  verifie("les commentaires aussi", commentairesOrphelins.body.length === 0);
} catch (erreur) {
  echecs++;
  console.error("\nERREUR :", erreur.message);
} finally {
  await menage();
  console.log(`\n${reussites} contrôle(s) au vert, ${echecs} en échec.`);
  process.exit(echecs === 0 ? 0 : 1);
}
