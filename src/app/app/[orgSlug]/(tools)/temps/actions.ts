"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getMembership } from "@/lib/access";
import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { jourParis, midiParis } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { nomDuFichier, versCsv } from "@/tools/pulsar/csv";
import { arrondirQuartHeure, phaseDuClient } from "@/tools/pulsar/duree";
import { resoudreCorrection } from "@/tools/pulsar/horaire";
import {
  getClients,
  getEntreesEntre,
  PLAFOND_EXPORT,
} from "@/tools/pulsar/queries";
import {
  LIMITE_NOTE,
  MAXIMUM_MANUEL,
  MINIMUM_MINUTES,
  PAS_MINUTES,
  type ClientPulsar,
  type Modele,
  type Profil,
  type Statut,
} from "@/tools/pulsar/types";

/**
 * Les cinq gestes de Pulsar : démarrer, arrêter, saisir, corriger, supprimer.
 *
 * Démarrer ajoute, et n'arrête rien. Deux chronomètres sur le même créneau
 * sont un choix — un appel pendant qu'un export tourne — et la journée peut
 * compter plus d'heures que l'horloge : ni chevauchement interdit, ni
 * avertissement. Le seul refus est le plafond de quatre, que la base tient et
 * dont elle écrit la phrase : au-delà, on n'a pas cinq fronts ouverts, on a
 * oublié d'en arrêter un.
 *
 * Corriger ne demande jamais de supprimer puis ressaisir : un chronomètre
 * parti trop tard se recale, un chronomètre oublié s'arrête à la durée qu'il
 * aurait dû compter, une entrée d'un autre jour reprend son début, sa fin et
 * sa durée.
 *
 * Le chronomètre vit ici, côté serveur, et nulle part ailleurs : il survit à
 * la fermeture du téléphone et se retrouve sur l'ordinateur. Ce qui défile à
 * l'écran n'est qu'un compteur local calé sur `started_at`.
 */

/**
 * Accès à l'outil pour cette organisation, ou `null`.
 *
 * Comme pour Capsule et Sas : `has_tool()` répond faux avec la clé secrète, on
 * interroge donc la base avec la session, exactement comme la garde des pages.
 */
async function acces(orgSlug: string) {
  const membre = await getMembership(orgSlug);
  if (!membre) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("can_access_temps", { org: membre.org.id });

  return data === true ? { ...membre, supabase } : null;
}

type Acces = NonNullable<Awaited<ReturnType<typeof acces>>>;

// -------------------------------- Les saisies --------------------------------

const identifiant = z.uuid({ error: "Cette ligne n'existe plus." });

const tacheSchema = z.enum(
  ["site", "ads", "emails", "tracking", "reunion", "seo", "prospection", "admin"],
  { error: "Choisis un type de tâche." },
);

/**
 * Une note vide et une note absente sont la même chose : `null`.
 *
 * Sans ça, corriger une entrée pour effacer sa note y laisserait une chaîne
 * vide, que la liste afficherait comme un tiret orphelin.
 */
const noteSchema = z
  .string()
  .trim()
  .max(LIMITE_NOTE, {
    error: `Une note ne peut pas dépasser ${LIMITE_NOTE} caractères.`,
  })
  .transform((valeur) => (valeur.length === 0 ? null : valeur))
  .nullable()
  .optional();

/**
 * Les minutes d'une saisie : un multiple du quart d'heure, comme en base.
 *
 * Le pas est déjà imposé par le champ à l'écran ; il est revérifié ici parce
 * qu'une action ne fait pas confiance à son écran, et parce que le message de
 * la base — une violation de contrainte — n'est pas une phrase qu'on montre.
 */
const minutesSchema = z
  .number({ error: "Indique une durée." })
  .int({ error: "Une durée se compte en minutes entières." })
  .min(MINIMUM_MINUTES, { error: "Un quart d'heure au minimum." })
  .max(MAXIMUM_MANUEL, { error: "Plus de 12 h d'un coup : coupe la saisie en deux." })
  .refine((valeur) => valeur % PAS_MINUTES === 0, {
    error: "Les durées se comptent par quarts d'heure.",
  });

const demarrerSchema = z.object({
  clientId: identifiant,
  task: tacheSchema,
  note: noteSchema,
});

const saisirSchema = z.object({
  clientId: identifiant,
  task: tacheSchema,
  minutes: minutesSchema,
  jour: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choisis une date." }),
  note: noteSchema,
});

