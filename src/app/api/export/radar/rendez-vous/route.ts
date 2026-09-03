import { createHash, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { creerLimiteur } from "@/lib/debit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COLONNES_EXPORT,
  decoderCurseur,
  encoderCurseur,
  LIGNES_PAR_PAGE,
  bornesParis,
  ligneExport,
  meta,
  plageSchema,
  type CanalLisible,
} from "@/tools/resultats/export";

/**
 * L'export des rendez-vous de Radar, pour un rapport tenu ailleurs.
 *
 * Troisième route du hub sans session, après le webhook Calendly et le point
 * de collecte de Sonde, et la première qui **sort** des données au lieu d'en
 * recevoir. C'est ce qui commande sa forme.
 *
 * Le périmètre ne se demande pas, il se déduit : le jeton désigne une
 * organisation, la requête filtre dessus, et aucun paramètre d'URL ne peut
 * contredire ce choix. Il n'y a donc pas de cloisonnement à écrire — donc pas
 * de cloisonnement à oublier.
 *
 * Ce qui sort est une liste blanche nommée champ par champ dans `export.ts`.
 * Aucun `select *` ici, jamais : la vue gagnera d'autres colonnes, et un
 * chantier futur ne doit pas pouvoir les publier par distraction. Ni nom, ni
 * `invitee_key`, ni note de vente n'y figurent — le banc le vérifie en
 * cherchant les valeurs des fixtures dans le corps de la réponse, plutôt qu'en
 * relisant cette liste. La colonne `utm` est le cas limite de cette règle :
 * elle est lue, mais ce sont quatre champs à plat qui en sortent, pas l'objet
 * — un objet libre est un `select *` qui ne dit pas son nom.
 *
 * Les codes de retour, pour la machine d'en face :
 *
 *   401  jeton absent, inconnu, ou révoqué. Sans corps : on ne dit pas à un
 *        inconnu lequel des trois.
 *   400  la plage de dates est fautive. Avec un motif, lui : c'est une erreur
 *        d'intégration qu'on veut voir corrigée, pas une tentative.
 *   429  trop d'appels. C'est un amortisseur, pas un rempart.
 *   200  la page demandée.
 *
 * Elle n'écrit rien, à une exception près et bornée : `last_used_at`, au plus
 * une fois par minute et par jeton, pour qu'on sache si un rapport branché il
 * y a six mois lit encore.
 */

export const runtime = "nodejs";

/** 32 octets en hexadécimal : la forme que l'administration donne aux jetons. */
const JETON = /^[0-9a-f]{64}$/;

const autorise = creerLimiteur();

/** Le dernier `last_used_at` écrit par jeton, pour ne pas l'écrire à chaque page. */
const derniereTrace = new Map<string, number>();
const TRACE_MS = 60_000;

const sansCorps = (code: number) => new Response(null, { status: code });

