"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getMembership } from "@/lib/access";
import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { demanderClassement } from "@/tools/sas/anthropic";
import { cleNom, reconcilier, trouverBoite } from "@/tools/sas/classement";
import { ideesManuelles } from "@/tools/sas/decoupage";
import {
  identifiant,
  nomBoiteSchema,
  placeSchema,
  texteIdeeSchema,
} from "@/tools/sas/mutations-schema";
import { getBoites } from "@/tools/sas/queries";
import {
  LIMITE_CAPTURE,
  LIMITE_IDEE,
  LIMITE_NOM_BOITE,
  type Boite,
  type Classement,
} from "@/tools/sas/types";

/**
 * Les deux gestes de Sas : proposer un rangement, puis l'enregistrer.
 *
 * Ils sont séparés parce que l'écran de vérification est entre les deux. Le
 * premier ne touche pas la base et ne peut donc rien casser ; le second
 * n'appelle aucune IA et ne dépend donc de personne. C'est cette coupure qui
 * fait qu'une panne d'IA coûte du confort, jamais des idées.
 *
 * La clé Anthropic ne vit que dans `anthropic.ts`, appelé d'ici, côté serveur.
 * Le navigateur ne parle jamais à api.anthropic.com.
 */

/**
 * Accès à l'outil pour cette organisation, ou `null`.
 *
 * Comme pour Capsule : `has_tool()` répond faux avec la clé secrète, on
 * interroge donc la base avec la session, exactement comme la garde des pages.
 */
async function acces(orgSlug: string) {
  const membre = await getMembership(orgSlug);
  if (!membre) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("can_access_sas", { org: membre.org.id });

  return data === true ? { ...membre, supabase } : null;
}

// -------------------------------- Classement --------------------------------

const captureSchema = z
  .string({ error: "Écris quelque chose avant de ranger." })
  .trim()
  .min(1, { error: "Écris quelque chose avant de ranger." })
  .max(LIMITE_CAPTURE, {
    error: `C'est trop long d'un coup : ${LIMITE_CAPTURE.toLocaleString("fr-FR")} caractères au maximum.`,
  });

/**
 * Découpe et classe le texte. N'échoue que sur l'accès ou la saisie.
 *
 * Une IA en panne, lente ou incohérente n'est pas une erreur : c'est un
 * `mode: "manuel"`, et l'écran de vérification s'ouvre quand même, une idée
 * par ligne, destinations vides.
 */
export async function classer(
  orgSlug: string,
  texte: unknown,
): Promise<ActionResult<Classement>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = captureSchema.safeParse(texte);
  if (!parsed.success) return failFromZod(parsed.error);

  const saisie = parsed.data;
  const boites = await getBoites(membre.org.id);

  const brut = await demanderClassement(saisie, boites);
  const idees = brut === null ? null : reconcilier(brut, boites, saisie);

  if (!idees) return ok({ mode: "manuel", idees: ideesManuelles(saisie) });

  return ok({ mode: "ia", idees });
}

// ------------------------------ Enregistrement ------------------------------

const destinationSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("perso") }),
    z.object({ type: z.literal("aranger") }),
    z.object({ type: z.literal("boite"), boiteId: z.uuid({ error: "Boîte introuvable." }) }),
    z.object({
      type: z.literal("nouvelle"),
      nom: z
        .string()
        .trim()
        .min(1, { error: "Donne un nom à cette boîte." })
        .max(LIMITE_NOM_BOITE, {
          error: `Le nom d'une boîte ne peut pas dépasser ${LIMITE_NOM_BOITE} caractères.`,
        }),
    }),
  ])
  .nullable();

const enregistrementSchema = z
  .array(
    z.object({
      texte: z
        .string()
        .trim()
        .min(1, { error: "Une idée vide ne s'enregistre pas." })
        .max(LIMITE_IDEE, {
          error: `Une idée ne peut pas dépasser ${LIMITE_IDEE.toLocaleString("fr-FR")} caractères.`,
        }),
      destination: destinationSchema,
    }),
  )
  .min(1, { error: "Il n'y a plus rien à enregistrer." })
  .max(200, { error: "Trop d'idées d'un coup : enregistre-les en deux fois." });

type Ligne = {
  organization_id: string;
  box_id: string | null;
  realm: "pro" | "perso";
  content: string;
  created_by: string;
};

/**
 * Crée les boîtes acceptées, puis range les idées.
 *
 * « Une transaction logique » : les notes partent en une seule insertion, que
 * Postgres traite tout ou rien. Les boîtes, elles, doivent exister avant —
 * alors si l'insertion des notes échoue, on défait les boîtes qu'on vient de
 * créer. Sans ça, un échec laisserait des tiroirs vides derrière lui et Louis
 * les retrouverait le lendemain sans savoir d'où ils sortent.
 */
