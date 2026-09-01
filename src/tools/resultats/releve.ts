/**
 * Ce qu'un relevé mensuel contient, et pourquoi chaque ligne compte ou non.
 *
 * Fonctions pures, sans dépendance : elles décident de ce que Louis facture,
 * et c'est le genre de code qu'on veut pouvoir dérouler en une seconde plutôt
 * que de vérifier à l'écran.
 *
 * Le relevé porte **toutes** les séances du mois, pas seulement celles qui
 * comptent. Un relevé qui ne montrerait que la base laisserait le client
 * deviner ce qui a été écarté et pourquoi — c'est exactement ce qui rend une
 * facture contestable.
 */

import { nomDuMois } from "./mois.ts";

export type SeanceDuMois = {
  id: string;
  scheduled_start: string;
  event_type_name: string;
  channel_id: string | null;
  effective_status: string;
  counts_for_commission: boolean;
  amount_cents: number;
  currency: string;
  payment_ok: boolean;
  /** Depuis la phase 7, en mode « ventes ». Nuls partout ailleurs. */
  sale_amount_cents?: number | null;
  sale_date?: string | null;
  has_sale?: boolean;
};

export type CanalDuReleve = { id: string; label: string; is_comete: boolean };

export type BaseDeCommission = "encaissement" | "ventes";

export type LigneReleve = {
  /** L'identifiant du rendez-vous, pour retrouver la ligne d'origine. */
  id: string;
  date: string;
  seance: string;
  canal: string;
  canal_comete: boolean;
  statut: string;
  montant_cents: number;
  devise: string;
  comptee: boolean;
  /** Pourquoi elle ne compte pas. Nulle quand elle compte. */
  raison: string | null;
  /**
   * Le jour où la vente a été conclue, en mode « ventes » seulement.
   *
   * Absent en `encaissement` — et non pas `null` : les relevés déjà clôturés
   * n'ont pas cette clé dans leur instantané, et une clé absente se relit sans
   * ambiguïté comme « ce relevé ne parlait pas de ventes ».
   */
  date_vente?: string;
};

/**
 * Pourquoi une séance n'entre pas dans la base.
 *
 * L'ordre est celui du bon sens plutôt que celui du code : à quelqu'un dont la
 * séance a été annulée, on ne répond pas « paiement manquant ». On donne la
 * raison la plus proche de ce qui s'est passé.
 */
export function raisonExclusion(
  seance: SeanceDuMois,
  canal: CanalDuReleve | null,
): string | null {
  if (seance.counts_for_commission) return null;

  if (seance.effective_status === "annule") return "Séance annulée";
  if (seance.effective_status === "no_show") return "Personne n'est venue";
  if (seance.effective_status === "confirme") return "Séance à venir";
  if (!canal?.is_comete) return `Canal hors Comète${canal ? ` : ${canal.label}` : ""}`;
  if (seance.amount_cents === 0) return "Séance gratuite";
  if (!seance.payment_ok) return "Paiement non enregistré";

  // Ne devrait pas arriver : la vue et ces règles disent la même chose.
  return "Hors base";
}

/** L'instantané figé dans le relevé. Aucune clé d'invité n'y entre. */
export function construireLignes(
  seances: SeanceDuMois[],
  canaux: CanalDuReleve[],
): LigneReleve[] {
  const index = new Map(canaux.map((canal) => [canal.id, canal]));

  return [...seances]
    .sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start))
    .map((seance) => {
      const canal = seance.channel_id ? (index.get(seance.channel_id) ?? null) : null;

      return {
        id: seance.id,
        date: seance.scheduled_start,
        seance: seance.event_type_name,
        // Le libellé est recopié : renommer un canal l'an prochain ne doit pas
        // réécrire un relevé déjà validé.
        canal: canal?.label ?? "Sans canal",
        canal_comete: canal?.is_comete ?? false,
        statut: seance.effective_status,
        montant_cents: seance.amount_cents,
        devise: seance.currency,
        comptee: seance.counts_for_commission,
        raison: raisonExclusion(seance, canal),
      };
    });
}