const json = (corps: unknown, code = 200) =>
  new Response(JSON.stringify(corps), {
    status: code,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** L'adresse de l'appelant, telle que Vercel la transmet. */
function adresse(entetes: Headers): string {
  const transmise = entetes.get("x-forwarded-for") ?? entetes.get("x-real-ip") ?? "";
  return transmise.split(",")[0]?.trim() || "inconnue";
}

/** `Authorization: Bearer <jeton>`, et rien d'autre. */
function jetonPresente(entetes: Headers): string | null {
  const brut = entetes.get("authorization");
  if (!brut) return null;

  const [schema, valeur] = brut.split(" ");
  if (!schema || schema.toLowerCase() !== "bearer" || !valeur) return null;

  const propre = valeur.trim();
  return JETON.test(propre) ? propre : null;
}

export async function GET(request: NextRequest) {
  try {
    const entetes = request.headers;

    if (!autorise(adresse(entetes))) return sansCorps(429);

    const jeton = jetonPresente(entetes);
    if (!jeton) return sansCorps(401);

    const empreinte = createHash("sha256").update(jeton).digest("hex");

    const admin = createAdminClient();
    const { data: ligne } = await admin
      .from("radar_export_tokens")
      .select("id, organization_id, token_hash, revoked_at")
      .eq("token_hash", empreinte)
      .maybeSingle();

    /*
     * La comparaison en temps constant, après la recherche par index.
     *
     * L'index a déjà tranché, et son temps de réponse ne trahit rien
     * d'exploitable : il faudrait inverser un SHA-256 pour s'en servir. Ce
     * `timingSafeEqual` couvre l'autre moitié — le jour où cette recherche
     * deviendrait un balayage, ou où quelqu'un ajouterait un second critère,
     * la comparaison finale ne sera pas celle qui fuit.
     */
    if (!ligne) return sansCorps(401);

    const attendu = Buffer.from(ligne.token_hash, "utf8");
    const recu = Buffer.from(empreinte, "utf8");
    if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) {
      return sansCorps(401);
    }

    // Révoqué : le même 401 muet qu'un jeton inconnu. Distinguer les deux
    // apprendrait à qui l'a volé qu'il a existé.
    if (ligne.revoked_at) return sansCorps(401);

    // ------------------------------ La demande ------------------------------

    const parametres = request.nextUrl.searchParams;

    const plage = plageSchema.safeParse({
      depuis: parametres.get("depuis") ?? "",
      jusqua: parametres.get("jusqua") ?? "",
    });
    if (!plage.success) {
      return json({ erreur: plage.error.issues[0]?.message ?? "Plage invalide." }, 400);
    }

    const brutCurseur = parametres.get("curseur");
    const curseur = brutCurseur ? decoderCurseur(brutCurseur) : null;
    if (brutCurseur && !curseur) {
      return json({ erreur: "curseur illisible : reprends celui de meta.suivant." }, 400);
    }

    const { debut, fin } = bornesParis(plage.data.depuis, plage.data.jusqua);

    // ------------------------------ La lecture ------------------------------

    let requete = admin
      .from("radar_bookings_effective")
      .select(COLONNES_EXPORT)
      .eq("organization_id", ligne.organization_id)
      .gte("scheduled_start", debut)
      .lte("scheduled_start", fin);

    /*
     * La pagination par clé, et non par `offset` : une ligne insérée pendant
     * qu'un rapport tourne décalerait toutes les pages suivantes d'un cran,
     * et le consommateur perdrait une ligne sans jamais le savoir. Ici, une
     * ligne est avant ou après le curseur, et rien ne bouge.
     *
     * Les deux valeurs viennent de `decoderCurseur`, qui refuse tout ce qui
     * n'a pas la forme d'un horodatage et d'un UUID : elles n'ont donc pas de
     * quoi réécrire cette chaîne de filtre.
     */
    if (curseur) {
      requete = requete.or(
        `scheduled_start.gt."${curseur.s}",and(scheduled_start.eq."${curseur.s}",id.gt.${curseur.i})`,
      );
    }

    // Une ligne de plus que la page : c'est ce qui dit s'il y a une suite,
    // sans compter la table entière à chaque appel.
    const { data, error } = await requete
      .order("scheduled_start", { ascending: true })
      .order("id", { ascending: true })
      .limit(LIGNES_PAR_PAGE + 1);

    if (error || !data) return json({ erreur: "Lecture impossible." }, 500);

    /*
     * La liste de colonnes est construite à l'exécution — c'est ce qui permet
     * de la nommer une seule fois, dans `export.ts`, et de la relire d'un
     * coup d'œil. `supabase-js` ne sait alors plus typer la réponse : on la
     * traite en enregistrements anonymes, et c'est `ligneExport` qui redonne
     * une forme, champ par champ. La sécurité ne repose donc pas sur ce type,
     * mais sur les deux listes explicites qui l'encadrent.
     */
    const lues = data as unknown as Record<string, unknown>[];

    const encore = lues.length > LIGNES_PAR_PAGE;
    const page = encore ? lues.slice(0, LIGNES_PAR_PAGE) : lues;

    // Les canaux du client, une fois, pour donner leur clé lisible aux lignes.
    // Une jointure PostgREST sur une vue n'est pas garantie ; sept lignes en
    // mémoire le sont.
    const { data: canaux } = await admin
      .from("radar_channels")
      .select("id, key, label")
      .eq("organization_id", ligne.organization_id);

    const parCanal = new Map<string, CanalLisible>(
      (canaux ?? []).map((canal) => [canal.id, { key: canal.key, label: canal.label }]),
    );

    const derniere = page.at(-1);
    const suivant =
      encore && derniere
        ? encoderCurseur({
            s: String(derniere.scheduled_start),
            i: String(derniere.id),
          })
        : null;

    // ------------------------------ La trace -------------------------------

    /*
     * La seule écriture de cette route. Bornée à une fois par minute et par
     * jeton : un rapport qui pagine dix fois d'affilée ne doit pas coûter dix
     * écritures, et « il s'est servi aujourd'hui » n'a pas besoin de la
     * seconde près.
     */
    const vu = derniereTrace.get(ligne.id) ?? 0;
    if (Date.now() - vu > TRACE_MS) {
      derniereTrace.set(ligne.id, Date.now());
      await admin
        .from("radar_export_tokens")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", ligne.id);
    }

    return json({
      meta: meta(suivant),
      lignes: page.map((brute) => {
        const canal =
          typeof brute.channel_id === "string"
            ? (parCanal.get(brute.channel_id) ?? null)
            : null;
        return ligneExport(brute, canal);
      }),
    });
  } catch {
    // Rien de l'exception ne sort : elle pourrait porter un fragment de ligne.
    return json({ erreur: "Erreur interne." }, 500);
  }
}
