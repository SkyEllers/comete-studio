import {
  actifsOrdonnes,
  canalReconnait,
  contient,
  porteUneCampagne,
  type Canal,
} from "../resultats/attribution.ts";

/**
 * D'où vient cette visite.
 *
 * Radar répond à cette question pour un rendez-vous ; Sonde y répond pour une
 * page vue, et elle doit y répondre **pareil**. Un visiteur qui arrive par
 * Google Ads puis réserve doit compter dans Google Ads des deux côtés, sinon
 * l'entonnoir du chantier 5 raconte n'importe quoi : 40 clics venus d'un canal
 * et 9 réservations venues d'un autre.
 *
 * D'où la forme de ce fichier : il n'invente aucune règle. Il réutilise
 * `canalReconnait` et l'ordre d'interrogation de Radar, et n'ajoute qu'une
 * chose que Radar n'a pas — le référent, seul indice quand la personne arrive
 * sans campagne.
 *
 * Fonctions pures, sans dépendance à la base : l'appelant fournit les canaux,
 * et reçoit un verdict.
 */

export type Seau = "direct" | "canal" | "referent";

export type Resolution = {
  channel_id: string | null;
  channel_bucket: Seau;
};

/**
 * Les hôtes qu'on reconnaît comme des moteurs de recherche.
 *
 * Une liste, forcément incomplète, et c'est assumé : un moteur inconnu tombe
 * dans « Référent » avec son hôte affiché, ce qui est lisible et se corrige en
 * ajoutant une ligne ici. L'inverse — un référent quelconque pris pour du
 * référencement naturel — serait un chiffre faux que personne ne verrait.
 *
 * Le domaine de premier niveau est un label, éventuellement deux (`co.uk`),
 * et jamais plus : sans cette borne, `google.com.attaquant.test` passerait
 * pour Google. Un référent est de la donnée fournie par le visiteur, elle se
 * traite comme telle même quand elle ne sert qu'à compter.
 */
const MOTEURS: RegExp[] = [
  /(^|\.)google\.[a-z]{2,}(\.[a-z]{2,})?$/,
  /(^|\.)bing\.com$/,
  /(^|\.)duckduckgo\.com$/,
  /(^|\.)search\.brave\.com$/,
  /(^|\.)ecosia\.org$/,
  /(^|\.)qwant\.com$/,
  /(^|\.)startpage\.com$/,
  /(^|\.)lilo\.org$/,
  /(^|\.)yahoo\.[a-z]{2,}(\.[a-z]{2,})?$/,
  /(^|\.)yandex\.[a-z]{2,}(\.[a-z]{2,})?$/,
  /(^|\.)baidu\.com$/,
];

/**
 * Les hôtes de réseaux sociaux, et la source qu'ils désignent.
 *
 * La source est ce qu'on compare aux règles des canaux : « instagram » doit
 * tomber dans Meta parce que Meta déclare `sources: [facebook, instagram, …]`.
 * C'est la même comparaison que pour un `utm_source`, sur une valeur qu'on a
 * déduite de l'hôte au lieu de la lire dans l'URL.
 */
const RESEAUX: { motif: RegExp; source: string }[] = [
  { motif: /(^|\.)instagram\.com$/, source: "instagram" },
  { motif: /(^|\.)facebook\.com$/, source: "facebook" },
  { motif: /(^|\.)messenger\.com$/, source: "facebook" },
  { motif: /(^|\.)threads\.(net|com)$/, source: "instagram" },
  { motif: /(^|\.)linkedin\.com$/, source: "linkedin" },
  { motif: /(^|\.)lnkd\.in$/, source: "linkedin" },
  { motif: /(^|\.)tiktok\.com$/, source: "tiktok" },
  { motif: /(^|\.)pinterest\.[a-z]{2,}(\.[a-z]{2,})?$/, source: "pinterest" },
  { motif: /(^|\.)youtube\.com$/, source: "youtube" },
  { motif: /(^|\.)youtu\.be$/, source: "youtube" },
  { motif: /(^|\.)x\.com$/, source: "twitter" },
  { motif: /(^|\.)twitter\.com$/, source: "twitter" },
  { motif: /(^|\.)t\.co$/, source: "twitter" },
  { motif: /(^|\.)reddit\.com$/, source: "reddit" },
  { motif: /(^|\.)snapchat\.com$/, source: "snapchat" },
  { motif: /(^|\.)whatsapp\.com$/, source: "whatsapp" },
];

export function estMoteurDeRecherche(hote: string): boolean {
  return MOTEURS.some((motif) => motif.test(hote));
}

export function reseauSocial(hote: string): string | null {
  return RESEAUX.find(({ motif }) => motif.test(hote))?.source ?? null;
}

/** Le canal d'une clé donnée, parmi les actifs. */
function parCle(canaux: Canal[], cle: string): Canal | null {
  return canaux.find((canal) => canal.key === cle) ?? null;
}

/**
 * Le verdict.
 *
 * Trois questions dans cet ordre, la première qui répond l'emporte :
 *
 * 1. La campagne, quand l'URL en porte une. Exactement la règle de Radar, sur
 *    exactement les mêmes canaux, dans le même ordre.
 * 2. Le référent, quand il n'y a pas de campagne. Un moteur de recherche va au
 *    canal qui déclare `organic` — c'est ce qui range Bing avec Google plutôt
 *    que dans les référents. Un réseau social va au canal dont les sources le
 *    nomment. Le reste reste un référent, avec son hôte, à lire tel quel.
 * 3. Rien du tout : Direct.
 *
 * `referrerHost` doit déjà être débarrassé du référent interne — une page du
 * site qui renvoie vers une autre n'est pas une provenance, et l'appelant s'en
 * charge, lui seul connaissant les domaines du site.
 */
export function resoudreCanal({
  utm,
  referrerHost,
  canaux,
}: {
  utm: Record<string, string>;
  referrerHost: string | null;
  canaux: Canal[];
}): Resolution {
  const actifs = actifsOrdonnes(canaux);

  // 1. La campagne parle d'elle-même.
  if (porteUneCampagne(utm)) {
    const trouve = actifs.find((canal) => canalReconnait(canal, utm));
    // Une campagne qu'aucun canal ne reconnaît reste une campagne : « Autre »,
    // comme chez Radar, et ses `utm` restent lisibles pour que Louis tranche.
    const secours = trouve ?? parCle(actifs, "autre");
    return { channel_id: secours?.id ?? null, channel_bucket: "canal" };
  }

  // 2. Le référent, à défaut.
  if (referrerHost) {
    if (estMoteurDeRecherche(referrerHost)) {
      const organique = actifs.find((canal) => contient(canal.rules.mediums, "organic"));
      if (organique) return { channel_id: organique.id, channel_bucket: "canal" };
    }

    const source = reseauSocial(referrerHost);
    if (source) {
      const reseau = actifs.find((canal) => contient(canal.rules.sources, source));
      if (reseau) return { channel_id: reseau.id, channel_bucket: "canal" };
    }

    return { channel_id: null, channel_bucket: "referent" };
  }

  // 3. Personne ne l'a envoyée : elle est venue d'elle-même.
  return { channel_id: parCle(actifs, "direct")?.id ?? null, channel_bucket: "direct" };
}