// ------------------------------ Mode « ventes » ------------------------------

/**
 * Pourquoi une vente déclarée n'entre pas dans la base.
 *
 * Les cas sont plus rares qu'en `encaissement` — l'écran empêche déjà de
 * vendre une séance annulée — mais ils existent : un canal peut être sorti de
 * Comète après coup, et une séance peut avoir été annulée par Calendly après
 * qu'une vente a été déclarée. Le relevé doit alors dire pourquoi, plutôt que
 * de faire disparaître une ligne que le client a saisie de sa main.
 */
export function raisonExclusionVente(
  vente: SeanceDuMois,
  canal: CanalDuReleve | null,
): string | null {
  if (vente.counts_for_commission) return null;

  if (vente.effective_status === "annule") return "Séance annulée";
  if (vente.effective_status === "no_show") return "Personne n'est venue";
  if (!canal?.is_comete) return `Canal hors Comète${canal ? ` : ${canal.label}` : ""}`;

  return "Hors base";
}

/** Ce que le relevé dit d'une séance honorée qui n'a rien vendu. */
export const SANS_VENTE = "Pas de vente déclarée";

/**
 * « de septembre », mais « d'octobre ».
 *
 * Trois mois sur douze commencent par une voyelle — avril, août, octobre — et
 * « le relevé de octobre » sur une facture fait le même effet qu'une faute de
 * frappe : on doute du reste.
 */
function du(mois: string): string {
  return /^[aeiouâàéèêîôû]/i.test(mois) ? `d'${mois}` : `de ${mois}`;
}

/**
 * L'instantané d'un relevé en mode « ventes ».
 *
 * Deux ensembles, et c'est ce qui le distingue de l'autre mode :
 *
 *   - **Les ventes du mois** : celles dont la *date de vente* tombe dedans, quel
 *     que soit le mois de la séance qui les a amenées. C'est la décision 5 de
 *     la phase 7 — un diagnostic du 28 août vendu le 3 septembre est facturé
 *     en septembre. La ligne porte donc les deux dates, sans quoi le client
 *     chercherait en vain, dans son agenda de septembre, une séance d'août.
 *   - **Les séances honorées du mois qui ne sont pas facturées ici**, pour
 *     information et jamais comptées. Sans elles, le relevé ne montrerait que
 *     ce qui est facturé, et le client devrait croire sur parole qu'on n'a
 *     rien oublié.
 *
 * Ce second ensemble réunit deux situations que la ligne distingue par sa
 * raison : la séance n'a rien vendu, ou elle a vendu un autre mois. Dans le
 * second cas elle est facturée là-bas et non ici — l'écrire évite au client de
 * chercher sa séance du 14 août dans un relevé d'août où elle ne compte pas,
 * et évite à la base de la compter deux fois.
 *
 * Le tri final est celui de la date de séance, comme en `encaissement` : c'est
 * l'ordre dans lequel le client se souvient de son mois.
 */
