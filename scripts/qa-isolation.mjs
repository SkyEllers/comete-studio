/**
 * Banc d'isolation — ce qu'un compte peut atteindre à travers l'API REST.
 *
 *   npm run qa:isolation
 *
 * Deux organisations, trois comptes, et les dix tables du kanban passées en
 * select / insert / update / delete dans les deux sens. Tout est joué avec de
 * vraies sessions ; la clé secrète ne sert qu'à poser le décor et à constater
 * qu'une ligne refusée n'a effectivement pas bougé.
 *
 * Contrôle interne : le banc contient autant d'autorisations attendues que de
 * refus attendus. Si les jetons étaient invalides, tout serait « refusé » et
 * les sections 3, 6 et 7 tomberaient — un banc tout vert veut donc dire
 * quelque chose.
 *
 * Écrit dans le projet lié, puis nettoie derrière lui et le vérifie.
 */
import {
  annoncerCible,
  connecter,
  creer,
  creerCompte,
  journal,
  par,
  refuse,
  rest,
  srv,
  supprimerCompte,
  vide,
  ANON,
} from "./qa-commun.mjs";

const { verifie, bilan } = journal();
annoncerCible("QA — isolation entre organisations");

const marque = Date.now();
const emails = {
  a: `zz-qa-a-${marque}@example.com`,
  c: `zz-qa-c-${marque}@example.com`,
  b: `zz-qa-b-${marque}@example.com`,
};
const comptes = {};
const orgs = {};

/** Un tableau garni : une ligne dans chacune des dix tables du kanban. */
async function garnir(orgId, proprietaire) {
  const board = await creer("boards", {
    organization_id: orgId,
    name: "Tableau QA",
    color: "ember",
    position: 1024,
  });
  const list = await creer("lists", { board_id: board.id, name: "Liste QA", position: 1024 });
  const card = await creer("cards", {
    board_id: board.id,
    list_id: list.id,
    title: "Carte QA",
    position: 1024,
  });
  const label = await creer("labels", { board_id: board.id, name: "QA", color: "sun" });
  await creer("card_labels", { card_id: card.id, label_id: label.id, board_id: board.id });
  await creer("card_assignees", { card_id: card.id, user_id: proprietaire, board_id: board.id });
  const checklist = await creer("checklists", {
    card_id: card.id,
    board_id: board.id,
    title: "Étapes",
    position: 1024,
  });
  const item = await creer("checklist_items", {
    checklist_id: checklist.id,
    board_id: board.id,
    text: "une ligne",
    position: 1024,
  });
  const comment = await creer("comments", {
    card_id: card.id,
    board_id: board.id,
    user_id: proprietaire,
    body: "un mot",
  });
  const activity = await creer("card_activities", {
    card_id: card.id,
    board_id: board.id,
    user_id: proprietaire,
    type: "card.created",
    payload: {},
  });

  return { board, list, card, label, checklist, item, comment, activity };
}

/**
 * Les dix tables, avec de quoi tenter les quatre opérations.
 *
 * `card_labels` et `card_assignees` n'ont pas de colonne hors clé : pour
 * elles, un update n'aurait rien à dire, on s'en tient au reste.
 */