export async function enregistrer(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ rangees: number }>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = enregistrementSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const { supabase, org, userId } = membre;
  const boites = await getBoites(org.id);

  // Les noms à créer, dédoublonnés entre eux et confrontés à l'existant : deux
  // cartes envoyées vers « Flora » ne font qu'une boîte.
  const aCreer = new Map<string, string>();
  for (const idee of parsed.data) {
    const destination = idee.destination;
    if (destination?.type !== "nouvelle") continue;
    if (trouverBoite(destination.nom, boites)) continue;
    aCreer.set(cleNom(destination.nom), destination.nom);
  }

  const creees: Boite[] = [];

  if (aCreer.size > 0) {
    const { data, error } = await supabase
      .from("sas_boxes")
      .insert(
        [...aCreer.values()].map((name) => ({
          organization_id: org.id,
          name,
          created_by: userId,
        })),
      )
      .select("id, name");

    if (error || !data) {
      return fail("Ces boîtes n'ont pas pu être créées. Réessaie.");
    }
    creees.push(...data);
  }

  const connues = [...boites, ...creees];

  const lignes: Ligne[] = [];
  for (const idee of parsed.data) {
    const destination = idee.destination;

    // Pas de destination : c'est le mode manuel, où Louis peut valider sans
    // trancher. L'idée va dans « À ranger » plutôt que d'être perdue.
    if (!destination || destination.type === "aranger") {
      lignes.push({
        organization_id: org.id,
        box_id: null,
        realm: "pro",
        content: idee.texte,
        created_by: userId,
      });
      continue;
    }

    if (destination.type === "perso") {
      lignes.push({
        organization_id: org.id,
        box_id: null,
        realm: "perso",
        content: idee.texte,
        created_by: userId,
      });
      continue;
    }

    const boite =
      destination.type === "boite"
        ? (connues.find((candidate) => candidate.id === destination.boiteId) ?? null)
        : trouverBoite(destination.nom, connues);

    if (!boite) {
      await defaire(supabase, creees);
      return fail("Une des boîtes choisies n'existe plus. Reprends l'écran.");
    }

    lignes.push({
      organization_id: org.id,
      box_id: boite.id,
      realm: "pro",
      content: idee.texte,
      created_by: userId,
    });
  }

  const { error } = await supabase.from("sas_notes").insert(lignes);

  if (error) {
    await defaire(supabase, creees);
    return fail("Rien n'a été enregistré. Réessaie dans un instant.");
  }

  rafraichir(orgSlug);
  return ok({ rangees: lignes.length });
}

/**
 * Une idée qui bouge change plusieurs écrans à la fois : sa boîte, la liste
 * des boîtes et son compteur, « À ranger », Perso, et jusqu'à la recherche.
 * Les énumérer un par un serait un oubli qui attend son heure — `"layout"`
 * balaie l'outil entier, et l'outil entier est petit.
 */
function rafraichir(orgSlug: string) {
  revalidatePath(`/app/${orgSlug}/sas`, "layout");
}

/** Les boîtes créées pour rien, retirées : l'échec ne laisse pas de trace. */
async function defaire(
  supabase: Awaited<ReturnType<typeof createClient>>,
  creees: Boite[],
) {
  if (creees.length === 0) return;
  await supabase
    .from("sas_boxes")
    .delete()
    .in(
      "id",
      creees.map((boite) => boite.id),
    );
}

// --------------------------------- Les boîtes --------------------------------

/**
 * Créer une boîte à la main, sans passer par une capture.
 *
 * L'unicité est portée par la base — `unique (organization_id, name)`. On la
 * devance quand même par un `trouverBoite` souple, parce que la contrainte,
 * elle, distingue « Flora » de « flora » : deux boîtes qui se ressemblent
 * seraient acceptées par Postgres et confondues par Louis.
 */
export async function creerBoite(
  orgSlug: string,
  nom: unknown,
): Promise<ActionResult<{ id: string }>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = nomBoiteSchema.safeParse(nom);
  if (!parsed.success) return failFromZod(parsed.error);

  const boites = await getBoites(membre.org.id);
  if (trouverBoite(parsed.data, boites)) {
    return fail("Une boîte porte déjà ce nom.");
  }

  const { data, error } = await membre.supabase
    .from("sas_boxes")
    .insert({
      organization_id: membre.org.id,
      name: parsed.data,
      created_by: membre.userId,
    })
    .select("id")
    .single();

  if (error || !data) return fail("Cette boîte n'a pas pu être créée.");

  rafraichir(orgSlug);
  return ok({ id: data.id });
}