/**
 * Une correction : l'horaire en minutes depuis le minuit du jour, à Paris.
 *
 * La durée n'a pas de plafond ici, contrairement à la saisie : une entrée
 * d'avant les règles — un chronomètre oublié vingt heures — doit pouvoir
 * s'annoter sans qu'on lui demande d'abord d'être raisonnable. Les douze
 * heures se jugent dans `resoudreCorrection`, sur ce qu'on déplace.
 */
const corrigerSchema = z
  .object({
    id: identifiant,
    clientId: identifiant,
    task: tacheSchema,
    jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choisis une date." }),
    debut: z
      .number({ error: "Indique un début." })
      .int()
      .min(0, { error: "Indique un début." })
      .max(24 * 60 - 1, { error: "Indique un début." }),
    fin: z
      .number({ error: "Indique une fin." })
      .int()
      .min(1, { error: "Indique une fin." })
      .max(7 * 24 * 60, { error: "Indique une fin." })
      .nullable(),
    minutes: z
      .number({ error: "Indique une durée." })
      .int({ error: "Une durée se compte en minutes entières." })
      .min(MINIMUM_MINUTES, { error: "Un quart d'heure au minimum." })
      .refine((valeur) => valeur % PAS_MINUTES === 0, {
        error: "Les durées se comptent par quarts d'heure.",
      })
      .nullable(),
    note: noteSchema,
  })
  .refine((saisie) => (saisie.fin === null) === (saisie.minutes === null), {
    error: "Donne une fin et une durée, ou ni l'une ni l'autre.",
    path: ["fin"],
  });

// --------------------------------- Le client ---------------------------------

/**
 * Le client visé, tel que la RLS le laisse voir, et refus s'il est archivé.
 *
 * Un client terminé sort des puces : compter des heures dessus, ce serait
 * rouvrir un dossier sans le dire. Le message propose le geste qui débloque
 * plutôt que de constater l'interdit.
 */
async function clientOuvert(
  { supabase, org }: Acces,
  clientId: string,
): Promise<{ ok: true; client: ClientPulsar } | { ok: false; error: string }> {
  const { data } = await supabase
    .from("pulsar_clients")
    .select("id, name, is_internal, statut")
    .eq("organization_id", org.id)
    .eq("id", clientId)
    .maybeSingle();

  if (!data) return { ok: false, error: "Ce client n'existe plus." };

  if (data.statut === "termine") {
    return {
      ok: false,
      error: `${data.name} est terminé. Repasse-le en pilotage pour compter des heures.`,
    };
  }

  return { ok: true, client: data };
}

// -------------------------------- Les actions --------------------------------

/**
 * Démarrer. N'arrête rien : un chronomètre de plus, jusqu'à quatre.
 *
 * Ce que l'action rend n'est pas « c'est parti » — l'écran le sait déjà — mais
 * combien tournent désormais, pour que la confirmation rappelle les autres
 * plutôt que de féliciter.
 */
export async function demarrer(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ enCours: number }>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = demarrerSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const cible = await clientOuvert(membre, parsed.data.clientId);
  if (!cible.ok) return fail(cible.error);

  const { supabase, org, userId } = membre;

  const { error } = await supabase.from("pulsar_entries").insert({
    organization_id: org.id,
    client_id: cible.client.id,
    task: parsed.data.task,
    phase: phaseDuClient(cible.client),
    started_at: new Date().toISOString(),
    note: parsed.data.note ?? null,
    created_by: userId,
  });

  /*
   * P0001 : le plafond de la migration 0020, le seul refus possible ici. Sa
   * phrase est écrite pour être lue ; on la laisse passer plutôt que de la
   * réécrire et de la laisser diverger. L'écran la dit déjà quand quatre
   * tournent — elle ne remonte que d'un autre appareil, ou d'un double tap.
   */
  if (error) {
    return fail(
      error.code === "P0001" && error.message
        ? error.message
        : "Le chronomètre n'est pas parti. Réessaie.",
    );
  }

  rafraichir(orgSlug);

  const { count } = await supabase
    .from("pulsar_entries")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
    .eq("created_by", userId)
    .is("ended_at", null);

  return ok({ enCours: count ?? 1 });
}

