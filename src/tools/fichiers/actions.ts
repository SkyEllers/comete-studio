"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { echapper, envoyer } from "./courriel";
import { compteFichiers, tailleLisible } from "./format";
import { apercuImage, lienOriginal } from "./liens";

/**
 * Mutations de la médiathèque.
 *
 * Server Actions et non écritures depuis le navigateur : elles changent une
 * liste rendue côté serveur, et `revalidatePath` est le seul mécanisme qui
 * traverse la frontière — la leçon du kanban, où la liste des tableaux restait
 * périmée jusqu'à un F5.
 *
 * Le client Supabase utilisé porte la session de l'utilisateur, jamais la clé
 * secrète : c'est la RLS qui tranche, ici comme partout.
 */

const BUCKET = "fichiers";

const identifiant = z.uuid({ error: "Élément introuvable." });

const nomDossier = z
  .string({ error: "Donne un nom à ce dossier." })
  .trim()
  .min(1, { error: "Donne un nom à ce dossier." })
  .max(80, { error: "Le nom ne peut pas dépasser 80 caractères." });

/**
 * Accès à l'outil pour cette organisation, ou `null`.
 *
 * `has_tool()` répond faux avec la clé secrète : on interroge donc la base
 * avec la session, exactement comme le fait la garde des pages.
 */
async function acces(orgSlug: string) {
  const membre = await getMembership(orgSlug);
  if (!membre) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("can_access_files", {
    org: membre.org.id,
  });

  return data === true ? { ...membre, supabase } : null;
}

/** La racine et le dossier concerné : les deux listes changent. */
function rafraichir(orgSlug: string, folderId?: string | null) {
  revalidatePath(`/app/${orgSlug}/fichiers`);
  if (folderId) revalidatePath(`/app/${orgSlug}/fichiers/${folderId}`);
}

// --------------------------------- Dossiers ---------------------------------

export async function createFolder(
  orgSlug: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = nomDossier.safeParse(name);
  if (!parsed.success) return failFromZod(parsed.error);

  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const { data, error } = await membre.supabase
    .from("folders")
    .insert({
      organization_id: membre.org.id,
      name: parsed.data,
      created_by: membre.userId,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 : deux dossiers du même nom chez le même client.
    if (error.code === "23505") {
      return fail(`Un dossier « ${parsed.data} » existe déjà.`, "name");
    }
    return fail("Impossible de créer ce dossier pour le moment.");
  }

  rafraichir(orgSlug);
  return ok({ id: data.id });
}

export async function renameFolder(
  orgSlug: string,
  folderId: string,
  name: string,
): Promise<ActionResult> {
  const parsed = z
    .object({ folderId: identifiant, name: nomDossier })
    .safeParse({ folderId, name });
  if (!parsed.success) return failFromZod(parsed.error);

  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const { data, error } = await membre.supabase
    .from("folders")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.folderId)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      return fail(`Un dossier « ${parsed.data.name} » existe déjà.`, "name");
    }
    return fail("Impossible de renommer ce dossier.");
  }
  if (!data || data.length === 0) return fail("Ce dossier n'existe plus.");

  rafraichir(orgSlug, parsed.data.folderId);
  return ok();
}

/**
 * Supprimer un dossier, c'est supprimer ses fichiers.
 *
 * Les objets partent avant les lignes : l'inverse laisserait dans le bucket
 * des fichiers que plus personne ne sait nommer. Et si le Storage en refuse
 * un — il n'appartient ni à nous, ni à un responsable — on s'arrête avant de
 * toucher au dossier, plutôt que de laisser des objets orphelins derrière une
 * cascade en base.
 */
export async function deleteFolder(
  orgSlug: string,
  folderId: string,
): Promise<ActionResult> {
  if (!identifiant.safeParse(folderId).success)
    return fail("Dossier introuvable.");

  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const { data: fichiers } = await membre.supabase
    .from("files")
    .select("id")
    .eq("organization_id", membre.org.id)
    .eq("folder_id", folderId);

  const retrait = await retirerObjets(
    membre.supabase,
    membre.org.id,
    (fichiers ?? []).map((f) => f.id),
  );
  if (!retrait.ok) return retrait;

  const { data, error } = await membre.supabase
    .from("folders")
    .delete()
    .eq("id", folderId)
    .select("id");

  if (error) return fail("Impossible de supprimer ce dossier.");
  if (!data || data.length === 0) {
    return fail(
      "Seul l'auteur du dossier ou un responsable peut le supprimer.",
    );
  }

  rafraichir(orgSlug, folderId);
  return ok();
}

// --------------------------------- Fichiers ---------------------------------