export function construireLignesVentes(
  ventes: SeanceDuMois[],
  seancesDuMois: SeanceDuMois[],
  canaux: CanalDuReleve[],
): LigneReleve[] {
  const index = new Map(canaux.map((canal) => [canal.id, canal]));
  const canalDe = (seance: SeanceDuMois) =>
    seance.channel_id ? (index.get(seance.channel_id) ?? null) : null;

  const lignesDeVente = ventes.map((vente) => {
    const canal = canalDe(vente);

    return {
      id: vente.id,
      date: vente.scheduled_start,
      seance: vente.event_type_name,
      canal: canal?.label ?? "Sans canal",
      canal_comete: canal?.is_comete ?? false,
      statut: vente.effective_status,
      montant_cents: vente.sale_amount_cents ?? 0,
      devise: vente.currency,
      comptee: vente.counts_for_commission,
      raison: raisonExclusionVente(vente, canal),
      ...(vente.sale_date ? { date_vente: vente.sale_date } : {}),
    } satisfies LigneReleve;
  });

  const dejaLa = new Set(ventes.map((vente) => vente.id));

  /*
   * Les séances honorées du mois qui ne sont pas facturées ici, avec la raison
   * qui va bien. Deux cas, et le second est le plus important à dire :
   *
   *   - elle n'a rien vendu — c'est le cas courant ;
   *   - elle a vendu, mais un autre mois. Elle est alors facturée sur ce
   *     mois-là, et non ici. Sans cette ligne, le client qui cherche sa séance
   *     du 14 août dans le relevé d'août ne la trouverait nulle part et
   *     croirait à un oubli.
   *
   * Ni l'une ni l'autre n'est comptée : la première n'a rien rapporté, la
   * seconde est comptée ailleurs, et la faire figurer au total la ferait payer
   * deux fois.
   */
  const lignesSansVente = seancesDuMois
    .filter((seance) => !dejaLa.has(seance.id) && seance.effective_status === "honore")
    .map((seance) => {
      const canal = canalDe(seance);
      // `has_sale` implique une date : la contrainte `radar_sale_coherente` ne
      // laisse pas exister un montant sans elle.
      const vendueAilleurs = seance.has_sale && seance.sale_date ? seance.sale_date : null;
      const mois = vendueAilleurs ? nomDuMois(`${vendueAilleurs.slice(0, 7)}-01`) : null;

      return {
        id: seance.id,
        date: seance.scheduled_start,
        seance: seance.event_type_name,
        canal: canal?.label ?? "Sans canal",
        canal_comete: canal?.is_comete ?? false,
        statut: seance.effective_status,
        montant_cents: 0,
        devise: seance.currency,
        comptee: false,
        raison: mois
          ? `Vendue en ${mois}, facturée sur le relevé ${du(mois)}`
          : SANS_VENTE,
      } satisfies LigneReleve;
    });

  return [...lignesDeVente, ...lignesSansVente].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date),
  );
}

/**
 * La base et la commission.
 *
 * L'arrondi se fait une seule fois, sur le total : arrondir ligne à ligne
 * ferait diverger le relevé du brouillon que le client a vu tout le mois.
 */
export function totaux(
  lignes: LigneReleve[],
  taux: number,
): { base_cents: number; commission_cents: number } {
  const base_cents = lignes
    .filter((ligne) => ligne.comptee)
    .reduce((total, ligne) => total + ligne.montant_cents, 0);

  return { base_cents, commission_cents: Math.round((base_cents * taux) / 100) };
}

/** Un mois révolu se clôture ; le mois en cours, non. */
export function estRevolu(mois: string, moisCourant: string): boolean {
  return mois < moisCourant;
}

// ---------------------------------- CSV -------------------------------------