/**
 * Arrêter un chronomètre, et dire ce qu'il a compté.
 *
 * L'arrondi se fait sur l'écart réel entre le départ et maintenant ; la fin
 * enregistrée, elle, est l'instant vrai. Les deux ne coïncident pas, et c'est
 * voulu : sept minutes de travail valent quinze minutes comptées, mais elles
 * ont bien eu lieu à 14 h 07.
 *
 * Rend `null` si celui-là ne tournait plus : arrêté depuis l'ordinateur
 * pendant qu'on tapait sur le téléphone, ou appuyé deux fois. Ce n'est pas une
 * faute, et l'écriture ne vise que ce qui tourne encore — le second appui ne
 * réécrit pas la fin du premier.
 *
 * Ne pas passer de note, c'est ne pas y toucher — ce que fait la pastille de
 * l'en-tête, qui arrête sans rien savoir de ce qui a été écrit ailleurs.
 * Passer une chaîne vide, en revanche, efface : c'est le champ vidé exprès.
 */
export async function arreter(
  orgSlug: string,
  id: unknown,
  note?: unknown,
): Promise<ActionResult<{ minutes: number; client: string } | null>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const cible = identifiant.safeParse(id);
  if (!cible.success) return fail("Ce chronomètre n'existe plus.");

  const parsed = noteSchema.safeParse(note);
  if (!parsed.success) return failFromZod(parsed.error);

  const { supabase, org, userId } = membre;

  const { data: enCours } = await supabase
    .from("pulsar_entries")
    .select("id, client_id, started_at")
    .eq("organization_id", org.id)
    .eq("created_by", userId)
    .eq("id", cible.data)
    .is("ended_at", null)
    .maybeSingle();

  if (!enCours) {
    rafraichir(orgSlug);
    return ok(null);
  }

  const fin = new Date();
  const minutes = arrondirQuartHeure(fin.getTime() - Date.parse(enCours.started_at));

  const { data: arrete, error } = await supabase
    .from("pulsar_entries")
    .update({
      ended_at: fin.toISOString(),
      duration_minutes: minutes,
      // La note part dans la même écriture que l'arrêt : celle qu'on vient de
      // taper ne doit pas dépendre d'un second aller-retour qui peut échouer.
      ...(note === undefined ? {} : { note: parsed.data ?? null }),
    })
    .eq("id", enCours.id)
    .is("ended_at", null)
    .select("id");

  if (error) return fail("Le chronomètre ne s'est pas arrêté. Réessaie.");

  rafraichir(orgSlug);
  if (!arrete || arrete.length === 0) return ok(null);

  const nom = await nomDuClient(membre, enCours.client_id);
  return ok({ minutes, client: nom });
}

/**
 * Noter, pendant qu'un chronomètre tourne.
 *
 * Le champ enregistre en quittant le focus, sans rien dire : c'est la seule
 * chose de cet écran qui existe déjà en base et qu'on ne pourrait pas
 * retrouver autrement. Un chronomètre démarré sur le téléphone s'arrête sur
 * l'ordinateur — la note tapée en route ne doit pas dépendre de l'appareil
 * qui appuie sur Arrêter.
 *
 * Silencieuse quand il ne tourne plus : le champ a pu perdre le focus juste
 * après l'arrêt, et ce n'est pas une nouvelle à annoncer.
 */
export async function noter(
  orgSlug: string,
  id: unknown,
  note: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const cible = identifiant.safeParse(id);
  if (!cible.success) return ok();

  const parsed = noteSchema.safeParse(note);
  if (!parsed.success) return failFromZod(parsed.error);

  const { error } = await membre.supabase
    .from("pulsar_entries")
    .update({ note: parsed.data ?? null })
    .eq("organization_id", membre.org.id)
    .eq("created_by", membre.userId)
    .eq("id", cible.data)
    .is("ended_at", null);

  if (error) return fail("Cette note n'a pas été enregistrée.");

  return ok();
}

/**
 * Saisir une heure oubliée.
 *
 * L'entrée est ancrée à midi, heure de Paris : elle n'a pas eu lieu à midi, et
 * l'écran ne prétend pas le contraire — il affiche « saisie » là où les autres
 * portent leur heure. Midi parce qu'aucun changement d'heure ne le déplace
 * d'un jour, et parce qu'une saisie de six heures posée là ne déborde jamais
 * sur le lendemain.
 */