/**
 * Retire du bucket les objets d'une série de fichiers.
 *
 * Storage ne se plaint pas de ce qu'il refuse : il renvoie la liste de ce
 * qu'il a effacé. C'est en la comptant qu'on apprend qu'un objet n'était pas
 * à nous.
 */
async function retirerObjets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  fileIds: string[],
): Promise<ActionResult> {
  if (fileIds.length === 0) return ok();

  const chemins = fileIds.map((id) => `${organizationId}/${id}`);

  // Les couvertures de vidéo partent avec : Storage ignore sans broncher
  // celles qui n'existent pas, elles ne faussent donc pas le compte ci-dessous.
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .remove([
      ...chemins,
      ...fileIds.map((id) => `${organizationId}/${id}.poster.jpg`),
    ]);

  if (error) return fail("Impossible de retirer ces fichiers du stockage.");

  const retires = (data ?? []).filter(
    (objet) => !objet.name.endsWith(".poster.jpg"),
  );

  if (retires.length < chemins.length) {
    return fail(
      "Certains de ces fichiers ont été déposés par quelqu'un d'autre : seul leur auteur ou un responsable peut les supprimer.",
    );
  }

  return ok();
}

export async function deleteFiles(
  orgSlug: string,
  fileIds: string[],
  folderId: string | null,
): Promise<ActionResult<{ supprimes: number }>> {
  const parsed = z
    .array(identifiant)
    .min(1, { error: "Aucun fichier sélectionné." })
    .max(500, { error: "Trop de fichiers d'un coup." })
    .safeParse(fileIds);
  if (!parsed.success) return failFromZod(parsed.error);

  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const retrait = await retirerObjets(
    membre.supabase,
    membre.org.id,
    parsed.data,
  );
  if (!retrait.ok) return retrait;

  const { data, error } = await membre.supabase
    .from("files")
    .delete()
    .in("id", parsed.data)
    .select("id");

  if (error) return fail("Impossible de supprimer ces fichiers.");

  rafraichir(orgSlug, folderId);
  return ok({ supprimes: data?.length ?? 0 });
}

// ------------------------------ Fin d'un lot --------------------------------

/**
 * Appelée par la file quand plus rien ne part : c'est `revalidatePath` qui
 * fait apparaître les fichiers dans la liste sans rechargement. Les lignes,
 * elles, ont déjà été écrites depuis le navigateur.
 */
export async function rafraichirApresLot(
  orgSlug: string,
  folderId: string | null,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  rafraichir(orgSlug, folderId);
  return ok();
}

/**
 * Le ménage des envois abandonnés, à l'ouverture de l'outil.
 *
 * Un envoi interrompu laisse une ligne `uploading` et un objet incomplet. On
 * les garde vingt-quatre heures — le temps de revenir et de reprendre — puis
 * on les efface. La RLS limite d'elle-même le ménage à ce que cette personne
 * a le droit de supprimer.
 */
export async function nettoyerEnvoisAbandonnes(
  orgSlug: string,
): Promise<ActionResult<{ retires: number }>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: abandonnes } = await membre.supabase
    .from("files")
    .select("id")
    .eq("organization_id", membre.org.id)
    .eq("status", "uploading")
    .lt("created_at", limite);

  const ids = (abandonnes ?? []).map((f) => f.id);
  if (ids.length === 0) return ok({ retires: 0 });

  await membre.supabase.storage
    .from(BUCKET)
    .remove(ids.map((id) => `${membre.org.id}/${id}`));

  const { data } = await membre.supabase
    .from("files")
    .delete()
    .in("id", ids)
    .select("id");

  return ok({ retires: data?.length ?? 0 });
}

// ------------------------- Fiche d'un fichier -------------------------------

const nomFichier = z
  .string({ error: "Donne un nom à ce fichier." })
  .trim()
  .min(1, { error: "Donne un nom à ce fichier." })
  .max(255, { error: "Le nom ne peut pas dépasser 255 caractères." });

export async function renameFile(
  orgSlug: string,
  fileId: string,
  name: string,
): Promise<ActionResult> {
  const parsed = z
    .object({ fileId: identifiant, name: nomFichier })
    .safeParse({ fileId, name });
  if (!parsed.success) return failFromZod(parsed.error);

  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const { data, error } = await membre.supabase
    .from("files")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.fileId)
    .select("folder_id");

  if (error) return fail("Impossible de renommer ce fichier.");
  if (!data || data.length === 0) return fail("Ce fichier n'existe plus.");

  rafraichir(orgSlug, data[0].folder_id);
  return ok();
}

/**
 * Déplacer un fichier ne touche pas au Storage : le chemin d'un objet porte
 * l'organisation et l'identifiant du fichier, jamais son dossier. Le rangement
 * vit en base, donc un déplacement coûte une ligne modifiée.
 */