const echapper = (valeur: string) =>
  /[";\n]/.test(valeur) ? `"${valeur.replace(/"/g, '""')}"` : valeur;

/**
 * Le relevé en CSV, séparé par des points-virgules.
 *
 * C'est ce qu'attend un Excel en français : avec des virgules, il range tout
 * dans une seule colonne, et le client croit le fichier cassé.
 */
export function versCsv(lignes: LigneReleve[], base: BaseDeCommission = "encaissement"): string {
  /*
   * La colonne « Date de vente » n'apparaît qu'en mode `ventes`. Deux raisons :
   * elle serait vide sur toutes les lignes d'un relevé d'encaissement, et
   * surtout le fichier d'un client en `encaissement` reste octet pour octet
   * celui d'avant la phase 7 — c'est ce qui permet de le comparer sans se
   * demander si l'écart vient du format ou des chiffres.
   */
  const ventes = base === "ventes";

  const entete = [
    "Date",
    ...(ventes ? ["Date de vente"] : []),
    "Séance",
    "Canal",
    "Statut",
    "Montant",
    "Comptée",
    "Raison",
  ];

  const corps = lignes.map((ligne) =>
    [
      ligne.date.slice(0, 10),
      ...(ventes ? [ligne.date_vente ?? ""] : []),
      ligne.seance,
      ligne.canal,
      ligne.statut,
      (ligne.montant_cents / 100).toFixed(2).replace(".", ","),
      ligne.comptee ? "oui" : "non",
      ligne.raison ?? "",
    ]
      .map(echapper)
      .join(";"),
  );

  return [entete.join(";"), ...corps].join("\r\n");
}

// ------------------------------ Les décisions -------------------------------

export type Verdict = { ok: true } | { ok: false; raison: string; champ?: string };

/**
 * Ce mois peut-il être clôturé, et dans quel état ?
 *
 * Sorti de la Server Action pour être déroulable : ces trois lignes décident
 * si Louis peut facturer, et une erreur ici se répare par un avoir.
 *
 * Un relevé validé ne se re-clôture pas. Le client a dit oui sur des chiffres
 * précis ; les changer après coup viderait sa validation de son sens. S'il faut
 * vraiment corriger, cela se règle hors de l'outil.
 */
export function peutCloturer(
  statutExistant: string | null,
  mois: string,
  moisCourant: string,
): Verdict {
  if (!estRevolu(mois, moisCourant)) {
    return {
      ok: false,
      raison: "Ce mois n'est pas terminé : il se clôture à partir du 1er du mois suivant.",
    };
  }

  if (statutExistant === null || statutExistant === "conteste") return { ok: true };

  return {
    ok: false,
    raison:
      statutExistant === "cloture"
        ? "Ce mois est déjà clôturé et attend la réponse du client."
        : "Ce relevé est déjà validé : il ne se re-clôture pas.",
  };
}

/**
 * La base de commission de ce client peut-elle changer ?
 *
 * Non tant qu'un relevé n'est pas réglé. Un relevé clôturé attend une réponse,
 * un relevé contesté attend une correction, un relevé validé attend un
 * virement : dans les trois cas une conversation est en cours sur des chiffres
 * précis, et changer la règle qui les a produits reviendrait à répondre à côté.
 *
 * On ne change pas de règle du jeu en cours de partie. Une fois tout payé, la
 * partie est finie et la suivante peut avoir d'autres règles — le relevé
 * d'avant, lui, garde les siennes en propre depuis la 0018.
 */
export function peutChangerDeBase(
  relevesNonPayes: { month: string; status: string }[],
): Verdict {
  if (relevesNonPayes.length === 0) return { ok: true };

  const premier = [...relevesNonPayes].sort((a, b) => a.month.localeCompare(b.month))[0]!;

  return {
    ok: false,
    champ: "commissionBasis",
    raison:
      relevesNonPayes.length === 1
        ? `Le relevé de ${premier.month.slice(0, 7)} n'est pas réglé : termine-le avant de changer la base de commission.`
        : `${relevesNonPayes.length} relevés ne sont pas réglés, à partir de ${premier.month.slice(0, 7)} : termine-les avant de changer la base de commission.`,
  };
}

/**
 * Ce relevé peut-il être marqué payé ?
 *
 * Sur un relevé validé, un clic suffit. Sur un relevé seulement clôturé,
 * l'accord s'est pris hors de l'outil : la note devient la seule trace de cet
 * échange, et elle est donc exigée.
 */
export function peutMarquerPaye(statut: string, note?: string | null): Verdict {
  if (statut === "paye") return { ok: false, raison: "Ce relevé est déjà marqué payé." };

  if (statut === "conteste") {
    return {
      ok: false,
      raison: "Ce relevé est contesté : corrige-le et re-clôture-le d'abord.",
    };
  }

  if (statut === "cloture" && !note?.trim()) {
    return {
      ok: false,
      raison:
        "Ce relevé n'a pas été validé par le client. Dis en une ligne sur quoi vous vous êtes mis d'accord.",
      champ: "note",
    };
  }

  return { ok: true };
}
