import type { Activite } from "./card-mutations";
import type { BoardLabel, BoardMember } from "./types";

const jourComplet = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
});

function texte(payload: Record<string, unknown>, cle: string): string | null {
  const valeur = payload[cle];
  return typeof valeur === "string" && valeur ? valeur : null;
}

function dateLisible(valeur: string | null): string | null {
  if (!valeur) return null;
  const date = new Date(`${valeur}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : jourComplet.format(date);
}

/**
 * Une entrée d'activité en une phrase française.
 *
 * Le sujet est ajouté par l'appelant (« Louis » + la phrase), et une activité
 * dont l'auteur a disparu se lit « Quelqu'un a … ».
 */
export function phraseActivite(
  activite: Activite,
  labels: BoardLabel[],
  members: BoardMember[],
): string {
  const { payload } = activite;

  switch (activite.type) {
    case "card.created":
      return "a créé cette carte";

    case "card.moved": {
      const depuis = texte(payload, "from_list");
      const vers = texte(payload, "to_list");
      if (depuis && vers) return `a déplacé la carte de ${depuis} vers ${vers}`;
      if (vers) return `a déplacé la carte vers ${vers}`;
      return "a déplacé la carte";
    }

    case "card.completed":
      return payload.completed === false
        ? "a rouvert la carte"
        : "a marqué la carte comme terminée";

    case "card.due_set": {
      const quand = dateLisible(texte(payload, "due_date"));
      return quand ? `a fixé l'échéance au ${quand}` : "a retiré l'échéance";
    }

    case "card.archived":
      return "a archivé la carte";

    case "card.commented":
      return "a commenté";

    case "card.assigned": {
      const membre =
        texte(payload, "member") ??
        members.find((m) => m.id === texte(payload, "member_id"))?.name;
      if (!membre) return "a changé les membres";
      return payload.actif === false
        ? `a retiré ${membre} de la carte`
        : `a assigné ${membre}`;
    }

    case "card.labeled": {
      const label = labels.find((l) => l.id === texte(payload, "label_id"));
      const nom = label?.name?.trim();
      const quoi = nom ? `l'étiquette ${nom}` : "une étiquette";
      return payload.actif === false ? `a retiré ${quoi}` : `a ajouté ${quoi}`;
    }

    default:
      return "a modifié la carte";
  }
}