export async function moveFile(
  orgSlug: string,
  fileId: string,
  folderId: string | null,
): Promise<ActionResult> {
  const parsed = z
    .object({ fileId: identifiant, folderId: identifiant.nullable() })
    .safeParse({ fileId, folderId });
  if (!parsed.success) return failFromZod(parsed.error);

  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const { data, error } = await membre.supabase
    .from("files")
    .update({ folder_id: parsed.data.folderId })
    .eq("id", parsed.data.fileId)
    .select("folder_id");

  if (error) return fail("Impossible de déplacer ce fichier.");
  if (!data || data.length === 0) return fail("Ce fichier n'existe plus.");

  rafraichir(orgSlug);
  if (parsed.data.folderId) rafraichir(orgSlug, parsed.data.folderId);
  return ok();
}

// ------------------------------ Liens signés -------------------------------

/** L'original, avec son nom d'origine : c'est le lien de téléchargement. */
export async function lienDeTelechargement(
  orgSlug: string,
  fileId: string,
): Promise<ActionResult<string>> {
  if (!identifiant.safeParse(fileId).success)
    return fail("Fichier introuvable.");

  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const { data } = await membre.supabase
    .from("files")
    .select("name")
    .eq("id", fileId)
    .maybeSingle();

  if (!data) return fail("Ce fichier n'existe plus.");

  const lien = await lienOriginal(
    membre.supabase,
    membre.org.id,
    fileId,
    data.name,
  );
  if (!lien) return fail("Impossible de préparer ce téléchargement.");

  return ok(lien);
}

/**
 * Les liens d'un lot, pour le zip. Sans nom de téléchargement : c'est le zip
 * qui porte les noms, le navigateur ne fait que lire les octets.
 */
export async function liensDuLot(
  orgSlug: string,
  fileIds: string[],
): Promise<ActionResult<{ id: string; nom: string; url: string }[]>> {
  const parsed = z
    .array(identifiant)
    .min(1, { error: "Aucun fichier sélectionné." })
    .max(500, { error: "Trop de fichiers d'un coup." })
    .safeParse(fileIds);
  if (!parsed.success) return failFromZod(parsed.error);

  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const { data: lignes } = await membre.supabase
    .from("files")
    .select("id, name")
    .in("id", parsed.data)
    .eq("status", "ready");

  if (!lignes || lignes.length === 0)
    return fail("Ces fichiers n'existent plus.");

  const { data: signes } = await membre.supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      lignes.map((ligne) => `${membre.org.id}/${ligne.id}`),
      3600,
    );

  const liens = (signes ?? [])
    .map((signe, rang) => {
      const ligne = lignes[rang];
      if (!ligne || signe.error || !signe.signedUrl) return null;
      return { id: ligne.id, nom: ligne.name, url: signe.signedUrl };
    })
    .filter((lien) => lien !== null);

  if (liens.length === 0)
    return fail("Impossible de préparer ce téléchargement.");
  return ok(liens);
}

/** Ce qu'il faut pour afficher un fichier en grand dans sa fiche. */
export async function apercuDuFichier(
  orgSlug: string,
  fileId: string,
): Promise<ActionResult<{ apercu: string | null; original: string | null }>> {
  if (!identifiant.safeParse(fileId).success)
    return fail("Fichier introuvable.");

  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const { data } = await membre.supabase
    .from("files")
    .select("mime_type")
    .eq("id", fileId)
    .maybeSingle();

  if (!data) return fail("Ce fichier n'existe plus.");

  // Une image passe par le rendu redimensionné ; une vidéo et un PDF veulent
  // l'original, le Storage sachant répondre aux requêtes partielles.
  const apercu = data.mime_type.startsWith("image/")
    ? await apercuImage(membre.supabase, membre.org.id, fileId)
    : null;

  const original =
    data.mime_type.startsWith("video/") ||
    data.mime_type.startsWith("audio/") ||
    data.mime_type === "application/pdf"
      ? await lienOriginal(membre.supabase, membre.org.id, fileId)
      : null;

  return ok({ apercu, original });
}

/** Les destinations possibles, pour le dialog de préparation. */
export async function listerDossiers(
  orgSlug: string,
): Promise<ActionResult<{ id: string; name: string }[]>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const { data } = await membre.supabase
    .from("folders")
    .select("id, name")
    .eq("organization_id", membre.org.id)
    .order("name");

  return ok(data ?? []);
}

// ----------------------------- Notification ---------------------------------

/** Deux lots rapprochés de la même personne, au même endroit, font un email. */
const RETENUE_MS = 5 * 60 * 1000;

/** Au-delà, l'email ne liste plus : il annonce un nombre. */
const NOMS_LISTES = 10;

