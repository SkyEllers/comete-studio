import { randomBytes } from "node:crypto";

import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Canal } from "@/tools/resultats/attribution";
import { resoudreCanal } from "@/tools/sonde/canaux";
import {
  adresse,
  chemin,
  cleVisiteur,
  corpsSchema,
  creerLimiteur,
  estRobot,
  hote,
  hoteAutorise,
  TAILLE_MAX_CORPS,
  utmRetenus,
} from "@/tools/sonde/collecte";

/**
 * Le point de collecte de Sonde. Deuxième route du hub sans session, après le
 * webhook Calendly, et de très loin la plus exposée : son adresse est publique,
 * elle est écrite en clair dans le HTML de chaque landing.
 *
 * D'où une règle qui commande tout le fichier : **elle répond 204 à tout**.
 * Jeton inconnu, origine étrangère, corps malformé, robot, rejeu, panne de
 * notre côté — toujours 204, jamais un mot. Un code différent apprendrait à un
 * inconnu qu'un jeton existe ; un message d'erreur ferait apparaître une ligne
 * rouge dans la console du site d'un client, ce qu'aucun outil de mesure n'a
 * le droit de faire.
 *
 * Ce qui entre en base, en tout et pour tout : le site, l'événement, le
 * chemin, l'hôte du référent, les `utm_*`, le canal, et une clé de visiteur.
 * L'adresse IP et le user-agent traversent cette fonction, entrent dans un
 * HMAC, et disparaissent avec la requête. Aucune table de Sonde n'a de colonne
 * qui pourrait les recevoir — le banc le vérifie plutôt que de le supposer.
 */

export const runtime = "nodejs";

/*
 * `Access-Control-Allow-Origin: *` sur une réponse vide : le script envoie par
 * `sendBeacon`, qui ne lit jamais la réponse, mais son repli `fetch` en lirait
 * l'absence d'en-tête comme une erreur CORS et la signalerait dans la console
 * du client. Il n'y a rien à protéger derrière — pas de corps, pas de cookie,
 * et un jeton déjà public.
 */
const ENTETES = {
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
};

const recu = () => new Response(null, { status: 204, headers: ENTETES });

/** Un jeton a la forme que la base lui donne : de l'hexadécimal, rien d'autre. */
const JETON = /^[0-9a-f]{16,64}$/;

/**
 * Le compteur de débit, à la racine du module : il vit aussi longtemps que
 * l'instance Vercel, ce qui est exactement sa portée. Voir `collecte.ts` pour
 * ce qu'il vaut et ce qu'il ne vaut pas.
 */
const autorise = creerLimiteur();

/**
 * Le sel du jour, gardé en mémoire d'instance avec sa date.
 *
 * Sans ce cache, chaque page vue coûterait une lecture de plus. Avec lui, le
 * changement de jour se voit à la première requête d'après minuit — la date
 * est comparée, pas supposée.
 */
let selEnMemoire: { jour: string; sel: string } | null = null;

/** Le dernier `last_event_at` écrit par site, pour ne pas l'écrire à chaque vue. */
const dernierSignal = new Map<string, number>();
const SIGNAL_MS = 60_000;

