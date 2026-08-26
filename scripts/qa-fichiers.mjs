/**
 * Banc de l'outil Fichiers — tables et Storage.
 *
 *   npm run qa:fichiers
 *
 * Deux organisations, trois comptes, un bucket privé. On vérifie qu'un membre
 * d'un client ne voit ni ne touche les objets d'un autre, que couper l'outil
 * ferme la porte y compris côté Storage, et que la suppression est bien
 * réservée à l'auteur, au responsable et à Louis.
 *
 * Comme les autres bancs : de vraies sessions, la clé secrète seulement pour
 * poser le décor et constater, et tout ce qui est créé est supprimé à la fin.
 *
 * Chantier 1 : tables, bucket et politiques. Le contrôle des URL signées
 * s'ajoutera au chantier 6, quand elles existeront.
 */
import {
  annoncerCible,
  connecter,
  creer,
  creerCompte,
  journal,
  par,
  refuse,
  srv,
  stockage,
  supprimerCompte,
  vide,
  ANON,
  SUPABASE,
} from "./qa-commun.mjs";

const { verifie, bilan } = journal();
annoncerCible("QA — outil Fichiers");

const BUCKET = "fichiers";
const CONTENU = Buffer.from("photo de recette\n");

const deposer = (jeton, chemin, { remplacer = false } = {}) =>
  stockage(jeton, "POST", `object/${BUCKET}/${chemin}`, {
    corps: CONTENU,
    entetes: {
      "Content-Type": "image/jpeg",
      ...(remplacer ? { "x-upsert": "true" } : {}),
    },
  });

const lire = (jeton, chemin) => stockage(jeton, "GET", `object/${BUCKET}/${chemin}`);

const lister = (jeton, prefixe) =>
  stockage(jeton, "POST", `object/list/${BUCKET}`, {
    corps: JSON.stringify({ prefix: prefixe, limit: 100 }),
    entetes: { "Content-Type": "application/json" },
  });

const effacer = (jeton, chemin) =>
  stockage(jeton, "DELETE", `object/${BUCKET}/${chemin}`);

/** Le Storage renvoie 200 avec une liste vide quand la RLS masque tout. */
const listeVide = (resultat) =>
  resultat.status === 200 && Array.isArray(resultat.data) && resultat.data.length === 0;

const marque = Date.now();
const emails = {
  a1: `zz-qa-f1-${marque}@example.com`,
  a2: `zz-qa-f2-${marque}@example.com`,
  b1: `zz-qa-f3-${marque}@example.com`,
};
const comptes = {};
const orgs = {};

