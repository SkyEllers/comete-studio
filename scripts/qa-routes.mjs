/**
 * Banc des gardes — ce que l'application répond, route par route.
 *
 *   npm run build
 *   npx next start -p 3100          (dans un autre terminal)
 *   npm run qa:routes
 *
 * Le banc se connecte pour de vrai et laisse `@supabase/ssr` écrire ses
 * propres cookies de session : ce sont donc bien `requireMembership`,
 * `requireToolAccess` et `requireAdmin` qui sont mis à l'épreuve, à travers
 * les codes de réponse HTTP.
 *
 * `QA_BASE` permet de viser autre chose que le serveur local — un preview
 * Vercel, par exemple.
 *
 * Écrit dans le projet Supabase lié, puis nettoie derrière lui.
 */
import { createServerClient } from "@supabase/ssr";

import {
  annoncerCible,
  creer,
  creerCompte,
  journal,
  motDePasse,
  srv,
  supprimerCompte,
  ANON,
  SUPABASE,
} from "./qa-commun.mjs";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:3100";
const { verifie, bilan } = journal();

annoncerCible(`QA — gardes de l'application\nServeur visé : ${BASE}`);

/** Connexion via @supabase/ssr : la bibliothèque écrit elle-même ses cookies. */
async function cookiesDeSession(email) {
  const bocal = new Map();

  const client = createServerClient(SUPABASE, ANON, {
    cookies: {
      getAll: () => [...bocal].map(([name, value]) => ({ name, value })),
      setAll: (aPoser) => aPoser.forEach(({ name, value }) => bocal.set(name, value)),
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw new Error(`connexion ${email} : ${error.message}`);
  if (bocal.size === 0) throw new Error("aucun cookie de session n'a été écrit");

  return [...bocal].map(([nom, valeur]) => `${nom}=${encodeURIComponent(valeur)}`).join("; ");
}

async function visite(cookie, chemin) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  return { status: reponse.status, headers: reponse.headers, corps: await reponse.text() };
}

const marque = Date.now();
const emails = { a: `zz-qa-ra-${marque}@example.com`, b: `zz-qa-rb-${marque}@example.com` };
const comptes = {};
const orgs = {};

// Avant toute écriture : si le serveur ne répond pas, on s'arrête ici plutôt
// que de créer un décor à nettoyer et d'afficher un bilan qui ne veut rien dire.
if (!(await fetch(BASE, { redirect: "manual" }).catch(() => null))) {
  console.error(
    `${BASE} ne répond pas. Lance d'abord \`npm run build\`, puis \`npx next start -p 3100\` dans un autre terminal.`,
  );
  process.exit(1);
}

try {
  // --------------------------------- décor ---------------------------------
  comptes.a = await creerCompte(emails.a);
  comptes.b = await creerCompte(emails.b);

  orgs.a = await creer("organizations", { name: "ZZ QA RA", slug: `zz-qa-ra-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA RB", slug: `zz-qa-rb-${marque}` });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.a, role: "owner" });
  await creer("memberships", { organization_id: orgs.b.id, user_id: comptes.b, role: "owner" });

  // Kanban pour A seulement : c'est ce qui rend le 404 de B parlant.
  const outilId = (await srv("GET", "tools?select=id&slug=eq.kanban")).data[0].id;
  await creer("organization_tools", { organization_id: orgs.a.id, tool_id: outilId, enabled: true });

  const board = await creer("boards", {
    organization_id: orgs.a.id,
    name: "Tableau QA",
    color: "ember",
    position: 1024,
  });
  const list = await creer("lists", { board_id: board.id, name: "Liste", position: 1024 });
  const card = await creer("cards", {
    board_id: board.id,
    list_id: list.id,
    title: "Carte",
    position: 1024,
  });

  const ca = await cookiesDeSession(emails.a);
  const cb = await cookiesDeSession(emails.b);
  const sa = `/app/${orgs.a.slug}`;
  const sb = `/app/${orgs.b.slug}`;

  console.log("== 1. Le membre de A ==");
  const dispatch = await visite(ca, "/app");
  verifie(
    "A · /app redirige vers son unique espace",
    [302, 307].includes(dispatch.status) && (dispatch.headers.get("location") ?? "").endsWith(sa),
    `status ${dispatch.status} → ${dispatch.headers.get("location")}`,
  );
  verifie(`A · ${sa}`, (await visite(ca, sa)).status === 200);
  verifie(`A · ${sa}/kanban`, (await visite(ca, `${sa}/kanban`)).status === 200);
  verifie("A · son tableau", (await visite(ca, `${sa}/kanban/${board.id}`)).status === 200);
  verifie("A · sa carte en lien direct", (await visite(ca, `${sa}/kanban/${board.id}?card=${card.id}`)).status === 200);
  verifie(`A · ${sb} → 404`, (await visite(ca, sb)).status === 404);
  verifie(`A · ${sb}/kanban → 404`, (await visite(ca, `${sb}/kanban`)).status === 404);
  verifie("A · /admin → 404", (await visite(ca, "/admin")).status === 404);
  verifie("A · /admin/clients → 404", (await visite(ca, "/admin/clients")).status === 404);

  console.log("\n== 2. Le membre de B, sans Kanban ==");
  verifie(`B · ${sb}`, (await visite(cb, sb)).status === 200);
  verifie(`B · ${sb}/kanban → 404 (outil non activé)`, (await visite(cb, `${sb}/kanban`)).status === 404);
  verifie(`B · ${sa} → 404`, (await visite(cb, sa)).status === 404);
  verifie(`B · ${sa}/kanban → 404`, (await visite(cb, `${sa}/kanban`)).status === 404);
  verifie("B · le tableau de A → 404", (await visite(cb, `${sa}/kanban/${board.id}`)).status === 404);
  verifie("B · le tableau de A sous son propre espace → 404", (await visite(cb, `${sb}/kanban/${board.id}`)).status === 404);
  verifie("B · /admin → 404", (await visite(cb, "/admin")).status === 404);

  console.log("\n== 3. Kanban coupé pour A, sans reconnexion ==");
  const basculer = (enabled) =>
    srv("PATCH", `organization_tools?organization_id=eq.${orgs.a.id}&tool_id=eq.${outilId}`, { enabled });

  await basculer(false);
  verifie("A · kanban → 404 immédiatement", (await visite(ca, `${sa}/kanban`)).status === 404);
  verifie("A · son tableau → 404", (await visite(ca, `${sa}/kanban/${board.id}`)).status === 404);
  verifie("A · son espace reste accessible", (await visite(ca, sa)).status === 200);

  await basculer(true);
  verifie("A · kanban revient", (await visite(ca, `${sa}/kanban`)).status === 200);
  verifie("A · son tableau revient", (await visite(ca, `${sa}/kanban/${board.id}`)).status === 200);
  verifie("cartes toujours là", (await srv("GET", `cards?select=id&board_id=eq.${board.id}`)).data.length === 1);

  console.log("\n== 4. Membre retiré de son organisation ==");
  await srv("DELETE", `memberships?organization_id=eq.${orgs.a.id}&user_id=eq.${comptes.a}`);
  verifie(`A retiré · ${sa} → 404`, (await visite(ca, sa)).status === 404);

  const orphelin = await visite(ca, "/app");
  verifie(
    "A retiré · /app affiche « aucun espace »",
    orphelin.status === 200 && /aucun espace/i.test(orphelin.corps),
    `status ${orphelin.status}`,
  );
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.a, role: "owner" });

  console.log("\n== 5. Sans session ==");
  const anonyme = await visite(null, sa);
  verifie(
    "anonyme · redirigé vers la connexion",
    [302, 303, 307, 308].includes(anonyme.status),
    `status ${anonyme.status} → ${anonyme.headers.get("location")}`,
  );
  verifie("anonyme · page de connexion servie", (await visite(null, "/")).status === 200);

  console.log("\n== 6. Rien n'est indexable ==");
  for (const [chemin, cookie] of [
    ["/", null],
    ["/mentions-legales", null],
    [sa, ca],
    [`${sa}/kanban`, ca],
  ]) {
    const reponse = await visite(cookie, chemin);
    const entete = reponse.headers.get("x-robots-tag") ?? "absent";
    verifie(`noindex sur ${chemin}`, entete.includes("noindex"), entete);
  }

  const robots = await visite(null, "/robots.txt");
  verifie(
    "robots.txt en Disallow: /",
    robots.status === 200 && robots.corps.includes("Disallow: /"),
    robots.corps.trim().replace(/\n/g, " | "),
  );
} finally {
  console.log("\n== Nettoyage ==");
  for (const org of Object.values(orgs)) {
    if (org?.id) await srv("DELETE", `organizations?id=eq.${org.id}`);
  }
  for (const id of Object.values(comptes)) {
    if (id) await supprimerCompte(id);
  }

  const orgsRestantes = (await srv("GET", "organizations?select=slug&slug=like.zz-qa-*")).data;
  const profilsRestants = (await srv("GET", "profiles?select=email&email=like.zz-qa-*")).data;
  verifie("aucune organisation de test ne subsiste", orgsRestantes.length === 0, JSON.stringify(orgsRestantes));
  verifie("aucun compte de test ne subsiste", profilsRestants.length === 0, JSON.stringify(profilsRestants));

  bilan();
}