function surface(cible, orgId, userId) {
  const { board, list, card, label, checklist, item, comment, activity } = cible;

  return [
    { table: "boards", filtre: `id=eq.${board.id}`, maj: { name: "Piraté" },
      insertion: { organization_id: orgId, name: "Intrus", color: "ember", position: 1 } },
    { table: "lists", filtre: `id=eq.${list.id}`, maj: { name: "Piratée" },
      insertion: { board_id: board.id, name: "Intruse", position: 1 } },
    { table: "cards", filtre: `id=eq.${card.id}`, maj: { title: "Piratée" },
      insertion: { board_id: board.id, list_id: list.id, title: "Intruse", position: 1 } },
    { table: "labels", filtre: `id=eq.${label.id}`, maj: { name: "Piratée" },
      insertion: { board_id: board.id, name: "Intruse", color: "rose" } },
    { table: "card_labels", filtre: `card_id=eq.${card.id}`, maj: null,
      insertion: { card_id: card.id, label_id: label.id, board_id: board.id } },
    { table: "card_assignees", filtre: `card_id=eq.${card.id}`, maj: null,
      insertion: { card_id: card.id, user_id: userId, board_id: board.id } },
    { table: "checklists", filtre: `id=eq.${checklist.id}`, maj: { title: "Piratée" },
      insertion: { card_id: card.id, board_id: board.id, title: "Intruse", position: 1 } },
    { table: "checklist_items", filtre: `id=eq.${item.id}`, maj: { text: "piratée" },
      insertion: { checklist_id: checklist.id, board_id: board.id, text: "intruse", position: 1 } },
    { table: "comments", filtre: `id=eq.${comment.id}`, maj: { body: "piraté" },
      insertion: { card_id: card.id, board_id: board.id, user_id: userId, body: "intrus" } },
    { table: "card_activities", filtre: `id=eq.${activity.id}`, maj: { type: "card.moved" },
      insertion: { card_id: card.id, board_id: board.id, user_id: userId, type: "card.moved", payload: {} } },
  ];
}

/** Aucune des quatre opérations ne doit passer, et rien ne doit avoir bougé. */
async function serieRefus(prefixe, appel, cible, orgId, userId) {
  for (const cas of surface(cible, orgId, userId)) {
    const avant = (await srv("GET", `${cas.table}?select=*&${cas.filtre}`)).data;

    verifie(
      `${prefixe} · select ${cas.table}`,
      vide(await appel("GET", `${cas.table}?select=*&${cas.filtre}`)),
    );

    const insertion = await appel("POST", cas.table, cas.insertion);
    verifie(`${prefixe} · insert ${cas.table}`, insertion.status >= 400, `status ${insertion.status}`);

    if (cas.maj) {
      verifie(
        `${prefixe} · update ${cas.table}`,
        refuse(await appel("PATCH", `${cas.table}?${cas.filtre}`, cas.maj)),
      );
    }

    verifie(
      `${prefixe} · delete ${cas.table}`,
      refuse(await appel("DELETE", `${cas.table}?${cas.filtre}`)),
    );

    const apres = (await srv("GET", `${cas.table}?select=*&${cas.filtre}`)).data;
    verifie(`${prefixe} · ${cas.table} intacte`, JSON.stringify(avant) === JSON.stringify(apres));
  }
}

let outilId;