/**
 * Prévenir Louis qu'un dépôt vient d'arriver.
 *
 * Appelée par la file quand elle se vide, avec les fichiers réellement arrivés.
 * Elle relit ces fichiers avec la session de qui a déposé : c'est la RLS qui
 * décide de ce qui compte, et un identifiant glissé de l'extérieur ne donne
 * rien de plus que ce que cette personne voit déjà.
 *
 * Le registre des emails déjà envoyés, lui, s'écrit avec la clé secrète. Il
 * n'appartient pas au client — le laisser à sa portée lui donnerait de quoi
 * étouffer ses propres notifications.
 *
 * Ne renvoie jamais d'échec au navigateur : un email raté n'est pas un dépôt
 * raté, et la file n'a rien à en faire.
 */
export async function notifyBatch(
  orgSlug: string,
  fileIds: string[],
): Promise<ActionResult<{ envoyes: number }>> {
  const membre = await acces(orgSlug);
  if (!membre) return ok({ envoyes: 0 });

  // Louis dépose aussi chez ses clients : s'écrire à soi-même n'a pas de sens.
  if (membre.profile.is_admin) return ok({ envoyes: 0 });

  const ids = fileIds.filter((id) => identifiant.safeParse(id).success);
  if (ids.length === 0) return ok({ envoyes: 0 });

  const { data: fichiers } = await membre.supabase
    .from("files")
    .select("name, size_bytes, folder_id, folders(name)")
    .in("id", ids)
    .eq("organization_id", membre.org.id)
    .eq("status", "ready")
    .order("created_at");

  if (!fichiers || fichiers.length === 0) return ok({ envoyes: 0 });

  /*
   * Un lot peut s'étaler sur plusieurs dossiers : on peut déposer, changer de
   * dossier, redéposer, et la file ne se vide qu'une fois. Un email par
   * dossier, parce que « 12 fichiers » sans dire où n'aide personne.
   */
  const parDossier = new Map<string | null, typeof fichiers>();
  for (const fichier of fichiers) {
    const lot = parDossier.get(fichier.folder_id) ?? [];
    lot.push(fichier);
    parDossier.set(fichier.folder_id, lot);
  }

  const admin = createAdminClient();
  const depuis = new Date(Date.now() - RETENUE_MS).toISOString();
  let envoyes = 0;

  for (const [folderId, lot] of parDossier) {
    const retenue = admin
      .from("notification_batches")
      .select("id")
      .eq("organization_id", membre.org.id)
      .eq("user_id", membre.userId)
      .gt("sent_at", depuis)
      .limit(1);

    // `eq` sur une colonne nulle ne trouve rien : la racine se demande en `is`.
    const { data: recent } = await (folderId === null
      ? retenue.is("folder_id", null)
      : retenue.eq("folder_id", folderId));

    if (recent && recent.length > 0) continue;

    const nomDossier = lot[0].folders?.name ?? null;
    const ou = nomDossier ? `dans ${nomDossier}` : "à la racine";
    const octets = lot.reduce((total, f) => total + f.size_bytes, 0);
    const lien = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/app/${orgSlug}/fichiers${
      folderId ? `/${folderId}` : ""
    }`;

    const noms = lot.slice(0, NOMS_LISTES).map((f) => f.name);
    const reste = lot.length - noms.length;

    const sujet = `${membre.profile.full_name} a déposé ${compteFichiers(lot.length)} ${ou}`;
    const entete = `${membre.org.name} · ${compteFichiers(lot.length)} ${ou} · ${tailleLisible(octets)}`;
    const suite = reste > 0 ? `\n… et ${compteFichiers(reste)} de plus.` : "";

    const texte = `${entete}\n\n${noms.map((n) => `— ${n}`).join("\n")}${suite}\n\n${lien}`;

    const html = [
      `<p>${echapper(entete)}</p>`,
      `<ul>${noms.map((n) => `<li>${echapper(n)}</li>`).join("")}</ul>`,
      reste > 0
        ? `<p>… et ${echapper(compteFichiers(reste))} de plus.</p>`
        : "",
      `<p><a href="${echapper(lien)}">Ouvrir ${echapper(nomDossier ?? "la médiathèque")}</a></p>`,
    ].join("");

    const parti = await envoyer({ sujet, texte, html });
    if (!parti) continue;

    // La ligne n'est posée que si l'email est parti : un envoi raté ne doit pas
    // faire taire le suivant pendant cinq minutes.
    await admin.from("notification_batches").insert({
      organization_id: membre.org.id,
      folder_id: folderId,
      user_id: membre.userId,
    });

    envoyes += 1;
  }

  return ok({ envoyes });
}
