"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

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
  const { data } = await supabase.rpc("can_access_files", { org: membre.org.id });

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
  if (!identifiant.safeParse(folderId).success) return fail("Dossier introuvable.");

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
    return fail("Seul l'auteur du dossier ou un responsable peut le supprimer.");
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
  const { data, error } = await supabase.storage.from(BUCKET).remove(chemins);

  if (error) return fail("Impossible de retirer ces fichiers du stockage.");

  if ((data?.length ?? 0) < chemins.length) {
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

  const retrait = await retirerObjets(membre.supabase, membre.org.id, parsed.data);
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