export async function saisir(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ minutes: number }>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = saisirSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  if (parsed.data.jour > jourParis()) {
    return fail("On ne compte pas des heures à l'avance.", "jour");
  }

  const cible = await clientOuvert(membre, parsed.data.clientId);
  if (!cible.ok) return fail(cible.error);

  const debut = midiParis(parsed.data.jour);
  const fin = new Date(Date.parse(debut) + parsed.data.minutes * 60_000);

  const { error } = await membre.supabase.from("pulsar_entries").insert({
    organization_id: membre.org.id,
    client_id: cible.client.id,
    task: parsed.data.task,
    phase: phaseDuClient(cible.client),
    started_at: debut,
    ended_at: fin.toISOString(),
    duration_minutes: parsed.data.minutes,
    note: parsed.data.note ?? null,
    is_manual: true,
    created_by: membre.userId,
  });

  if (error) return fail("Cette saisie n'a pas été enregistrée. Réessaie.");

  rafraichir(orgSlug);
  return ok({ minutes: parsed.data.minutes });
}

/**
 * Corriger une entrée — terminée, ou encore en marche.
 *
 * Tout ce qui décide de l'horaire écrit est dans `resoudreCorrection`, que le
 * formulaire consulte aussi avant l'envoi : l'action ne fait que lire l'entrée,
 * vérifier le client, et écrire ce qui a été résolu.
 *
 * La phase n'est jamais recalculée, même quand le client change : elle dit ce
 * qu'était ce client au moment où l'on a travaillé, et c'est tout l'intérêt
 * qu'elle soit figée. Corriger le client d'une entrée, c'est réparer une
 * erreur de doigt, pas réécrire l'histoire du dossier.
 *
 * Pour la même raison, un client archivé n'empêche pas de corriger ses propres
 * heures — celles de juin, relues en septembre depuis Par client. Il n'est
 * refusé que comme destination : y ranger une entrée qui n'y était pas, ce
 * serait rouvrir le dossier sans le dire.
 */
export async function corriger(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ arrete: { minutes: number; client: string } | null }>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = corrigerSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const { supabase, org, userId } = membre;
  const saisie = parsed.data;

  const { data: entree } = await supabase
    .from("pulsar_entries")
    .select("id, client_id, created_by, started_at, ended_at, duration_minutes, is_manual")
    .eq("organization_id", org.id)
    .eq("id", saisie.id)
    .maybeSingle();

  if (!entree) return fail("Cette ligne n'existe plus.");

  const enCours = entree.ended_at === null;
  if (enCours && entree.created_by !== userId) {
    return fail("Ce chronomètre n'est pas le tien.");
  }

  if (saisie.clientId !== entree.client_id) {
    const cible = await clientOuvert(membre, saisie.clientId);
    if (!cible.ok) return fail(cible.error, "clientId");
  }

  const resolution = resoudreCorrection(
    entree,
    { jour: saisie.jour, debut: saisie.debut, fin: saisie.fin, minutes: saisie.minutes },
    Date.now(),
  );
  if (!resolution.ok) return fail(resolution.error, resolution.champ);

  const ecriture = supabase
    .from("pulsar_entries")
    .update({
      client_id: saisie.clientId,
      task: saisie.task,
      note: saisie.note ?? null,
      ...resolution.ecriture,
    })
    .eq("id", entree.id);

  /*
   * Un chronomètre ne se corrige que s'il tourne encore au moment d'écrire :
   * arrêté depuis l'ordinateur pendant qu'on le corrigeait sur le téléphone,
   * la correction partirait d'un état qui n'existe plus et écraserait la fin
   * que l'autre appareil vient de poser.
   */
  const { data: ecrite, error } = await (enCours
    ? ecriture.is("ended_at", null)
    : ecriture
  ).select("id");

  if (error) return fail("La correction n'a pas été enregistrée. Réessaie.");
  if (!ecrite || ecrite.length === 0) {
    return fail("Ce chronomètre vient d'être arrêté ailleurs. Corrige-le depuis ta journée.");
  }

  rafraichir(orgSlug);

  if (!enCours || resolution.ecriture.duration_minutes === undefined) {
    return ok({ arrete: null });
  }

  const nom = await nomDuClient(membre, saisie.clientId);
  return ok({ arrete: { minutes: resolution.ecriture.duration_minutes, client: nom } });
}

