/**
 * D'où vient ce rendez-vous.
 *
 * Fonctions pures, sans aucune dépendance : c'est ce qui rend ce fichier
 * testable directement par `node --test`, et c'est ce qui compte, parce que
 * chaque décision prise ici finit en euros sur un relevé que le client peut
 * contester. Rien n'y touche la base ; l'appelant fournit les canaux et
 * l'historique, et reçoit un verdict.
 */

export type ReglesCanal = {
  sources?: string[];
  mediums?: string[];
  click_ids?: string[];
  declared?: string[];
};

export type Canal = {
  id: string;
  key: string;
  label: string;
  is_comete: boolean;
  rules: ReglesCanal;
  sort_order: number;
  is_active: boolean;
};

export type Attribution = "utm" | "recurrence" | "direct" | "manuel";

export type Precedent = {
  id?: string | null;
  channel_id: string | null;
  scheduled_start: string;
};

/** Les paramètres qu'une régie ajoute d'elle-même, sans passer par les `utm_*`. */
export const IDENTIFIANTS_DE_CLIC: readonly string[] = ["gclid", "fbclid", "ttclid"];

const JOUR_MS = 86_400_000;

/** Comparaison insensible à la casse, aux accents et aux espaces de bord. */
function normaliser(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Exportée pour Sonde, qui pose la même question sur d'autres entrées : un
 * hôte de référent plutôt qu'un `utm_source`. Recopier ces cinq lignes
 * ailleurs, c'est se préparer à ce que deux normalisations divergent.
 */
export function contient(liste: string[] | undefined, valeur: string | undefined): boolean {
  if (!valeur || !liste || liste.length === 0) return false;
  const cible = normaliser(valeur);
  return liste.some((entree) => normaliser(entree) === cible);
}

/** Ce rendez-vous porte-t-il la trace d'une campagne ? */
export function porteUneCampagne(utm: Record<string, string>): boolean {
  return Object.entries(utm).some(
    ([cle, valeur]) =>
      Boolean(valeur) && (cle.startsWith("utm_") || IDENTIFIANTS_DE_CLIC.includes(cle)),
  );
}

/**
 * Un canal reconnaît-il cette visite ?
 *
 * La règle du brief — « premier canal dont les sources OU les mediums OU les
 * identifiants de clic correspondent » — ne suffit pas telle quelle : Google
 * Ads déclare `sources: [google]` et SEO aussi, si bien qu'une visite
 * `google/organic` tomberait dans les annonces, qui passent en premier. On
 * paierait une commission sur du référencement naturel.
 *
 * D'où la règle appliquée ici : une dimension déclarée par le canal ne compte
 * que si la visite la porte, et si elle la porte et la contredit, elle oppose
 * son veto. Il faut donc au moins un accord et aucun désaccord.
 *
 *   google/cpc      → Ads : source d'accord, medium d'accord         → oui
 *   google/organic  → Ads : source d'accord, medium en désaccord     → non
 *                     SEO : les deux d'accord                        → oui
 *   gclid seul      → Ads : identifiant de clic présent              → oui
 *   google seul     → Ads : source d'accord, medium non porté        → oui
 */
export function canalReconnait(canal: Canal, utm: Record<string, string>): boolean {
  const verdicts: boolean[] = [];

  if (canal.rules.sources?.length && utm.utm_source) {
    verdicts.push(contient(canal.rules.sources, utm.utm_source));
  }
  if (canal.rules.mediums?.length && utm.utm_medium) {
    verdicts.push(contient(canal.rules.mediums, utm.utm_medium));
  }
  // Un identifiant de clic ne contredit jamais : ou il est là, ou il n'est pas
  // là. C'est un indice, pas une exigence.
  if (canal.rules.click_ids?.some((cle) => Boolean(utm[cle]))) {
    verdicts.push(true);
  }

  return verdicts.length > 0 && verdicts.every(Boolean);
}

/**
 * Les canaux qui comptent, dans l'ordre où on les interroge.
 *
 * L'ordre est la moitié de la règle — Google Ads avant SEO — et Sonde doit
 * interroger les canaux dans le même, sans quoi une visite tomberait dans un
 * canal chez Radar et dans un autre chez Sonde, pour la même personne.
 */
export function actifsOrdonnes(channels: Canal[]): Canal[] {
  return channels
    .filter((canal) => canal.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

/**
 * Le verdict.
 *
 * Trois questions, dans cet ordre, et la première qui répond l'emporte :
 * la campagne, puis la récurrence, puis rien — c'est-à-dire Direct.
 */
export function attribuer({
  utm,
  scheduledStart,
  channels,
  previous,
  windowDays,
}: {
  utm: Record<string, string>;
  scheduledStart: string;
  channels: Canal[];
  previous: Precedent | null;
  /** Absent du brief, mais la fenêtre de récurrence ne se devine pas. */
  windowDays: number;
}): {
  channel_id: string | null;
  attribution: Attribution;
  /** Le rendez-vous qui a transmis son canal, quand c'est une récurrence. */
  source: string | null;
} {
  const actifs = actifsOrdonnes(channels);
  const parCle = (cle: string) => actifs.find((canal) => canal.key === cle)?.id ?? null;

  // 1. Ce que la campagne dit d'elle-même.
  if (porteUneCampagne(utm)) {
    const trouve = actifs.find((canal) => canalReconnait(canal, utm));
    // Une campagne qu'aucun canal ne reconnaît reste une campagne : elle va
    // dans « Autre », et ses `utm` restent lisibles pour que Louis tranche.
    return { channel_id: trouve?.id ?? parCle("autre"), attribution: "utm", source: null };
  }

  // 2. La même personne qui revient sans repasser par une annonce.
  if (windowDays > 0 && previous?.channel_id) {
    const ecart =
      (Date.parse(scheduledStart) - Date.parse(previous.scheduled_start)) / JOUR_MS;
    if (Number.isFinite(ecart) && ecart >= 0 && ecart < windowDays) {
      return {
        channel_id: previous.channel_id,
        attribution: "recurrence",
        source: previous.id ?? null,
      };
    }
  }

  return { channel_id: parCle("direct"), attribution: "direct", source: null };
}

/**
 * Le rendez-vous précédent de cette personne, celui qui peut porter la
 * récurrence.
 *
 * Une séance annulée ne compte pas : elle n'a pas eu lieu, et laisser une
 * annulation propager son canal pendant trois mois donnerait une commission
 * sur une séance qui n'a jamais existé.
 */
export function precedent(
  historique: {
    id?: string | null;
    channel_id: string | null;
    scheduled_start: string;
    status: string;
  }[],
  scheduledStart: string,
): Precedent | null {
  const borne = Date.parse(scheduledStart);

  const candidats = historique
    .filter(
      (rdv) =>
        rdv.status !== "annule" &&
        Number.isFinite(Date.parse(rdv.scheduled_start)) &&
        Date.parse(rdv.scheduled_start) < borne,
    )
    .sort((a, b) => Date.parse(b.scheduled_start) - Date.parse(a.scheduled_start));

  const retenu = candidats[0];
  return retenu
    ? {
        id: retenu.id ?? null,
        channel_id: retenu.channel_id,
        scheduled_start: retenu.scheduled_start,
      }
    : null;
}

/**
 * « Comment m'avez-vous connu ? »
 *
 * Affichée à côté de l'attribution, jamais utilisée pour attribuer : les gens
 * se souviennent mal, et une commission ne se fonde pas sur un souvenir.
 * Tronquée à 120 caractères — la question est à choix unique, mais si un
 * client la passe un jour en texte libre, rien de long n'entrera ici.
 */
export function reponseDeclaree(
  questions: { question: string; answer: string }[],
): string | null {
  const trouvee = questions.find((qa) => normaliser(qa.question).includes("connu"));
  const reponse = trouvee?.answer?.trim();
  return reponse ? reponse.slice(0, 120) : null;
}

/** Le canal que cette réponse désigne, s'il en désigne un. */
export function canalDeclare(reponse: string | null, channels: Canal[]): Canal | null {
  if (!reponse) return null;
  return channels.find((canal) => contient(canal.rules.declared, reponse)) ?? null;
}

/**
 * Les canaux posés à l'activation de Radar pour un client.
 *
 * L'ordre n'est pas décoratif : Google Ads est interrogé avant SEO, sans quoi
 * `google/cpc` tomberait dans le référencement naturel.
 */
export const CANAUX_PAR_DEFAUT: {
  key: string;
  label: string;
  is_comete: boolean;
  rules: ReglesCanal;
  sort_order: number;
}[] = [
  {
    key: "google_ads",
    label: "Google Ads",
    is_comete: true,
    sort_order: 10,
    rules: {
      sources: ["google"],
      mediums: ["cpc", "ppc", "paid"],
      click_ids: ["gclid"],
      declared: ["Google"],
    },
  },
  {
    key: "meta",
    label: "Meta",
    is_comete: true,
    sort_order: 20,
    rules: {
      sources: ["facebook", "instagram", "meta", "ig", "fb"],
      click_ids: ["fbclid"],
      declared: ["Instagram", "Facebook", "Instagram ou Facebook"],
    },
  },
  {
    key: "seo",
    label: "SEO",
    is_comete: true,
    sort_order: 30,
    rules: {
      sources: ["google"],
      mediums: ["organic"],
      declared: ["Recherche Google"],
    },
  },
  {
    key: "newsletter",
    label: "Newsletter",
    is_comete: false,
    sort_order: 40,
    rules: { mediums: ["email", "newsletter"], declared: ["Newsletter"] },
  },
  {
    key: "bouche_a_oreille",
    label: "Bouche à oreille",
    is_comete: false,
    sort_order: 50,
    rules: { declared: ["Bouche à oreille"] },
  },
  { key: "direct", label: "Direct", is_comete: false, sort_order: 60, rules: {} },
  { key: "autre", label: "Autre", is_comete: false, sort_order: 70, rules: {} },
];
