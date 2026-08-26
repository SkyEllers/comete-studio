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
};

export type CanalDuReleve = { id: string; label: string; is_comete: boolean };

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
export function versCsv(lignes: LigneReleve[]): string {
  const entete = [
    "Date",
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