/** Le jour parisien courant, comme partout ailleurs dans le hub. */
function jourParis(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Le sel du jour : celui en mémoire, celui en base, ou un nouveau.
 *
 * La création à la volée n'est pas une roue de secours théorique : la toute
 * première visite d'une journée peut précéder la tâche de nuit si celle-ci a
 * pris du retard. `ignoreDuplicates` puis relecture : deux instances qui
 * démarrent en même temps ne se marchent pas dessus, et la relecture garantit
 * qu'elles repartent avec le même sel — sinon deux visiteurs identiques
 * compteraient pour deux.
 */
async function selDuJour(
  admin: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  const jour = jourParis();
  if (selEnMemoire?.jour === jour) return selEnMemoire.sel;

  const { data: existant } = await admin
    .from("sonde_salt")
    .select("salt")
    .eq("day", jour)
    .maybeSingle();

  if (existant?.salt) {
    selEnMemoire = { jour, sel: existant.salt };
    return existant.salt;
  }

  await admin
    .from("sonde_salt")
    .upsert({ day: jour, salt: randomBytes(32).toString("hex") }, { onConflict: "day", ignoreDuplicates: true });

  const { data: relu } = await admin
    .from("sonde_salt")
    .select("salt")
    .eq("day", jour)
    .maybeSingle();

  if (!relu?.salt) return null;

  selEnMemoire = { jour, sel: relu.salt };
  return relu.salt;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    // Une adresse qui n'a même pas la forme d'un jeton : rien, et surtout pas
    // une requête en base. Sans quoi un scanner nous ferait travailler.
    if (!JETON.test(token)) return recu();

    const entetes = request.headers;
    const userAgent = entetes.get("user-agent");

    // Les deux refus qui ne coûtent rien passent avant tout le reste.
    if (estRobot(userAgent)) return recu();

    const ip = adresse(entetes);
    if (!autorise(ip)) return recu();

    const texte = await request.text();
    if (Buffer.byteLength(texte, "utf8") > TAILLE_MAX_CORPS) return recu();

    let brut: unknown;
    try {
      brut = JSON.parse(texte);
    } catch {
      return recu();
    }

    const parsed = corpsSchema.safeParse(brut);
    if (!parsed.success) return recu();

    const admin = createAdminClient();

    const { data: site } = await admin
      .from("sonde_sites")
      .select("id, organization_id, domains, is_active")
      .eq("token", token)
      .maybeSingle();

    // Jeton inconnu, ou site éteint : on ne confirme jamais l'existence d'un
    // site à un inconnu, et un site éteint ne mesure plus rien dès la seconde
    // qui suit — c'est ce qu'on promet en régénérant un jeton.
    if (!site || !site.is_active) return recu();

    /*
     * L'origine. `sendBeacon` peut l'omettre, et un `Referer` en tient lieu ;
     * quand les deux manquent, on accepte — refuser reviendrait à perdre les
     * visites des navigateurs les plus soucieux de vie privée, c'est-à-dire à
     * sous-compter exactement les gens qu'on tient à ne pas suivre.
     */
    const origine = hote(entetes.get("origin") ?? entetes.get("referer"));
    if (origine && !hoteAutorise(origine, site.domains ?? [])) return recu();

    const sel = await selDuJour(admin);
    if (!sel) return recu();

    /*
     * Le référent interne ne compte pas : une page du site qui renvoie vers
     * une autre n'est pas une provenance. Sans ce filtre, le premier référent
     * d'un client serait toujours son propre domaine, et le tableau de bord
     * dirait quelque chose de vrai mais d'inutile.
     */
    const referentBrut = hote(parsed.data.r);
    const referent =
      referentBrut && !hoteAutorise(referentBrut, site.domains ?? []) ? referentBrut : null;

    const utm = utmRetenus(parsed.data.u);

    const { data: canaux } = await admin
      .from("radar_channels")
      .select("id, key, label, is_comete, rules, sort_order, is_active")
      .eq("organization_id", site.organization_id);

    const { channel_id, channel_bucket } = resoudreCanal({
      utm,
      referrerHost: referent,
      canaux: (canaux ?? []) as unknown as Canal[],
    });

    await admin.from("sonde_events").insert({
      site_id: site.id,
      organization_id: site.organization_id,
      kind: parsed.data.e,
      path: chemin(parsed.data.p),
      referrer_host: referent,
      channel_id,
      channel_bucket,
      visitor_key: cleVisiteur(sel, site.id, ip, userAgent ?? ""),
      utm,
    });

    // « Dernier événement reçu il y a… » n'a pas besoin d'être à la seconde,
    // et l'écrire à chaque page vue doublerait le coût de la route.
    const vu = dernierSignal.get(site.id) ?? 0;
    if (Date.now() - vu > SIGNAL_MS) {
      dernierSignal.set(site.id, Date.now());
      await admin
        .from("sonde_sites")
        .update({ last_event_at: new Date().toISOString() })
        .eq("id", site.id);
    }
  } catch {
    /*
     * Une panne de notre côté ne se raconte pas au visiteur d'un client. Elle
     * ne se rejoue pas non plus : contrairement au webhook Calendly, où un
     * message perdu est une commission perdue, une page vue manquée ne coûte
     * qu'une page vue. Le silence est ici le bon comportement.
     */
  }

  return recu();
}