try {
  // --------------------------------- décor ---------------------------------
  comptes.a = await creerCompte(emails.a); // responsable de A
  comptes.c = await creerCompte(emails.c); // simple membre de A
  comptes.b = await creerCompte(emails.b); // membre de B seulement

  orgs.a = await creer("organizations", { name: "ZZ QA A", slug: `zz-qa-a-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA B", slug: `zz-qa-b-${marque}` });

  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.a, role: "owner" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.c, role: "member" });
  await creer("memberships", { organization_id: orgs.b.id, user_id: comptes.b, role: "owner" });

  outilId = (await srv("GET", "tools?select=id&slug=eq.kanban")).data[0].id;
  await creer("organization_tools", { organization_id: orgs.a.id, tool_id: outilId, enabled: true });
  await creer("organization_tools", { organization_id: orgs.b.id, tool_id: outilId, enabled: true });

  const jetons = {
    a: par(await connecter(emails.a)),
    c: par(await connecter(emails.c)),
    b: par(await connecter(emails.b)),
  };

  const A = await garnir(orgs.a.id, comptes.a);
  const B = await garnir(orgs.b.id, comptes.b);

  console.log("== 1. Le membre de B ne touche à rien de A ==");
  await serieRefus("B→A", jetons.b, A, orgs.a.id, comptes.b);

  console.log("\n== 2. Le membre de A ne touche à rien de B ==");
  await serieRefus("A→B", jetons.a, B, orgs.b.id, comptes.a);

  console.log("\n== 3. Le membre de A voit et modifie bien son tableau ==");
  verifie("A · select boards", (await jetons.a("GET", `boards?select=id&id=eq.${A.board.id}`)).data.length === 1);
  verifie("A · select cards", (await jetons.a("GET", `cards?select=id&board_id=eq.${A.board.id}`)).data.length === 1);
  verifie("A · update card", (await jetons.a("PATCH", `cards?id=eq.${A.card.id}`, { title: "Renommée" })).data.length === 1);
  verifie(
    "A · insert card",
    (await jetons.a("POST", "cards", {
      board_id: A.board.id,
      list_id: A.list.id,
      title: "Ajoutée",
      position: 2048,
    })).status === 201,
  );

  console.log("\n== 4. Le socle : organisations, membres, profils, outils ==");
  const orgsVues = (await jetons.b("GET", "organizations?select=id,slug")).data;
  verifie("B · organizations = la sienne seule", orgsVues.length === 1 && orgsVues[0].id === orgs.b.id, JSON.stringify(orgsVues));

  const membresVus = (await jetons.b("GET", "memberships?select=user_id,organization_id")).data;
  verifie("B · memberships = les siennes", membresVus.every((m) => m.organization_id === orgs.b.id));

  verifie("B · update organizations (celle de A) refusé", refuse(await jetons.b("PATCH", `organizations?id=eq.${orgs.a.id}`, { name: "Piratée" })));
  verifie("B · update sa propre organisation refusé", refuse(await jetons.b("PATCH", `organizations?id=eq.${orgs.b.id}`, { name: "Piratée" })));
  verifie("B · insert organizations refusé", (await jetons.b("POST", "organizations", { name: "Intruse", slug: `zz-qa-intruse-${marque}` })).status >= 400);
  verifie("B · organization_tools = les siens", (await jetons.b("GET", "organization_tools?select=organization_id")).data.every((o) => o.organization_id === orgs.b.id));

  const profilsVus = (await jetons.b("GET", "profiles?select=id")).data;
  verifie("B · profiles limités à son organisation", !profilsVus.some((p) => p.id === comptes.a || p.id === comptes.c));
  verifie("B · ne se promeut pas admin", (await jetons.b("PATCH", `profiles?id=eq.${comptes.b}`, { is_admin: true })).status >= 400);
  verifie("B · tools lisible", (await jetons.b("GET", "tools?select=slug")).data.length >= 1);

  console.log("\n== 5. Fonctions d'accès injoignables sans session ==");
  for (const [fonction, arguments_] of [
    ["is_admin", {}],
    ["is_member", { org: orgs.a.id }],
    ["has_tool", { org: orgs.a.id, tool_slug: "kanban" }],
    ["shares_org_with", { other: comptes.a }],
    ["can_access_board", { b: A.board.id }],
    ["is_org_owner", { org: orgs.a.id }],
  ]) {
    const resultat = await rest(ANON, ANON, "POST", `rpc/${fonction}`, arguments_);
    verifie(`anon · ${fonction}() refusée`, resultat.status >= 400, `status ${resultat.status}`);
  }
  verifie("anon · select boards vide", vide(await rest(ANON, ANON, "GET", "boards?select=id")));

  console.log("\n== 6. Suppression d'un tableau : responsable seulement ==");
  verifie("C (membre) · delete board refusé", refuse(await jetons.c("DELETE", `boards?id=eq.${A.board.id}`)));
  verifie("C · le tableau est toujours là", (await srv("GET", `boards?select=id&id=eq.${A.board.id}`)).data.length === 1);
  verifie("C · archive le tableau (autorisé)", (await jetons.c("PATCH", `boards?id=eq.${A.board.id}`, { is_archived: true })).data.length === 1);
  await jetons.c("PATCH", `boards?id=eq.${A.board.id}`, { is_archived: false });

  console.log("\n== 7. Commentaires : auteur seulement ==");
  verifie("C · update le commentaire de A refusé", refuse(await jetons.c("PATCH", `comments?id=eq.${A.comment.id}`, { body: "piraté" })));
  verifie("C · delete le commentaire de A refusé", refuse(await jetons.c("DELETE", `comments?id=eq.${A.comment.id}`)));
  verifie("C · le commentaire de A est intact", (await srv("GET", `comments?select=body&id=eq.${A.comment.id}`)).data[0]?.body === "un mot");

  const sien = await jetons.c("POST", "comments", {
    card_id: A.card.id,
    board_id: A.board.id,
    user_id: comptes.c,
    body: "le mien",
  });
  verifie("C · publie son commentaire", sien.status === 201);
  verifie(
    "C · usurpation d'auteur refusée",
    (await jetons.c("POST", "comments", {
      card_id: A.card.id,
      board_id: A.board.id,
      user_id: comptes.a,
      body: "au nom de A",
    })).status >= 400,
  );
  if (sien.status === 201) {
    verifie("C · modifie le sien", (await jetons.c("PATCH", `comments?id=eq.${sien.data[0].id}`, { body: "corrigé" })).data.length === 1);
    verifie("C · supprime le sien", (await jetons.c("DELETE", `comments?id=eq.${sien.data[0].id}`)).data.length === 1);
  }

  console.log("\n== 8. Outil coupé puis rendu ==");
  const compter = async () => ({
    boards: (await jetons.a("GET", `boards?select=id&organization_id=eq.${orgs.a.id}`)).data.length,
    lists: (await jetons.a("GET", `lists?select=id&board_id=eq.${A.board.id}`)).data.length,
    cards: (await jetons.a("GET", `cards?select=id&board_id=eq.${A.board.id}`)).data.length,
    comments: (await jetons.a("GET", `comments?select=id&board_id=eq.${A.board.id}`)).data.length,
  });

  const avant = await compter();
  verifie("A · tableau visible avant coupure", avant.boards === 1 && avant.cards >= 1);

  const basculer = (enabled) =>
    srv("PATCH", `organization_tools?organization_id=eq.${orgs.a.id}&tool_id=eq.${outilId}`, { enabled });

  await basculer(false);
  const pendant = await compter();
  verifie("outil coupé · tableaux invisibles", pendant.boards === 0, JSON.stringify(pendant));
  verifie(
    "outil coupé · listes, cartes et commentaires invisibles",
    pendant.lists === 0 && pendant.cards === 0 && pendant.comments === 0,
    JSON.stringify(pendant),
  );
  verifie(
    "outil coupé · écriture refusée",
    refuse(await jetons.a("POST", "cards", {
      board_id: A.board.id,
      list_id: A.list.id,
      title: "Pendant la coupure",
      position: 9,
    })),
  );
  verifie("outil coupé · has_tool faux", (await jetons.a("POST", "rpc/has_tool", { org: orgs.a.id, tool_slug: "kanban" })).data === false);

  await basculer(true);
  const apres = await compter();
  verifie(
    "outil rendu · tout revient intact",
    JSON.stringify(apres) === JSON.stringify(avant),
    `${JSON.stringify(avant)} vs ${JSON.stringify(apres)}`,
  );

  console.log("\n== 9. Le responsable supprime son tableau ==");
  verifie("A (responsable) · delete board", (await jetons.a("DELETE", `boards?id=eq.${A.board.id}`)).data.length === 1);
  verifie("A · cascade : plus de cartes", (await srv("GET", `cards?select=id&board_id=eq.${A.board.id}`)).data.length === 0);
  verifie("A · cascade : plus de commentaires", (await srv("GET", `comments?select=id&board_id=eq.${A.board.id}`)).data.length === 0);
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
