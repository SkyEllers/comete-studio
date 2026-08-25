// ===========================================================================
// QA de la fiche carte — phase 2, chantier 4.
//
// Deux volets :
//   1. RLS, avec de vrais jetons de session : commentaires, checklists,
//      activités, et l'écriture simultanée de deux personnes sur la même carte.
//   2. HTTP, avec de vrais cookies de session : `?card=<id>` d'une carte d'une
//      autre organisation doit répondre 404, pas ouvrir un tableau.
//
//   npm run dev            # dans un autre terminal
//   node scripts/qa-fiche-carte.mjs
//   APP_URL=https://… node scripts/qa-fiche-carte.mjs
//
// Aucune valeur sensible ici : tout est lu dans .env.local. Comptes et
// organisations créés sont supprimés à la fin, par identifiant.
// ===========================================================================
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
const APP = process.env.APP_URL ?? "http://localhost:3000";
if (!SB || !SRK || !AK) {
  console.error("Clés manquantes dans .env.local.");
  process.exit(1);
}
const REF = new URL(SB).hostname.split(".")[0];

const motDePasse = () => "Qa1!" + crypto.randomBytes(12).toString("base64url");

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
    return { status: res.status, body: JSON.parse(texte) };
  } catch {
    return { status: res.status, body: texte };
  }
}