/** Supprimer. C'est un carnet personnel : aucune limite de temps, aucune trace. */
export async function supprimer(
  orgSlug: string,
  id: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = identifiant.safeParse(id);
  if (!parsed.success) return fail("Cette ligne n'existe plus.");

  const { error } = await membre.supabase
    .from("pulsar_entries")
    .delete()
    .eq("organization_id", membre.org.id)
    .eq("id", parsed.data);

  if (error) return fail("Cette ligne n'a pas pu être supprimée. Réessaie.");

  rafraichir(orgSlug);
  return ok();
}

// -------------------------------- Les fiches ---------------------------------

/**
 * Les montants se déclarent en euros entiers.
 *
 * La base range des centimes, comme partout dans le hub, mais un forfait n'a
 * pas de centimes : 550 €, pas 550,00 €. Accepter la virgule ouvrirait la
 * porte au « 550.5 » qu'on relit « 550,05 » six mois plus tard.
 */
const montantSchema = z
  .number({ error: "Indique un montant." })
  .int({ error: "Un montant se déclare en euros entiers." })
  .min(0, { error: "Un montant ne peut pas être négatif." })
  .max(1_000_000, { error: "Ce montant dépasse ce que Pulsar sait compter." });

const jourSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Cette date n'est pas lisible." })
  .nullable()
  .optional();

const ficheSchema = z
  .object({
    id: identifiant.optional(),
    name: z
      .string()
      .trim()
      .min(1, { error: "Donne un nom à ce client." })
      .max(60, { error: "Le nom d'un client ne peut pas dépasser 60 caractères." }),
    profil: z.enum(["p1", "p2", "p3", "hors_cible"]).nullable().optional(),
    modele: z.enum(["recurrent", "one_shot", "commission", "historique"], {
      error: "Choisis un modèle.",
    }),
    montantEuros: montantSchema,
    dateDebut: jourSchema,
    finEngagement: jourSchema,
    statut: z.enum(["setup", "pilotage", "termine"], { error: "Choisis un statut." }),
  })
  /*
   * Les règles du brief, dites ici plutôt qu'à l'écran seul : un récurrent
   * sans date de début ne rapporte rien et personne ne comprend pourquoi —
   * c'est le genre de zéro qu'on met trois mois à remarquer.
   */
  .refine((fiche) => fiche.modele !== "recurrent" || Boolean(fiche.dateDebut), {
    error: "Un récurrent a besoin de sa date de début pour compter ses mois.",
    path: ["dateDebut"],
  })
  .refine((fiche) => fiche.modele !== "one_shot" || Boolean(fiche.dateDebut), {
    error: "Un one-shot a besoin de sa date pour savoir sur quel mois compter.",
    path: ["dateDebut"],
  })
  .refine((fiche) => fiche.modele !== "one_shot" || fiche.montantEuros > 0, {
    error: "Un one-shot sans montant ne compte rien.",
    path: ["montantEuros"],
  })
  .refine(
    (fiche) =>
      !fiche.finEngagement ||
      !fiche.dateDebut ||
      fiche.finEngagement >= fiche.dateDebut,
    {
      error: "La fin de l'engagement tombe avant son début.",
      path: ["finEngagement"],
    },
  );

/**
 * Ce qui part en base, une fois les règles appliquées.
 *
 * Deux d'entre elles se voient ici et nulle part ailleurs :
 *
 * - `commission` et `historique` rangent zéro. Leur encaissé vaut zéro en v1,
 *   et garder un montant qui ne compte nulle part ferait dire au taux horaire
 *   quelque chose que personne n'a demandé. La fiche grise le champ, cette
 *   ligne le rend vrai.
 * - un client qu'on passe en `termine` sans date de fin reçoit celle du jour.
 *   C'est ainsi que « le passage en terminé » de la décision 8 s'écrit : une
 *   date, pas un état — sans quoi son récurrent continuerait de compter des
 *   mois après son départ.
 */
type LigneFiche = {
  name: string;
  profil: Profil | null;
  modele: Modele;
  montant_cents: number;
  date_debut: string | null;
  fin_engagement: string | null;
  statut: Statut;
};

function ligneDeFiche(fiche: z.infer<typeof ficheSchema>): LigneFiche {
  const facturant = fiche.modele === "recurrent" || fiche.modele === "one_shot";

  const fin =
    fiche.statut === "termine" && !fiche.finEngagement
      ? jourParis()
      : (fiche.finEngagement ?? null);

  return {
    name: fiche.name,
    profil: fiche.profil ?? null,
    modele: fiche.modele,
    montant_cents: facturant ? fiche.montantEuros * 100 : 0,
    date_debut: fiche.dateDebut ?? null,
    fin_engagement: fin,
    statut: fiche.statut,
  };
}

