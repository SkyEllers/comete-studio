import { cn } from "@/lib/utils";

import type { Compte } from "./mesure";

/**
 * La fréquentation, jour par jour.
 *
 * En SVG à la main : une bibliothèque de graphiques pèserait plus lourd que
 * tout le reste de la page pour dessiner des rectangles. Ils sont dessinés
 * dans un repère de hauteur 100 et étirés par le CSS — les barres se déforment
 * en largeur, ce qui n'a aucune importance puisqu'il n'y a pas de texte dedans,
 * et la hauteur reste juste.
 *
 * Deux séries : les visiteurs en gris, et par-dessus, à la même place, les
 * clics en ember. Elles sont l'une dans l'autre — chaque clic vient d'un
 * visiteur — et les superposer se lit tout de suite : voilà les gens venus,
 * voilà ceux qui ont cliqué.
 *
 * Les jours creux sont dessinés à zéro. Sauter un week-end mort donnerait
 * l'image d'une fréquentation régulière qui n'existe pas.
 */

const JOUR_COURT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const JOUR_LONG = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

const etiquette = (jour: string, format: Intl.DateTimeFormat) =>
  format.format(new Date(`${jour}T00:00:00Z`));

export function Graphique({ jours }: { jours: (Compte & { jour: string })[] }) {
  if (jours.length === 0) return null;

  const plafond = Math.max(...jours.map((jour) => jour.visiteurs), 1);
  const largeur = jours.length;

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${largeur} 100`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Visiteurs et clics du ${etiquette(jours[0].jour, JOUR_LONG)} au ${etiquette(jours[jours.length - 1].jour, JOUR_LONG)}`}
        className="border-line bg-surface-1 h-40 w-full rounded-lg border p-0"
      >
        {jours.map((jour, index) => {
          const hauteur = (jour.visiteurs / plafond) * 92;
          const clics = (jour.clics / plafond) * 92;

          return (
            <g key={jour.jour}>
              <title>
                {`${etiquette(jour.jour, JOUR_LONG)} — ${jour.visiteurs} visiteur${jour.visiteurs > 1 ? "s" : ""}, ${jour.pagesVues} page${jour.pagesVues > 1 ? "s" : ""} vue${jour.pagesVues > 1 ? "s" : ""}, ${jour.clics} clic${jour.clics > 1 ? "s" : ""}`}
              </title>

              {/* Une bande transparente sur toute la hauteur : c'est elle qui
                  attrape le survol, sinon un jour à zéro n'aurait aucune
                  surface à pointer. */}
              <rect x={index} y={0} width={1} height={100} fill="transparent" />

              <rect
                x={index + 0.15}
                y={100 - hauteur}
                width={0.7}
                height={hauteur}
                className="fill-muted-foreground/40"
              />
              {jour.clics > 0 ? (
                <rect
                  x={index + 0.15}
                  y={100 - clics}
                  width={0.7}
                  height={clics}
                  className="fill-ember"
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className="text-muted-foreground flex justify-between font-mono text-xs">
        <span>{etiquette(jours[0].jour, JOUR_COURT)}</span>
        <span>{etiquette(jours[jours.length - 1].jour, JOUR_COURT)}</span>
      </div>

      <figcaption className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-muted-foreground/40 h-2 w-3 rounded-xs" />
          Visiteurs
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-ember h-2 w-3 rounded-xs" />
          Clics « réserver »
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Une répartition, en barres horizontales.
 *
 * Des longueurs et non des angles : un camembert de sept parts est illisible
 * sur un téléphone, et l'œil compare mal des secteurs.
 */
export function Repartition({
  parts,
  vide,
}: {
  parts: { cle: string; label: string; valeur: number; detail?: string; accent?: boolean }[];
  vide: string;
}) {
  if (parts.length === 0) {
    return <p className="text-muted-foreground text-sm">{vide}</p>;
  }

  const plafond = Math.max(...parts.map((part) => part.valeur), 1);

  return (
    <ul className="space-y-3">
      {parts.map((part) => (
        <li key={part.cle} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className={cn("truncate", part.accent && "text-ember")}>{part.label}</span>
            <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
              {part.detail ?? part.valeur.toLocaleString("fr-FR")}
            </span>
          </div>
          <div className="bg-surface-2 h-1.5 overflow-hidden rounded-full" role="presentation">
            <div
              className={cn(
                "h-full rounded-full",
                part.accent ? "bg-ember" : "bg-muted-foreground",
              )}
              style={{ width: `${Math.round((part.valeur / plafond) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
