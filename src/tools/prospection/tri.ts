import type { Forme, Groupe, Prospect } from "./types.ts";

/**
 * Le tri de la page : qui tombe quand, et qui a droit à une vidéo.
 *
 * La règle vient de la méthode de Comète : 40 approches par semaine, relance
 * dix jours plus tard, **les 20 meilleures notes de la semaine en vidéo**, les
 * autres par un mail court. D'où deux choix ici :
 *
 * 1. Le quota se compte **par semaine de relance**, pas sur toute la liste.
 *    Deux semaines qui se chevauchent ne se volent pas leurs vidéos, et une
 *    semaine creuse ne fait pas monter la suivante.
 * 2. Un prospect **pas encore noté** ne prend pas la place d'un noté. Il passe
 *    derrière tout le monde, et la page dit qu'il reste à noter — plutôt que
 *    de lui inventer une note de 0, qui se lirait comme un jugement.
 *
 * Le classement calculé est une proposition. Ce que Louis coche dans l'app
 * (`suivi.relance_type`) l'emporte toujours : c'est lui qui filme.
 */

/** Lundi de la semaine d'une date ISO, en clé de regroupement. */
export function semaineDe(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const jour = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - jour);
  return d.toISOString().slice(0, 10);
}

export function groupeDe(p: Prospect, aujourdhui: string): Groupe {
  if (p.suivi?.relance_envoyee_le) return "faite";
  if (!p.relance_le) return "sans-date";
  if (p.relance_le < aujourdhui) return "retard";
  if (p.relance_le === aujourdhui) return "aujourdhui";

  const limite = new Date(`${aujourdhui}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + 7);
  return p.relance_le <= limite.toISOString().slice(0, 10) ? "semaine" : "plus-tard";
}

/**
 * Qui a la vidéo : les `quota` meilleures notes de chaque semaine de relance.
 * À note égale, le plus d'avis Google passe devant ([[qualification]] § 0 bis).
 */
export function repartirVideos(
  prospects: Prospect[],
  quota = 20,
): Map<string, Forme> {
  const semaines = new Map<string, Prospect[]>();
  for (const p of prospects) {
    if (p.suivi?.relance_envoyee_le) continue; // déjà parti, plus rien à décider
    const cle = p.relance_le ? semaineDe(p.relance_le) : "sans-date";
    const liste = semaines.get(cle);
    if (liste) liste.push(p);
    else semaines.set(cle, [p]);
  }

  const formes = new Map<string, Forme>();
  for (const liste of semaines.values()) {
    const classes = [...liste].sort(
      (a, b) =>
        (b.note ?? -1) - (a.note ?? -1) ||
        (b.avis_google ?? 0) - (a.avis_google ?? 0) ||
        a.nom.localeCompare(b.nom, "fr"),
    );
    classes.forEach((p, rang) => {
      formes.set(p.slug, rang < quota && p.note !== null ? "video" : "mail");
    });
  }
  return formes;
}

/** La forme retenue : ce que Louis a coché s'il a coché, sinon le calcul. */
export function formeDe(
  p: Prospect,
  calculees: Map<string, Forme>,
): { forme: Forme; choisie: boolean } {
  if (p.suivi?.relance_type) return { forme: p.suivi.relance_type, choisie: true };
  return { forme: calculees.get(p.slug) ?? "mail", choisie: false };
}

/** Dans un groupe, on lit du plus urgent au moins urgent, puis par note. */
export function trierDansGroupe(a: Prospect, b: Prospect): number {
  return (
    (a.relance_le ?? "9999").localeCompare(b.relance_le ?? "9999") ||
    (b.note ?? -1) - (a.note ?? -1) ||
    a.nom.localeCompare(b.nom, "fr")
  );
}