export async function enregistrerClient(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = ficheSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const { supabase, org } = membre;
  const ligne = ligneDeFiche(parsed.data);

  if (parsed.data.id) {
    const { data, error } = await supabase
      .from("pulsar_clients")
      .update(ligne)
      .eq("organization_id", org.id)
      .eq("id", parsed.data.id)
      .select("id")
      .maybeSingle();

    if (error) return fail(messageDeFiche(error, parsed.data.name));
    if (!data) return fail("Ce client n'existe plus, ou ne se modifie pas.");

    rafraichir(orgSlug);
    return ok({ id: data.id });
  }

  const { data, error } = await supabase
    .from("pulsar_clients")
    .insert({ organization_id: org.id, ...ligne })
    .select("id")
    .maybeSingle();

  if (error) return fail(messageDeFiche(error, parsed.data.name));
  if (!data) return fail("Ce client n'a pas été créé. Réessaie.");

  rafraichir(orgSlug);
  return ok({ id: data.id });
}

/**
 * Archiver : le client sort des listes du chronomètre, ses heures restent dans
 * les chiffres. C'est le geste prévu à la place de la suppression, et la base
 * refuse l'autre dès qu'une heure est comptée.
 */
export async function archiverClient(
  orgSlug: string,
  id: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = identifiant.safeParse(id);
  if (!parsed.success) return fail("Ce client n'existe plus.");

  const { data: fiche } = await membre.supabase
    .from("pulsar_clients")
    .select("id, fin_engagement, is_internal")
    .eq("organization_id", membre.org.id)
    .eq("id", parsed.data)
    .maybeSingle();

  if (!fiche) return fail("Ce client n'existe plus.");
  if (fiche.is_internal) return fail("« Comète » porte ton non facturable : il reste.");

  const { error } = await membre.supabase
    .from("pulsar_clients")
    .update({
      statut: "termine",
      fin_engagement: fiche.fin_engagement ?? jourParis(),
    })
    .eq("id", fiche.id);

  if (error) return fail("Ce client n'a pas été archivé. Réessaie.");

  rafraichir(orgSlug);
  return ok();
}

/** Supprimer. Refusé par la base dès qu'une heure pend à ce client. */
export async function supprimerClient(
  orgSlug: string,
  id: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = identifiant.safeParse(id);
  if (!parsed.success) return fail("Ce client n'existe plus.");

  const { data, error } = await membre.supabase
    .from("pulsar_clients")
    .delete()
    .eq("organization_id", membre.org.id)
    .eq("id", parsed.data)
    .select("id");

  if (error) {
    return fail(
      error.code === "23503"
        ? "Ce client porte des heures : passe-le en terminé plutôt que de l'effacer."
        : "Ce client n'a pas pu être supprimé. Réessaie.",
    );
  }

  // Zéro ligne : la policy a écarté la cible — « Comète » est le seul cas.
  if (!data || data.length === 0) {
    return fail("« Comète » porte ton non facturable : il ne se supprime pas.");
  }

  rafraichir(orgSlug);
  return ok();
}

/**
 * Les erreurs de la base, dites en français.
 *
 * `P0001` est le code des gardes qu'on a posées soi-même dans la migration —
 * « Comète » qu'on renomme, un client qu'on promeut interne. Leurs messages
 * sont déjà écrits pour être lus, on les laisse passer tels quels plutôt que
 * de les traduire une seconde fois et de les laisser diverger.
 */
function messageDeFiche(
  error: { code?: string; message?: string },
  nom: string,
): string {
  if (error.code === "23505") return `Tu as déjà un client nommé « ${nom} ».`;
  if (error.code === "23514") return "Ces dates ne tiennent pas ensemble.";
  if (error.code === "P0001" && error.message) return error.message;
  return "Cette fiche n'a pas été enregistrée. Réessaie.";
}

// -------------------------------- Les réglages -------------------------------

/**
 * Les deux seuils d'alerte.
 *
 * Ils ne changent rien à ce qui est compté : ils décident de ce qui passe en
 * orange. Les bornes sont larges à dessein — c'est le jugement de Louis, pas
 * celui de l'outil — mais un plafond à zéro heure allumerait tout, et un seuil
 * de mille euros de l'heure n'éteindrait plus rien.
 */