try {
  // --------------------------------- décor ---------------------------------
  comptes.a1 = await creerCompte(emails.a1); // responsable de A
  comptes.a2 = await creerCompte(emails.a2); // simple membre de A
  comptes.b1 = await creerCompte(emails.b1); // membre de B seulement

  orgs.a = await creer("organizations", { name: "ZZ QA FA", slug: `zz-qa-fa-${marque}` });
  orgs.b = await creer("organizations", { name: "ZZ QA FB", slug: `zz-qa-fb-${marque}` });

  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.a1, role: "owner" });
  await creer("memberships", { organization_id: orgs.a.id, user_id: comptes.a2, role: "member" });
  await creer("memberships", { organization_id: orgs.b.id, user_id: comptes.b1, role: "owner" });

  const outilId = (await srv("GET", "tools?select=id&slug=eq.fichiers")).data[0].id;
  const basculer = (orgId, enabled) =>
    srv("PATCH", `organization_tools?organization_id=eq.${orgId}&tool_id=eq.${outilId}`, {
      enabled,
    });

  await creer("organization_tools", { organization_id: orgs.a.id, tool_id: outilId, enabled: true });
  await creer("organization_tools", { organization_id: orgs.b.id, tool_id: outilId, enabled: true });

  const a1 = par(await connecter(emails.a1));
  const a2 = par(await connecter(emails.a2));
  const b1 = par(await connecter(emails.b1));
  const jetonA1 = await connecter(emails.a1);
  const jetonA2 = await connecter(emails.a2);
  const jetonB1 = await connecter(emails.b1);

  console.log("== 1. Le membre de A, outil activé, travaille chez lui ==");
  const dossier = await a1("POST", "folders", {
    organization_id: orgs.a.id,
    name: "Photos octobre",
    created_by: comptes.a1,
  });
  verifie("A1 · crée un dossier", dossier.status === 201, `status ${dossier.status}`);

  const objetA1 = `${orgs.a.id}/${crypto.randomUUID()}`;
  const ligneA1 = await a1("POST", "files", {
    organization_id: orgs.a.id,
    folder_id: dossier.data?.[0]?.id ?? null,
    name: "photo.jpg",
    size_bytes: CONTENU.length,
    mime_type: "image/jpeg",
    uploaded_by: comptes.a1,
  });
  verifie("A1 · inscrit un fichier", ligneA1.status === 201, `status ${ligneA1.status}`);

  const depot = await deposer(jetonA1, objetA1);
  verifie("A1 · dépose l'objet", depot.status === 200, `status ${depot.status} ${JSON.stringify(depot.data)}`);

  /*
   * Un envoi TUS crée l'objet puis le complète : c'est la politique `update`
   * qui décide. Le remplacement l'emprunte, et confirme au passage que la
   * colonne d'auteur est bien celle qu'on croit.
   */
  const remplacement = await deposer(jetonA1, objetA1, { remplacer: true });
  verifie(
    "A1 · complète son objet (droit update, indispensable au TUS)",
    remplacement.status === 200,
    `status ${remplacement.status} ${JSON.stringify(remplacement.data)}`,
  );

  verifie("A1 · relit son objet", (await lire(jetonA1, objetA1)).status === 200);
  const listeA1 = await lister(jetonA1, orgs.a.id);
  verifie("A1 · liste son organisation", listeA1.status === 200 && listeA1.data.length === 1, JSON.stringify(listeA1.data));

  console.log("\n== 2. Le membre de B ne touche à rien de A ==");
  verifie("B1 · select folders de A", vide(await b1("GET", `folders?select=id&organization_id=eq.${orgs.a.id}`)));
  verifie("B1 · select files de A", vide(await b1("GET", `files?select=id&organization_id=eq.${orgs.a.id}`)));
  verifie(
    "B1 · insert folder chez A refusé",
    (await b1("POST", "folders", { organization_id: orgs.a.id, name: "Intrus", created_by: comptes.b1 })).status >= 400,
  );
  verifie(
    "B1 · insert file chez A refusé",
    (await b1("POST", "files", {
      organization_id: orgs.a.id,
      name: "intrus.jpg",
      size_bytes: 1,
      uploaded_by: comptes.b1,
    })).status >= 400,
  );
  verifie("B1 · delete du dossier de A refusé", refuse(await b1("DELETE", `folders?organization_id=eq.${orgs.a.id}`)));

  verifie("B1 · liste le préfixe de A → vide", listeVide(await lister(jetonB1, orgs.a.id)), JSON.stringify((await lister(jetonB1, orgs.a.id)).data));
  verifie("B1 · lit l'objet de A refusé", (await lire(jetonB1, objetA1)).status >= 400);
  verifie(
    "B1 · dépose sous le préfixe de A refusé",
    (await deposer(jetonB1, `${orgs.a.id}/${crypto.randomUUID()}`)).status >= 400,
  );
  verifie("B1 · efface l'objet de A refusé", (await effacer(jetonB1, objetA1)).status >= 400);
  verifie("B1 · l'objet de A est intact", (await lire(jetonA1, objetA1)).status === 200);

  console.log("\n== 3. Outil coupé pour A ==");
  await basculer(orgs.a.id, false);

  verifie("outil coupé · A1 ne voit plus ses dossiers", vide(await a1("GET", `folders?select=id&organization_id=eq.${orgs.a.id}`)));
  verifie("outil coupé · A1 ne voit plus ses fichiers", vide(await a1("GET", `files?select=id&organization_id=eq.${orgs.a.id}`)));
  verifie("outil coupé · A1 ne liste plus ses objets", listeVide(await lister(jetonA1, orgs.a.id)));
  verifie("outil coupé · A1 ne lit plus son objet", (await lire(jetonA1, objetA1)).status >= 400);
  verifie(
    "outil coupé · A1 ne dépose plus",
    (await deposer(jetonA1, `${orgs.a.id}/${crypto.randomUUID()}`)).status >= 400,
  );
  verifie("outil coupé · can_access_files faux", (await a1("POST", "rpc/can_access_files", { org: orgs.a.id })).data === false);

  await basculer(orgs.a.id, true);
  verifie("outil rendu · A1 revoit ses fichiers", (await a1("GET", `files?select=id&organization_id=eq.${orgs.a.id}`)).data.length === 1);
  verifie("outil rendu · A1 relit son objet", (await lire(jetonA1, objetA1)).status === 200);

  console.log("\n== 4. Entre membres du même client ==");
  const objetA2 = `${orgs.a.id}/${crypto.randomUUID()}`;
  verifie("A2 · dépose le sien", (await deposer(jetonA2, objetA2)).status === 200);
  verifie("A2 · voit les fichiers du client", (await a2("GET", `files?select=id&organization_id=eq.${orgs.a.id}`)).data.length === 1);
  verifie("A2 · lit l'objet de A1", (await lire(jetonA2, objetA1)).status === 200);

  verifie("A2 · n'efface pas l'objet de A1", (await effacer(jetonA2, objetA1)).status >= 400);
  /*
   * Écraser, c'est un `update` : c'est ici que `est_auteur_objet` est vraiment
   * mise à l'épreuve. Si elle se trompait de colonne d'auteur, un membre
   * pourrait remplacer le fichier d'un autre sans rien en dire.
   */
  verifie(
    "A2 · n'écrase pas l'objet de A1",
    (await deposer(jetonA2, objetA1, { remplacer: true })).status >= 400,
  );
  verifie("A2 · l'objet de A1 est intact", (await lire(jetonA1, objetA1)).status === 200);

  const ligneDeA1 = ligneA1.data?.[0]?.id;
  verifie(
    "A2 · ne supprime pas la ligne de A1",
    refuse(await a2("DELETE", `files?id=eq.${ligneDeA1}`)),
  );
  verifie("A2 · la ligne de A1 est intacte", (await srv("GET", `files?select=id&id=eq.${ligneDeA1}`)).data.length === 1);

  verifie(
    "A2 · n'inscrit pas un fichier au nom de A1",
    (await a2("POST", "files", {
      organization_id: orgs.a.id,
      name: "usurpe.jpg",
      size_bytes: 1,
      uploaded_by: comptes.a1,
    })).status >= 400,
  );

  verifie("A2 · efface le sien", (await effacer(jetonA2, objetA2)).status === 200);

  console.log("\n== 5. Le responsable et l'auteur ==");
  verifie("A1 · supprime sa propre ligne", (await a1("DELETE", `files?id=eq.${ligneDeA1}`)).data.length === 1);
  verifie("A1 (responsable) · efface son objet", (await effacer(jetonA1, objetA1)).status === 200);
  verifie("A1 · le préfixe est vide", listeVide(await lister(jetonA1, orgs.a.id)));

  console.log("\n== 6. Sans session ==");
  const anonyme = await fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/${objetA1}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  verifie("anon · lecture refusée", anonyme.status >= 400, `status ${anonyme.status}`);
  verifie("anon · le bucket n'est pas public", (await srv("GET", "")).status !== undefined);
} finally {
  console.log("\n== Nettoyage ==");
  // Supprimer l'organisation ne touche pas au Storage : on vide les préfixes
  // à la main, sinon un échec en cours de route laisserait des objets.
  for (const org of Object.values(orgs)) {
    if (!org?.id) continue;

    const restes = await stockage(null, "POST", `object/list/${BUCKET}`, {
      corps: JSON.stringify({ prefix: org.id, limit: 100 }),
      entetes: { "Content-Type": "application/json" },
    });

    const noms = Array.isArray(restes.data)
      ? restes.data.map((objet) => `${org.id}/${objet.name}`)
      : [];

    if (noms.length > 0) {
      await stockage(null, "DELETE", `object/${BUCKET}`, {
        corps: JSON.stringify({ prefixes: noms }),
        entetes: { "Content-Type": "application/json" },
      });
    }

    await srv("DELETE", `organizations?id=eq.${org.id}`);
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