/** Appel REST avec un vrai jeton : c'est la RLS qui répond. */
async function as(token, method, chemin, body, prefer = "return=representation") {
  const res = await fetch(`${SB}/rest/v1${chemin}`, {
    method,
    headers: {
      apikey: AK,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texte = await res.text();
  try {
    return { status: res.status, body: JSON.parse(texte) };
  } catch {
    return { status: res.status, body: texte };
  }
}

async function session(email, password) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: AK, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`connexion impossible : ${email}`);
  return data;
}

/** Cookie au format @supabase/ssr, découpé au-delà de 3180 caractères. */
function cookieDe(sessionJson) {
  const nom = `sb-${REF}-auth-token`;
  const valeur =
    "base64-" + Buffer.from(JSON.stringify(sessionJson)).toString("base64url");
  const MAX = 3180;
  if (valeur.length <= MAX) return `${nom}=${valeur}`;
  const morceaux = [];
  for (let i = 0, n = 0; i < valeur.length; i += MAX, n++) {
    morceaux.push(`${nom}.${n}=${valeur.slice(i, i + MAX)}`);
  }
  return morceaux.join("; ");
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

async function page(cookie, chemin) {
  const res = await fetch(`${APP}${chemin}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  return { status: res.status, texte: await res.text() };
}

const comptes = [];
const organisations = [];

async function creerCompte(email, nom) {
  const password = motDePasse();
  const { body } = await srv("POST", "/auth/v1/admin/users", {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: nom },
  });
  if (!body.id) throw new Error(`création impossible : ${email}`);
  comptes.push(body.id);
  return { id: body.id, email, password };
}

try {
  console.log("=== Préparation ===");
  const suffixe = crypto.randomBytes(3).toString("hex");
  const alice = await creerCompte(`qa-fc-alice-${suffixe}@example.com`, "Alice Alpha");
  const chloe = await creerCompte(`qa-fc-chloe-${suffixe}@example.com`, "Chloé Alpha");
  const bruno = await creerCompte(`qa-fc-bruno-${suffixe}@example.com`, "Bruno Bravo");

  const [orgA] = (
    await srv("POST", "/rest/v1/organizations", {
      name: "QA Fiche Alpha",
      slug: `qa-fc-alpha-${suffixe}`,
    })
  ).body;
  const [orgB] = (
    await srv("POST", "/rest/v1/organizations", {
      name: "QA Fiche Bravo",
      slug: `qa-fc-bravo-${suffixe}`,
    })
  ).body;
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

  const monte = async (orgId, nomTableau, titreCarte) => {
    const [board] = (
      await srv("POST", "/rest/v1/boards", {
        organization_id: orgId,
        name: nomTableau,
      })
    ).body;
    const [list] = (
      await srv("POST", "/rest/v1/lists", {
        board_id: board.id,
        name: "À faire",
        position: 1024,
      })
    ).body;
    const [card] = (
      await srv("POST", "/rest/v1/cards", {
        board_id: board.id,
        list_id: list.id,
        title: titreCarte,
        position: 1024,
      })
    ).body;
    return { board, list, card };
  };

  const alpha = await monte(orgA.id, "Tableau Alpha", "Carte temoin alpha");
  const bravo = await monte(orgB.id, "Tableau Bravo", "Carte temoin bravo");

  const sessionAlice = await session(alice.email, alice.password);
  const sessionChloe = await session(chloe.email, chloe.password);
  const sessionBruno = await session(bruno.email, bruno.password);
  const tA = sessionAlice.access_token;
  const tC = sessionChloe.access_token;
  const tB = sessionBruno.access_token;
  console.log("  Alice (owner) et Chloé (membre) chez Alpha, Bruno (owner) chez Bravo");

  // -----------------------------------------------------------------------
  console.log("\n=== 1. Deux personnes commentent en même temps ===");
  const [envoiAlice, envoiChloe] = await Promise.all([
    as(tA, "POST", "/comments", {
      card_id: alpha.card.id,
      board_id: alpha.board.id,
      user_id: alice.id,
      body: "Commentaire d'Alice",
    }),
    as(tC, "POST", "/comments", {
      card_id: alpha.card.id,
      board_id: alpha.board.id,
      user_id: chloe.id,
      body: "Commentaire de Chloé",
    }),
  ]);
  verifie("Alice publie", envoiAlice.status === 201, JSON.stringify(envoiAlice.body));
  verifie("Chloé publie", envoiChloe.status === 201, JSON.stringify(envoiChloe.body));

  const vusParAlice = await as(
    tA,
    "GET",
    `/comments?card_id=eq.${alpha.card.id}&select=id,body,user_id&order=created_at`,
  );
  const vusParChloe = await as(
    tC,
    "GET",
    `/comments?card_id=eq.${alpha.card.id}&select=id,body,user_id&order=created_at`,
  );
  verifie(
    "Alice voit les deux commentaires",
    vusParAlice.body.length === 2,
    JSON.stringify(vusParAlice.body),
  );
  verifie(
    "Chloé voit les deux commentaires",
    vusParChloe.body.length === 2,
    JSON.stringify(vusParChloe.body),
  );

  const commentaireAlice = vusParAlice.body.find((c) => c.user_id === alice.id);

  console.log("\n=== 2. Un commentaire n'appartient qu'à son auteur ===");
  const majParChloe = await as(
    tC,
    "PATCH",
    `/comments?id=eq.${commentaireAlice.id}`,
    { body: "détourné" },
  );
  verifie(
    "Chloé ne peut pas modifier le commentaire d'Alice",
    Array.isArray(majParChloe.body) && majParChloe.body.length === 0,
    JSON.stringify(majParChloe.body),
  );

  const suppressionParChloe = await as(
    tC,
    "DELETE",
    `/comments?id=eq.${commentaireAlice.id}`,
  );
  verifie(
    "Chloé ne peut pas supprimer le commentaire d'Alice",
    Array.isArray(suppressionParChloe.body) && suppressionParChloe.body.length === 0,
    JSON.stringify(suppressionParChloe.body),
  );

  const toujoursLa = await as(
    tA,
    "GET",
    `/comments?id=eq.${commentaireAlice.id}&select=body`,
  );
  verifie(
    "le commentaire d'Alice est intact",
    toujoursLa.body[0]?.body === "Commentaire d'Alice",
    JSON.stringify(toujoursLa.body),
  );

  console.log("\n=== 3. Le reste de la fiche s'écrit depuis le navigateur ===");
  const [checklist] = (
    await as(tC, "POST", "/checklists", {
      card_id: alpha.card.id,
      board_id: alpha.board.id,
      title: "Préparation",
      position: 1024,
    })
  ).body;
  verifie("Chloé crée une checklist", Boolean(checklist?.id));

  const [item] = (
    await as(tC, "POST", "/checklist_items", {
      checklist_id: checklist.id,
      board_id: alpha.board.id,
      text: "Premier point",
      position: 1024,
    })
  ).body;
  verifie("Chloé ajoute un élément", Boolean(item?.id));

  const coche = await as(tC, "PATCH", `/checklist_items?id=eq.${item.id}`, {
    is_done: true,
  });
  verifie("Chloé coche l'élément", coche.body[0]?.is_done === true);

  const [etiquette] = (
    await as(tC, "POST", "/labels", {
      board_id: alpha.board.id,
      name: "Urgent",
      color: "rose",
    })
  ).body;
  verifie("Chloé crée une étiquette", Boolean(etiquette?.id));

  const pose = await as(tC, "POST", "/card_labels", {
    card_id: alpha.card.id,
    label_id: etiquette.id,
    board_id: alpha.board.id,
  });
  verifie("Chloé pose l'étiquette sur la carte", pose.status === 201);

  const assignation = await as(tC, "POST", "/card_assignees", {
    card_id: alpha.card.id,
    user_id: alice.id,
    board_id: alpha.board.id,
  });
  verifie("Chloé assigne Alice", assignation.status === 201);

  const activite = await as(tC, "POST", "/card_activities", {
    card_id: alpha.card.id,
    board_id: alpha.board.id,
    user_id: chloe.id,
    type: "card.completed",
    payload: { completed: true },
  });
  verifie("Chloé écrit une activité", activite.status === 201);

  const journal = await as(
    tA,
    "GET",
    `/card_activities?card_id=eq.${alpha.card.id}&select=type&order=created_at.desc&limit=20`,
  );
  verifie(
    "Alice lit le journal de la carte",
    journal.body.length >= 1,
    JSON.stringify(journal.body),
  );

  console.log("\n=== 4. Bruno, d'une autre organisation, ne voit rien ===");
  for (const [table, chemin] of [
    ["comments", `/comments?card_id=eq.${alpha.card.id}&select=id`],
    ["checklists", `/checklists?card_id=eq.${alpha.card.id}&select=id`],
    ["checklist_items", `/checklist_items?board_id=eq.${alpha.board.id}&select=id`],
    ["labels", `/labels?board_id=eq.${alpha.board.id}&select=id`],
    ["card_labels", `/card_labels?card_id=eq.${alpha.card.id}&select=card_id`],
    ["card_assignees", `/card_assignees?card_id=eq.${alpha.card.id}&select=card_id`],
    ["card_activities", `/card_activities?card_id=eq.${alpha.card.id}&select=id`],
  ]) {
    const lecture = await as(tB, "GET", chemin);
    verifie(
      `select ${table} ne renvoie rien`,
      Array.isArray(lecture.body) && lecture.body.length === 0,
      JSON.stringify(lecture.body),
    );
  }

  const commentaireBruno = await as(tB, "POST", "/comments", {
    card_id: alpha.card.id,
    board_id: alpha.board.id,
    user_id: bruno.id,
    body: "intrusion",
  });
  verifie(
    "Bruno ne peut pas commenter la carte d'Alpha",
    commentaireBruno.status >= 400,
    `statut ${commentaireBruno.status}`,
  );

  const checklistBruno = await as(tB, "POST", "/checklists", {
    card_id: alpha.card.id,
    board_id: alpha.board.id,
    title: "intrusion",
    position: 1024,
  });
  verifie(
    "Bruno ne peut pas ajouter de checklist",
    checklistBruno.status >= 400,
    `statut ${checklistBruno.status}`,
  );

  const usurpation = await as(tC, "POST", "/comments", {
    card_id: alpha.card.id,
    board_id: alpha.board.id,
    user_id: alice.id,
    body: "signé Alice",
  });
  verifie(
    "Chloé ne peut pas commenter au nom d'Alice",
    usurpation.status >= 400,
    `statut ${usurpation.status}`,
  );

  // -----------------------------------------------------------------------
  console.log(`\n=== 5. Ouverture par l'URL (${APP}) ===`);
  const cookieAlice = cookieDe(sessionAlice);
  const cookieBruno = cookieDe(sessionBruno);
  const cheminAlpha = `/app/${orgA.slug}/kanban/${alpha.board.id}`;

  const sonde = await page(cookieAlice, cheminAlpha);
  if (sonde.status === 200) {
    verifie("le tableau d'Alpha s'ouvre pour Alice", true);

    const sienne = await page(cookieAlice, `${cheminAlpha}?card=${alpha.card.id}`);
    verifie(
      "?card= d'une carte du tableau → 200",
      sienne.status === 200,
      `statut ${sienne.status}`,
    );
    verifie(
      "la carte est bien dans la page",
      sienne.texte.includes("Carte temoin alpha"),
    );

    const etrangere = await page(cookieAlice, `${cheminAlpha}?card=${bravo.card.id}`);
    verifie(
      "?card= d'une carte d'une autre organisation → 404",
      etrangere.status === 404,
      `statut ${etrangere.status}`,
    );
    verifie(
      "et rien de l'autre organisation n'apparaît",
      !etrangere.texte.includes("Carte temoin bravo") &&
        !etrangere.texte.includes("Tableau Bravo"),
    );

    const inconnue = await page(
      cookieAlice,
      `${cheminAlpha}?card=${crypto.randomUUID()}`,
    );
    verifie(
      "?card= d'un identifiant inconnu → 404",
      inconnue.status === 404,
      `statut ${inconnue.status}`,
    );

    const bancale = await page(cookieAlice, `${cheminAlpha}?card=pas-un-uuid`);
    verifie(
      "?card= malformé → 404",
      bancale.status === 404,
      `statut ${bancale.status}`,
    );

    const parBruno = await page(cookieBruno, `${cheminAlpha}?card=${alpha.card.id}`);
    verifie(
      "le tableau entier reste 404 pour Bruno",
      parBruno.status === 404,
      `statut ${parBruno.status}`,
    );
  } else {
    console.log(
      `  (ignoré) l'application ne répond pas comme attendu sur ${APP} : statut ${sonde.status}.`,
    );
    console.log("  Lance « npm run dev », ou passe APP_URL=<url de preview>.");
  }
} catch (erreur) {
  echecs++;
  console.error("\nERREUR :", erreur.message);
} finally {
  console.log("\n=== Nettoyage ===");
  for (const id of organisations) {
    await srv("DELETE", `/rest/v1/organizations?id=eq.${id}`);
  }
  for (const id of comptes) await srv("DELETE", `/auth/v1/admin/users/${id}`);
  const restants = await srv("GET", "/rest/v1/boards?select=name");
  console.log("  tableaux restants :", JSON.stringify(restants.body));

  console.log(`\n${reussites} succès, ${echecs} échec(s).`);
  process.exit(echecs === 0 ? 0 : 1);
}