const reglagesSchema = z.object({
  tauxAlerteEuros: z
    .number({ error: "Indique un seuil." })
    .int({ error: "Un seuil se déclare en euros entiers." })
    .min(0, { error: "Un seuil ne peut pas être négatif." })
    .max(1000, { error: "Au-delà de 1 000 €/h, l'alerte ne s'éteindrait jamais." }),
  heuresPilotageAlerte: z
    .number({ error: "Indique un plafond." })
    .int({ error: "Un plafond se compte en heures entières." })
    .min(1, { error: "Un plafond à zéro heure allumerait tous tes clients." })
    .max(500, { error: "Ce plafond ne s'atteindra jamais." }),
});

export async function enregistrerReglages(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = reglagesSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  /*
   * `upsert` plutôt qu'`update` : l'amorçage pose la ligne à l'activation,
   * mais une organisation dont l'outil aurait été activé avant la phase 8
   * n'en aurait pas, et les réglages doivent rester modifiables sans que
   * personne n'ait à s'en apercevoir.
   */
  const { error } = await membre.supabase.from("pulsar_settings").upsert(
    {
      organization_id: membre.org.id,
      taux_alerte_cents: parsed.data.tauxAlerteEuros * 100,
      heures_pilotage_alerte: parsed.data.heuresPilotageAlerte,
    },
    { onConflict: "organization_id" },
  );

  if (error) return fail("Ces seuils n'ont pas été enregistrés. Réessaie.");

  rafraichir(orgSlug);
  return ok();
}

// --------------------------------- L'export ----------------------------------

const periodeSchema = z
  .object({
    depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choisis une date de début." }),
    jusqua: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choisis une date de fin." }),
  })
  .refine((periode) => periode.jusqua >= periode.depuis, {
    error: "La fin de la période tombe avant son début.",
    path: ["jusqua"],
  });

/**
 * Les entrées d'une période, en CSV.
 *
 * Le fichier se fabrique ici et non dans le navigateur, contrairement au
 * relevé de Radar : les lignes d'une période choisie ne sont pas à l'écran,
 * et les rapatrier pour les recopier ensuite ferait deux fois le travail.
 * Le navigateur ne pose que le BOM et déclenche le téléchargement.
 *
 * Au-delà du plafond, on refuse plutôt que de tronquer : un fichier amputé
 * ressemble trait pour trait à un fichier complet.
 */
export async function exporterEntrees(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ csv: string; nom: string; lignes: number }>> {
  const membre = await acces(orgSlug);
  if (!membre) return fail("Cet espace n'est plus accessible.");

  const parsed = periodeSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);

  const { depuis, jusqua } = parsed.data;

  const [clients, entrees] = await Promise.all([
    getClients(membre.org.id),
    getEntreesEntre(membre.org.id, depuis, jusqua),
  ]);

  if (entrees.length > PLAFOND_EXPORT) {
    return fail(
      `Cette période dépasse ${PLAFOND_EXPORT.toLocaleString("fr-FR")} entrées. Coupe-la en deux.`,
      "jusqua",
    );
  }

  const noms = new Map(clients.map((client) => [client.id, client.name]));

  const csv = versCsv(
    entrees.map((entree) => ({
      jour: jourParis(entree.started_at),
      client: noms.get(entree.client_id) ?? "Client retiré",
      entree,
    })),
  );

  return ok({ csv, nom: nomDuFichier(depuis, jusqua), lignes: entrees.length });
}

// --------------------------------- Le reste ----------------------------------

/** Le nom d'un client, pour les phrases de confirmation. */
async function nomDuClient({ supabase, org }: Acces, clientId: string): Promise<string> {
  const { data } = await supabase
    .from("pulsar_clients")
    .select("name")
    .eq("organization_id", org.id)
    .eq("id", clientId)
    .maybeSingle();

  return data?.name ?? "ce client";
}

/**
 * Une heure comptée change la journée, la semaine, la pastille de l'en-tête,
 * les écrans Par client et Comète. `"layout"` balaie l'outil entier, et
 * l'outil entier est petit.
 */
function rafraichir(orgSlug: string) {
  revalidatePath(`/app/${orgSlug}/temps`, "layout");
}