export async function renommerBoite(
  orgSlug: string,
  boxId: unknown,
  nom: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const cible = identifiant.safeParse(boxId);
  if (!cible.success) return fail("Cette boîte est introuvable.");

  const parsed = nomBoiteSchema.safeParse(nom);
  if (!parsed.success) return failFromZod(parsed.error);

  const boites = await getBoites(membre.org.id);
  const homonyme = trouverBoite(parsed.data, boites);
  if (homonyme && homonyme.id !== cible.data) {
    return fail("Une autre boîte porte déjà ce nom.");
  }

  const { data, error } = await membre.supabase
    .from("sas_boxes")
    .update({ name: parsed.data })
    .eq("id", cible.data)
    .select("id");

  if (error || !data || data.length === 0) {
    return fail("Cette boîte n'a pas pu être renommée.");
  }

  rafraichir(orgSlug);
  return ok();
}

/**
 * Supprimer une boîte n'efface aucune idée : `on delete set null` les rend à
 * « À ranger ». C'est la migration qui le garantit, pas cette fonction — on
 * n'a donc rien à faire ici qu'à supprimer la ligne.
 */
export async function supprimerBoite(
  orgSlug: string,
  boxId: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const cible = identifiant.safeParse(boxId);
  if (!cible.success) return fail("Cette boîte est introuvable.");

  const { data, error } = await membre.supabase
    .from("sas_boxes")
    .delete()
    .eq("id", cible.data)
    .select("id");

  if (error || !data || data.length === 0) {
    return fail("Cette boîte n'a pas pu être supprimée.");
  }

  rafraichir(orgSlug);
  return ok();
}

// --------------------------------- Les idées ---------------------------------

export async function modifierNote(
  orgSlug: string,
  noteId: unknown,
  texte: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const cible = identifiant.safeParse(noteId);
  if (!cible.success) return fail("Cette idée est introuvable.");

  const parsed = texteIdeeSchema.safeParse(texte);
  if (!parsed.success) return failFromZod(parsed.error);

  const { data, error } = await membre.supabase
    .from("sas_notes")
    .update({ content: parsed.data })
    .eq("id", cible.data)
    .select("id");

  if (error || !data || data.length === 0) {
    return fail("Cette idée n'a pas pu être modifiée.");
  }

  rafraichir(orgSlug);
  return ok();
}

/**
 * Archiver, ou restaurer. `archived_at` suit l'état : une idée restaurée ne
 * garde pas la date de son archivage, sinon la colonne mentirait sur ce
 * qu'elle raconte.
 */
export async function archiverNote(
  orgSlug: string,
  noteId: unknown,
  archiver: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const cible = identifiant.safeParse(noteId);
  if (!cible.success) return fail("Cette idée est introuvable.");

  const etat = z.boolean().safeParse(archiver);
  if (!etat.success) return fail("Geste inconnu.");

  const { data, error } = await membre.supabase
    .from("sas_notes")
    .update({
      is_archived: etat.data,
      archived_at: etat.data ? new Date().toISOString() : null,
    })
    .eq("id", cible.data)
    .select("id");

  if (error || !data || data.length === 0) {
    return fail(
      etat.data
        ? "Cette idée n'a pas pu être archivée."
        : "Cette idée n'a pas pu être restaurée.",
    );
  }

  rafraichir(orgSlug);
  return ok();
}

export async function supprimerNote(
  orgSlug: string,
  noteId: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const cible = identifiant.safeParse(noteId);
  if (!cible.success) return fail("Cette idée est introuvable.");

  const { data, error } = await membre.supabase
    .from("sas_notes")
    .delete()
    .eq("id", cible.data)
    .select("id");

  if (error || !data || data.length === 0) {
    return fail("Cette idée n'a pas pu être supprimée.");
  }

  rafraichir(orgSlug);
  return ok();
}

/**
 * Déplacer une idée d'une place à l'autre.
 *
 * L'univers et la boîte partent dans la même écriture : les séparer ferait
 * exister, entre les deux, une note perso rangée dans une boîte — que la
 * contrainte de table refuse, et à juste titre.
 */
export async function deplacerNote(
  orgSlug: string,
  noteId: unknown,
  place: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const cible = identifiant.safeParse(noteId);
  if (!cible.success) return fail("Cette idée est introuvable.");

  const parsed = placeSchema.safeParse(place);
  if (!parsed.success) return fail("Destination inconnue.");

  const destination = parsed.data;

  const champs =
    destination.type === "perso"
      ? { realm: "perso" as const, box_id: null }
      : destination.type === "aranger"
        ? { realm: "pro" as const, box_id: null }
        : { realm: "pro" as const, box_id: destination.boiteId };

  const { data, error } = await membre.supabase
    .from("sas_notes")
    .update(champs)
    .eq("id", cible.data)
    .select("id");

  if (error || !data || data.length === 0) {
    return fail("Cette idée n'a pas pu être déplacée.");
  }

  rafraichir(orgSlug);
  return ok();
}
