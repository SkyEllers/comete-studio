/**
 * Le bouton « Trouver des prospects » : ce que la page dit d'une demande.
 *
 * La recherche tourne sur le PC de Louis, pas ici (migration 0029). Le hub ne
 * fait que déposer la demande et montrer ce que le PC en a écrit. D'où des
 * fonctions pures : elles traduisent une ligne de `prospection_demandes` en
 * une phrase, sans rien savoir de la façon dont le PC travaille.
 */

export type StatutDemande = "en_attente" | "en_cours" | "faite" | "erreur" | "annulee";

export type Demande = {
  id: string;
  nombre: number;
  statut: StatutDemande;
  demandee_le: string;
  commencee_le: string | null;
  finie_le: string | null;
  etape: string | null;
  trouves: number | null;
  bloques: number | null;
  en_file: number | null;
  envoyes: number | null;
  compte_rendu: string | null;
};

export const NOMBRE_MIN = 1;
export const NOMBRE_MAX = 40;

/**
 * Au-delà de ce délai sans que le PC l'ait prise, une demande en attente est
 * signalée : le PC est sans doute éteint. La tâche planifiée passe toutes les
 * 5 minutes ; 15 minutes laissent passer un redémarrage.
 */
export const ATTENTE_SIGNALEE_MIN = 15;

export const estVivante = (d: Pick<Demande, "statut">) =>
  d.statut === "en_attente" || d.statut === "en_cours";

const HEURE = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

export const heure = (iso: string | null) => (iso ? HEURE.format(new Date(iso)) : "—");

const minutesDepuis = (iso: string, maintenant: Date) =>
  Math.floor((maintenant.getTime() - new Date(iso).getTime()) / 60_000);

/** Une phrase pour l'état d'une demande, telle que Louis la lit. */
export function libelleDemande(d: Demande, maintenant: Date = new Date()): string {
  switch (d.statut) {
    case "en_attente": {
      const attente = minutesDepuis(d.demandee_le, maintenant);
      return attente >= ATTENTE_SIGNALEE_MIN
        ? `En attente depuis ${attente} min : ton PC est-il allumé ?`
        : "En attente : ton PC la prend dans les 5 minutes.";
    }
    case "en_cours":
      return d.etape
        ? `En cours depuis ${heure(d.commencee_le)} : ${d.etape}`
        : `En cours depuis ${heure(d.commencee_le)}.`;
    case "faite": {
      const trouves = d.trouves ?? 0;
      const morceaux = [`${trouves} trouvé${trouves > 1 ? "s" : ""} sur ${d.nombre}`];
      if (d.bloques) morceaux.push(`${d.bloques} bloqué${d.bloques > 1 ? "s" : ""} par la vérification`);
      if (d.envoyes) morceaux.push(`${d.envoyes} envoyé${d.envoyes > 1 ? "s" : ""}`);
      if (d.en_file) morceaux.push(`${d.en_file} en file d'envoi`);
      return `${morceaux.join(", ")}.`;
    }
    case "erreur":
      return "La recherche s'est arrêtée sur une erreur : voir le compte rendu.";
    case "annulee":
      return "Annulée avant de commencer.";
  }
}
