/**
 * Automatisations — est-ce que le courrier de Comète arrive bien ?
 *
 * Quatorze automatisations écrivent à Louis chaque semaine ou chaque mois. Le
 * vault (`00-studio/automatisations.md`) dit quand chacune doit écrire ; le
 * script `automatisations-vers-hub.py` regarde la boîte Gmail et les runs
 * GitHub, et pousse ici ce qu'il a constaté. Cette page ne calcule rien
 * d'autre que des mots et des couleurs.
 */

/** L'état d'une occurrence : ce qui s'est passé, et de quel côté chercher. */
export type Etat =
  | "ok"
  | "tardif"
  | "attente"
  | "silence"
  | "panne"
  | "mail-perdu"
  | "manque"
  | "pause"
  | "inconnu";

export type Passage = {
  attendue_le: string;
  recu_le: string | null;
  recu_objet: string | null;
  run_statut: string | null;
  run_url: string | null;
  etat: Etat;
};

export type Automatisation = {
  slug: string;
  client: string;
  nom: string;
  cadence: string;
  depot: string;
  workflow: string;
  mail_attendu: "toujours" | "au-besoin";
  actif: boolean;
  ordre: number;
  prochaine_le: string | null;
  attendue_le: string | null;
  recu_le: string | null;
  recu_objet: string | null;
  run_statut: string | null;
  run_le: string | null;
  run_url: string | null;
  etat: Etat;
  releve_le: string;
  passages: Passage[];
};

/** Ce que l'état veut dire, en une phrase, et ce qu'il faut en faire. */
export const ETATS: Record<Etat, { mot: string; quoi: string; gravite: 0 | 1 | 2 }> = {
  ok: { mot: "reçu", quoi: "Le mail est arrivé dans les temps.", gravite: 0 },
  tardif: {
    mot: "reçu en retard",
    quoi: "Le mail est arrivé, mais après le délai prévu. À surveiller si ça se répète.",
    gravite: 1,
  },
  attente: {
    mot: "en attente",
    quoi: "L'heure est passée, le délai de retard court encore. Normal.",
    gravite: 0,
  },
  silence: {
    mot: "silence",
    quoi: "Rien reçu, et c'est normal : celle-ci n'écrit que s'il y a quelque chose à dire.",
    gravite: 0,
  },
  panne: {
    mot: "en panne",
    quoi: "Le job a échoué sur GitHub. C'est le dépôt qu'il faut aller voir.",
    gravite: 2,
  },
  "mail-perdu": {
    mot: "mail perdu",
    quoi:
      "Le job est vert mais aucun mail ne porte l'objet attendu : soit l'envoi s'est perdu, soit l'objet a changé dans le code sans que le vault suive.",
    gravite: 2,
  },
  manque: {
    mot: "rien",
    quoi: "Ni mail, ni job. L'automatisation ne s'est pas déclenchée.",
    gravite: 2,
  },
  pause: { mot: "en pause", quoi: "Arrêtée volontairement. Rien n'est attendu.", gravite: 0 },
  inconnu: {
    mot: "jamais vue passer",
    quoi:
      "Aucun mail ni job depuis 90 jours. Normal pour une automatisation installée récemment, qui attend sa première échéance.",
    gravite: 1,
  },
};
